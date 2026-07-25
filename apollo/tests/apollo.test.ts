import { describe, expect, test } from "bun:test";
import { RateLimitError } from "@absolutejs/engagement";
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

      if (url.endsWith("/v1/mixed_people/api_search")) {
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
