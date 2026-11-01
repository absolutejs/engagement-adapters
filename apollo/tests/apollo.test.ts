import { describe, expect, test } from "bun:test";
import {
  EngagementProviderError,
  RateLimitError,
} from "@absolutejs/engagement";
import { apolloSource } from "../src";

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });

describe("Apollo engagement source", () => {
  test("surfaces provider throttling as the shared nominal error", async () => {
    const source = apolloSource({
      apiKey: "test-key",
      fetchImpl: async () => jsonResponse({}, 429),
    });

    await expect(
      source.enrichPerson?.({ email: "person@example.com" }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  test("normalizes person identity and removes locked email placeholders", async () => {
    const source = apolloSource({
      apiKey: "test-key",
      fetchImpl: async () =>
        jsonResponse({
          person: {
            city: "New York",
            contact: { email: "alternate@example.com" },
            country: "US",
            email: "primary@example.com",
            first_name: "Ada",
            last_name: "Lovelace",
            linkedin_url: "https://www.linkedin.com/in/ada",
            name: "Ada Lovelace",
            organization: {
              name: "Analytical Engines",
              primary_domain: "engines.example",
            },
            personal_emails: [
              "email_not_unlocked@domain.com",
              "alternate@example.com",
            ],
            state: "NY",
            title: "Founder",
          },
        }),
    });

    await expect(
      source.enrichPerson?.({ email: "primary@example.com" }),
    ).resolves.toEqual(
      expect.objectContaining({
        company: "Analytical Engines",
        companyDomain: "engines.example",
        emails: ["primary@example.com", "alternate@example.com"],
        firstName: "Ada",
        lastName: "Lovelace",
        location: "New York, NY, US",
        name: "Ada Lovelace",
        title: "Founder",
      }),
    );
  });

  test("records every paid reveal attempt independently of returned people", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

      if (url.endsWith("/api/v1/mixed_people/api_search")) {
        expect(body).toEqual({
          page: 1,
          per_page: 2,
          person_titles: ["partnerships"],
          q_organization_domains_list: ["example.com"],
        });

        return jsonResponse({
          people: [{ id: "person-1" }, { id: "person-2" }],
        });
      }

      if (body?.id === "person-1") {
        return jsonResponse({
          person: {
            email: "one@example.com",
            name: "Person One",
          },
        });
      }

      return jsonResponse({ person: null });
    };
    const source = apolloSource({ apiKey: "test-key", fetchImpl });

    await expect(
      source.searchPeople?.({
        domain: "example.com",
        limit: 2,
        titles: ["partnerships"],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        people: [
          expect.objectContaining({
            emails: ["one@example.com"],
            name: "Person One",
          }),
        ],
        revealsAttempted: 2,
        searchRequests: 1,
      }),
    );
  });
});

test("company enrichment preserves Apollo revenue with its documented USD denomination", async () => {
  const source = apolloSource({
    apiKey: "test",
    fetchImpl: async () =>
      jsonResponse({
        organization: {
          id: "org-1",
          name: "Example",
          primary_domain: "example.com",
          annual_revenue: 12000000,
          annual_revenue_printed: "12M",
        },
      }),
  });
  const company = await source.enrichCompany?.({ domain: "example.com" });
  expect(company?.providerId).toBe("org-1");
  expect(company?.annualRevenue).toMatchObject({
    amount: 12000000,
    display: "12M",
    currency: "USD",
    basis: "provider_estimate",
    provider: "apollo",
  });
  expect(Number.isFinite(Date.parse(company!.annualRevenue!.observedAt))).toBe(
    true,
  );
});

test("missing or zero revenue remains unavailable", async () => {
  const source = apolloSource({
    apiKey: "test",
    fetchImpl: async () =>
      jsonResponse({ organization: { annual_revenue: 0 } }),
  });
  expect(
    (await source.enrichCompany?.({ domain: "example.com" }))?.annualRevenue,
  ).toBeNull();
});

test("company enrichment does not misreport authentication and server failures as no data", async () => {
  for (const status of [401, 403, 500, 503]) {
    const source = apolloSource({
      apiKey: "test",
      fetchImpl: async () =>
        jsonResponse({ error: "private provider detail" }, status),
    });
    await expect(
      source.enrichCompany?.({ domain: "example.com" }),
    ).rejects.toThrow(`HTTP ${status}`);
  }
  const missing = apolloSource({
    apiKey: "test",
    fetchImpl: async () => jsonResponse({}, 404),
  });
  expect(await missing.enrichCompany?.({ domain: "example.com" })).toBeNull();
});

test("company identity falls back to the returned website, never the requested domain", async () => {
  for (const [organization, expected] of [
    [{ website_url: "https://www.example.com/about" }, "example.com"],
    [
      {
        primary_domain: "canonical.example",
        website_url: "https://other.example",
      },
      "canonical.example",
    ],
    [{ website_url: "https://other.example" }, "other.example"],
    [{ website_url: "javascript:example.com" }, null],
    [{ website_url: "https://user:password@example.com" }, null],
    [{ website_url: "not a url" }, null],
    [{}, null],
  ] as const) {
    const source = apolloSource({
      apiKey: "test",
      fetchImpl: async () => jsonResponse({ organization }),
    });
    expect(
      (await source.enrichCompany?.({ domain: "requested.example" }))?.domain,
    ).toBe(expected);
  }
});

test("company enrichment sends both domain and company name to improve provider identity matching", async () => {
  let requested = "";
  const source = apolloSource({
    apiKey: "test",
    fetchImpl: async (input) => {
      requested = String(input);
      return jsonResponse({
        organization: {
          name: "Example & Company",
          primary_domain: "example.com",
        },
      });
    },
  });
  await source.enrichCompany?.({
    domain: "example.com",
    name: " Example & Company ",
  });
  const url = new URL(requested);
  expect(url.searchParams.get("domain")).toBe("example.com");
  expect(url.searchParams.get("name")).toBe("Example & Company");
});

test("person enrichment preserves only the provider-returned employer domain, including its website fallback", async () => {
  for (const [organization, expected] of [
    [
      { name: "Example", website_url: "https://www.example.com/team" },
      "example.com",
    ],
    [{ name: "Other", primary_domain: "other.example" }, "other.example"],
    [{ name: "Example" }, null],
    [{ website_url: "https://user:password@example.com/" }, null],
  ] as const) {
    const source = apolloSource({
      apiKey: "test",
      fetchImpl: async () =>
        jsonResponse({
          person: { name: "Jane Smith", title: "CTO", organization },
        }),
    });
    const person = await source.enrichPerson?.({
      name: "Jane Smith",
      domain: "requested.example",
    });
    expect(person?.companyDomain).toBe(expected);
    expect(person?.title).toBe("CTO");
  }
});

test("people search and reveal use canonical endpoints and expose provider failures", async () => {
  for (const status of [401, 403, 422, 500, 503]) {
    for (const failSearch of [true, false]) {
      const calls: string[] = [];
      const source = apolloSource({
        apiKey: "secret-test-key",
        fetchImpl: async (input) => {
          const path = new URL(String(input)).pathname;
          calls.push(path);
          if (path === "/api/v1/mixed_people/api_search" && !failSearch)
            return jsonResponse({ people: [{ id: "p1" }] });
          return jsonResponse({ error: "private provider details" }, status);
        },
      });
      await expect(
        source.searchPeople?.({ domain: "example.com", limit: 1 }),
      ).rejects.toBeInstanceOf(EngagementProviderError);
      expect(calls).toEqual(
        failSearch
          ? ["/api/v1/mixed_people/api_search"]
          : ["/api/v1/mixed_people/api_search", "/api/v1/people/match"],
      );
    }
  }
});

test("direct person enrichment uses canonical endpoint without leaking failure bodies", async () => {
  const source = apolloSource({
    apiKey: "test",
    fetchImpl: async (input) => {
      expect(new URL(String(input)).pathname).toBe("/api/v1/people/match");
      return jsonResponse({ error: "sensitive provider details" }, 422);
    },
  });
  await expect(
    source.enrichPerson?.({ name: "Person", domain: "example.com" }),
  ).rejects.toThrow("apollo: /api/v1/people/match failed (HTTP 422)");
});

test("invalid person response is not silently treated as a missing record", async () => {
  for (const payload of [null, [], "invalid", {}]) {
    const source = apolloSource({
      apiKey: "test",
      fetchImpl: async () => jsonResponse(payload),
    });
    await expect(
      source.enrichPerson?.({ name: "Person" }),
    ).rejects.toBeInstanceOf(EngagementProviderError);
  }
  const missing = apolloSource({
    apiKey: "test",
    fetchImpl: async () => jsonResponse({ person: null }),
  });
  expect(await missing.enrichPerson?.({ name: "Person" })).toBeNull();
});

test("over-returned and duplicate search records cannot exceed the paid reveal limit", async () => {
  const revealed: string[] = [];
  const source = apolloSource({
    apiKey: "test",
    fetchImpl: async (input, init) => {
      if (String(input).endsWith("/api_search"))
        return jsonResponse({
          people: [{ id: "a" }, { id: "a" }, { id: "b" }, { id: "c" }],
        });
      revealed.push(JSON.parse(String(init?.body)).id);
      return jsonResponse({ person: null });
    },
  });
  const result = await source.searchPeople?.({
    domain: "example.com",
    limit: 2,
  });
  expect(revealed).toEqual(["a", "b"]);
  expect(result?.revealsAttempted).toBe(2);
});
