import { expect, test } from "bun:test";
import { apolloSource } from "../src/index";
import {
  companyIdentityMatch,
  selectCompanyIdentity,
} from "@absolutejs/engagement";
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const org = {
  id: "5a9e49e8a6da98d97e7baabf",
  name: "REBOOT",
  primary_domain: "rebootfc.com",
  annual_revenue: 500000,
};
const company = async (data = org) =>
  (await apolloSource({
    apiKey: "test",
    fetchImpl: async () => response({ organization: data }),
  }).enrichCompany!({ domain: "rebootfc.com" }))!;
test("exact domains permit brand aliases, not unrelated names or parent domains", async () => {
  const item = await company();
  expect(
    companyIdentityMatch(
      item,
      "REBOOT Fitness Consulting",
      "https://rebootfc.com",
    ),
  ).toBe("domain_brand_alias");
  expect(
    companyIdentityMatch(item, "Rebooter", "https://rebootfc.com"),
  ).toBeNull();
  expect(
    companyIdentityMatch(item, "REBOOT", "https://other.example"),
  ).toBeNull();
  expect(
    companyIdentityMatch(
      { ...item, name: "Other" },
      "REBOOT",
      "https://rebootfc.com",
    ),
  ).toBeNull();
  expect(
    selectCompanyIdentity(
      [item, { ...item, providerId: "different" }],
      "REBOOT",
      "rebootfc.com",
    ),
  ).toBeNull();
  expect(selectCompanyIdentity([item, item], "REBOOT", "rebootfc.com")).toEqual(
    item,
  );
});
test("company search is bounded, uses the documented endpoint, and does not reveal contacts", async () => {
  const requests: string[] = [];
  const source = apolloSource({
    apiKey: "test",
    fetchImpl: async (input, init) => {
      requests.push(String(input));
      expect(JSON.parse(String(init?.body))).toEqual({
        page: 1,
        per_page: 5,
        q_organization_domains_list: ["rebootfc.com"],
      });
      return response({ organizations: [org] });
    },
  });
  const result = await source.searchCompanies!({
    domain: "rebootfc.com",
    name: "REBOOT",
  });
  expect(result.searchRequests).toBe(1);
  expect(result.companies[0]?.annualRevenue?.amount).toBe(500000);
  expect(requests).toEqual([
    "https://api.apollo.io/api/v1/mixed_companies/search",
  ]);
});
test("company evidence retains hierarchy and counts without treating funding as revenue", async () => {
  const source = apolloSource({
    apiKey: "test",
    fetchImpl: async () =>
      response({
        organization: {
          ...org,
          annual_revenue: null,
          total_funding: 400000,
          owned_by_organization: {
            id: "parent",
            name: "Parent",
            website_url: "https://parent.example",
          },
          owned_by_chain: ["parent"],
          suborganizations: [
            {
              id: "child",
              name: "Child",
              website_url: "https://child.example",
              industries: ["fitness"],
              estimated_num_employees: 12,
            },
          ],
          num_suborganizations: 1,
          num_retail_locations: 0,
          retail_location_count: 8,
          technology_names: ["Stripe"],
          industries: ["fitness"],
          latest_funding_stage: "Seed",
          country: "USA",
        },
      }),
  });
  const item = await source.enrichCompany!({ domain: "rebootfc.com" });
  expect(item?.annualRevenue).toBeNull();
  expect(item?.intelligence).toMatchObject({
    activeRetailLocationCount: 0,
    retailLocationCount: 8,
    totalFunding: 400000,
    parent: { domain: "parent.example" },
    subsidiaries: [{ domain: "child.example", employeeCount: 12 }],
    technologies: ["Stripe"],
  });
  expect(item?.intelligence?.sourceUrl).toBe(
    "https://app.apollo.io/#/organizations/" + org.id,
  );
});
test("search failures and malformed responses do not masquerade as no data", async () => {
  for (const status of [401, 403, 404, 422, 500]) {
    const source = apolloSource({
      apiKey: "test",
      fetchImpl: async () => response({ error: "secret" }, status),
    });
    await expect(
      source.searchCompanies!({ domain: "example.com" }),
    ).rejects.toThrow("HTTP " + status);
  }
  for (const value of [{}, [], { organizations: [null] }]) {
    const source = apolloSource({
      apiKey: "test",
      fetchImpl: async () => response(value),
    });
    await expect(
      source.searchCompanies!({ domain: "example.com" }),
    ).rejects.toThrow("invalid company");
  }
});
test("cancellation prevents requests and alternate identifiers are forwarded", async () => {
  let calls = 0;
  const source = apolloSource({
    apiKey: "test",
    fetchImpl: async (input) => {
      calls++;
      const url = new URL(String(input));
      expect(url.searchParams.get("linkedin_url")).toBe(
        "https://linkedin.com/company/example",
      );
      return response({ organization: org });
    },
  });
  await expect(
    source.enrichCompany!({
      domain: "example.com",
      signal: AbortSignal.abort(),
    }),
  ).rejects.toThrow();
  expect(calls).toBe(0);
  await source.enrichCompany!({
    linkedinUrl: "https://linkedin.com/company/example",
  });
  expect(calls).toBe(1);
});
