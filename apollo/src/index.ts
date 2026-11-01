// Apollo.io adapter for @absolutejs/engagement.
//
// Implements the EngagementSource contract over the Apollo REST API (api.apollo.io),
// authenticated with an `X-Api-Key`. Two well-documented enrichment calls plus a
// best-effort activity feed. Every response is parsed defensively — Apollo's payloads are
// untyped JSON. Missing records remain null/empty; provider failures are explicit
// so callers cannot mistake authentication, plan or request errors for no data.

import {
  EngagementProviderError,
  RateLimitError,
} from "@absolutejs/engagement";
import type {
  ActivityQuery,
  CompanyReference,
  CompanySearchQuery,
  CompanySearchResult,
  EngagementActivity,
  EngagementSource,
  EnrichCompanyQuery,
  EnrichPersonQuery,
  NormalizedCompany,
  NormalizedPerson,
  PersonSearchQuery,
  PersonSearchResult,
} from "@absolutejs/engagement";

const APOLLO_BASE_URL = "https://api.apollo.io";
const DEFAULT_ACTIVITY_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 6;
// Apollo's search returns a locked placeholder address until a person is enriched.
const LOCKED_EMAIL = /email_not_unlocked/iu;

export type ApolloOptions = {
  apiKey: string;
  /** Override for testing or a proxy. Defaults to https://api.apollo.io. */
  baseUrl?: string;
  /** Inject a fetch (tests, instrumentation). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

/** Safe provider classification; response bodies and billing context stay private. */
export class ApolloProviderError extends EngagementProviderError {
  constructor(
    status: number,
    operation: string,
    public readonly code: string | null,
  ) {
    super("apollo", status, operation);
    this.name = "ApolloProviderError";
    if (code === "BILLING.LIMIT.CREDITS_EXHAUSTED") {
      this.message =
        "Apollo lead credits are exhausted. An administrator must replenish the connected Apollo account; application credits do not fund Apollo.";
    }
  }
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

// Only use provider-returned identity; never substitute the requested domain.
const companyDomain = (org: Json): string | null => {
  const primary = str(org.primary_domain);
  if (primary) return primary;
  const website = str(org.website_url);
  if (!website) return null;
  try {
    const url = new URL(website);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
      ? url.hostname.toLowerCase().replace(/^www\./u, "") || null
      : null;
  } catch {
    return null;
  }
};

const joinLocation = (parts: Array<string | null>): string | null => {
  const present = parts.filter((part): part is string => part !== null);

  return present.length > 0 ? present.join(", ") : null;
};

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((item) =>
        typeof item === "string" && item.trim() ? [item.trim()] : [],
      )
    : [];
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
const publicUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
};
const reference = (value: unknown): CompanyReference | null =>
  isRecord(value)
    ? {
        providerId: str(value.id),
        name: str(value.name),
        domain: companyDomain(value),
        country: str(value.country),
        employeeCount: count(value.estimated_num_employees),
        industries: strings(value.industries),
      }
    : null;

const providerFailure = async (res: Response, operation: string) => {
  const value: unknown = await res.json().catch(() => null);
  const details =
    isRecord(value) && isRecord(value.error_details)
      ? value.error_details
      : null;
  const code =
    details &&
    typeof details.code === "string" &&
    /^[A-Z0-9_.]{1,120}$/u.test(details.code)
      ? details.code
      : null;
  return new ApolloProviderError(res.status, operation, code);
};

export const apolloSource = (options: ApolloOptions): EngagementSource => {
  const baseUrl = options.baseUrl ?? APOLLO_BASE_URL;
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Key": options.apiKey,
  };

  // An HTTP failure is not an empty search or an absent person. Keep provider
  // bodies private; expose only the endpoint and HTTP status through the shared error.
  const post = async (path: string, body: Json): Promise<Json> => {
    const res = await doFetch(`${baseUrl}${path}`, {
      body: JSON.stringify(body),
      headers,
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429) throw new RateLimitError("apollo");
    if (!res.ok) throw await providerFailure(res, path);
    const json: unknown = await res.json().catch(() => null);
    if (!isRecord(json))
      throw new EngagementProviderError(
        "apollo",
        502,
        `invalid ${path} response`,
      );
    return json;
  };

  // Map a revealed Apollo person record → NormalizedPerson. Shared by
  // enrichPerson and searchPeople (which reveals each search hit by id).
  const normalizePerson = (person: Json): NormalizedPerson => {
    const org = isRecord(person.organization) ? person.organization : null;
    // Apollo spreads addresses across `email` (primary work), `personal_emails`,
    // and `contact.email` — gather them all, drop the locked placeholder, and
    // de-dupe (primary first) so a consumer can offer alternates.
    const contact = isRecord(person.contact) ? person.contact : null;
    const personalEmails = Array.isArray(person.personal_emails)
      ? person.personal_emails.map(str)
      : [];
    const emails = Array.from(
      new Set(
        [
          str(person.email),
          contact ? str(contact.email) : null,
          ...personalEmails,
        ]
          .filter((value): value is string => value !== null)
          .filter((value) => !LOCKED_EMAIL.test(value)),
      ),
    );

    return {
      company: org ? str(org.name) : null,
      companyDomain: org ? companyDomain(org) : null,
      emails,
      facebookUrl: str(person.facebook_url),
      firstName: str(person.first_name),
      githubUrl: str(person.github_url),
      lastName: str(person.last_name),
      linkedinUrl: str(person.linkedin_url),
      location: joinLocation([
        str(person.city),
        str(person.state),
        str(person.country),
      ]),
      name: str(person.name),
      photoUrl: str(person.photo_url),
      raw: person,
      title: str(person.title),
      twitterUrl: str(person.twitter_url),
    };
  };

  // Reveal a single person by their Apollo id (the search returns obfuscated
  // previews; people/match by id unlocks the full record).
  const matchById = async (id: string): Promise<NormalizedPerson | null> => {
    const json = await post("/api/v1/people/match", { id });
    if (json.person !== null && !isRecord(json.person))
      throw new EngagementProviderError(
        "apollo",
        502,
        "invalid person enrichment response",
      );
    const person = isRecord(json.person) ? json.person : null;

    return person ? normalizePerson(person) : null;
  };

  const enrichPerson = async (
    query: EnrichPersonQuery,
  ): Promise<NormalizedPerson | null> => {
    const json = await post("/api/v1/people/match", {
      domain: query.domain,
      email: query.email,
      linkedin_url: query.linkedinUrl,
      name: query.name,
      organization_name: query.company,
    });
    if (json.person !== null && !isRecord(json.person))
      throw new EngagementProviderError(
        "apollo",
        502,
        "invalid person enrichment response",
      );
    const person = isRecord(json.person) ? json.person : null;

    return person ? normalizePerson(person) : null;
  };

  // Find the decision-makers at a company by role. Apollo's api_search returns
  // OBFUSCATED previews (first name + title + an id), so we reveal each hit by
  // id — yielding fully-resolved people (name, LinkedIn, email when allowed).
  const searchPeople = async (
    query: PersonSearchQuery,
  ): Promise<PersonSearchResult> => {
    const limit = query.limit ?? DEFAULT_SEARCH_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new RangeError(
        "Apollo people limit must be an integer from 1 to 100",
      );
    const search = await post("/api/v1/mixed_people/api_search", {
      page: 1,
      per_page: limit,
      ...(query.titles && query.titles.length > 0
        ? { person_titles: query.titles }
        : {}),
      ...(query.domain ? { q_organization_domains_list: [query.domain] } : {}),
      ...(!query.domain && query.company ? { q_keywords: query.company } : {}),
    });
    const searchRequests = 1;
    if (!Array.isArray(search.people))
      throw new EngagementProviderError(
        "apollo",
        502,
        "invalid people search response",
      );
    const ids = [
      ...new Set(
        search.people
          .map((person) => (isRecord(person) ? str(person.id) : null))
          .filter((id): id is string => id !== null),
      ),
    ].slice(0, limit);
    if (ids.length === 0) {
      return { people: [], revealsAttempted: 0, searchRequests };
    }
    // Each id is revealed via /people/match — a paid reveal that's charged even
    // when it resolves to null. revealsAttempted = ids.length (what Apollo billed
    // + what counts against the reveal rate limit), NOT the non-null survivors.
    const revealed = await Promise.all(ids.map((id) => matchById(id)));

    return {
      people: revealed.filter(
        (person): person is NormalizedPerson => person !== null,
      ),
      revealsAttempted: ids.length,
      searchRequests,
    };
  };

  const normalizeCompany = (org: Json): NormalizedCompany => {
    const revenue = num(org.annual_revenue);
    const revenueDisplay = str(org.annual_revenue_printed);
    return {
      intelligence: {
        provider: "apollo",
        observedAt: new Date().toISOString(),
        sourceUrl: /^[a-f0-9]{24}$/iu.test(str(org.id) ?? "")
          ? `https://app.apollo.io/#/organizations/${org.id}`
          : null,
        websiteUrl: publicUrl(org.website_url),
        location: joinLocation([
          str(org.city),
          str(org.state),
          str(org.country),
        ]),
        industries: strings(org.industries),
        keywords: strings(org.keywords),
        technologies: strings(org.technology_names),
        retailLocationCount: count(org.retail_location_count),
        activeRetailLocationCount: count(org.num_retail_locations),
        parent: reference(org.owned_by_organization),
        ultimateParent: reference(org.ultimate_parent_organization),
        parentIds: strings(org.owned_by_chain),
        subsidiaries: Array.isArray(org.suborganizations)
          ? org.suborganizations.flatMap((value) => {
              const item = reference(value);
              return item ? [item] : [];
            })
          : [],
        subsidiaryCount: count(org.num_suborganizations),
        totalFunding: count(org.total_funding),
        latestFundingStage: str(org.latest_funding_stage),
        latestFundingDate: str(org.latest_funding_round_date),
      },
      providerId: str(org.id),
      annualRevenue:
        (revenue !== null && revenue > 0) || revenueDisplay
          ? {
              amount: revenue !== null && revenue > 0 ? revenue : null,
              display: revenueDisplay,
              // Apollo documents organization.annual_revenue as an estimate in USD:
              // https://knowledge.apollo.io/hc/en-us/articles/4416909768717-Integrate-Marketo-with-Apollo
              currency: "USD",
              basis: "provider_estimate",
              provider: "apollo",
              observedAt: new Date().toISOString(),
            }
          : null,
      description: str(org.short_description),
      domain: companyDomain(org),
      employeeCount: num(org.estimated_num_employees),
      foundedYear: num(org.founded_year),
      industry: str(org.industry),
      linkedinUrl: str(org.linkedin_url),
      name: str(org.name),
      raw: org,
    };
  };

  const companyRequest = async (
    path: string,
    signal?: AbortSignal,
    body?: Json,
  ): Promise<Json | null> => {
    signal?.throwIfAborted();
    const res = await doFetch(`${baseUrl}${path}`, {
      headers,
      method: body ? "POST" : "GET",
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([
        AbortSignal.timeout(30_000),
        ...(signal ? [signal] : []),
      ]),
    });
    if (res.status === 429) throw new RateLimitError("apollo");
    if (res.status === 404 && !body) return null;
    if (!res.ok)
      throw await providerFailure(
        res,
        body ? "company search" : "company enrichment",
      );
    const value: unknown = await res.json();
    if (!isRecord(value))
      throw new EngagementProviderError(
        "apollo",
        502,
        "invalid company response",
      );
    return value;
  };
  const enrichCompany = async (
    query: EnrichCompanyQuery,
  ): Promise<NormalizedCompany | null> => {
    if (!query.domain && !query.website && !query.linkedinUrl) return null;
    const params = new URLSearchParams();
    if (query.domain) params.set("domain", query.domain);
    if (query.website) params.set("website", query.website);
    if (query.linkedinUrl) params.set("linkedin_url", query.linkedinUrl);
    if (query.name?.trim()) params.set("name", query.name.trim());
    const json = await companyRequest(
      `/api/v1/organizations/enrich?${params}`,
      query.signal,
    );
    if (!json || json.organization === null) return null;
    if (!isRecord(json.organization))
      throw new EngagementProviderError(
        "apollo",
        502,
        "invalid company enrichment response",
      );
    return normalizeCompany(json.organization);
  };
  const searchCompanies = async (
    query: CompanySearchQuery,
  ): Promise<CompanySearchResult> => {
    if (!query.domain && !query.name?.trim())
      return { companies: [], searchRequests: 0 };
    const limit = Number.isFinite(query.limit)
      ? Math.max(1, Math.min(100, Math.floor(query.limit!)))
      : 5;
    const json = await companyRequest(
      "/api/v1/mixed_companies/search",
      query.signal,
      {
        page: 1,
        per_page: limit,
        ...(query.domain
          ? { q_organization_domains_list: [query.domain] }
          : {}),
        ...(!query.domain && query.name
          ? { q_organization_name: query.name.trim() }
          : {}),
      },
    );
    if (
      !json ||
      !Array.isArray(json.organizations) ||
      json.organizations.some((value) => !isRecord(value))
    )
      throw new EngagementProviderError(
        "apollo",
        502,
        "invalid company search response",
      );
    return {
      companies: json.organizations
        .filter(isRecord)
        .slice(0, limit)
        .map(normalizeCompany),
      searchRequests: 1,
    };
  };

  // Sent-email activity with open/reply state, normalized to EngagementActivity. The
  // emailer-messages search is plan-gated on Apollo's side; an unsupported plan or a
  // changed payload shape yields [] (never throws). Verify field mapping live before
  // relying on it.
  const listActivities = async (
    query: ActivityQuery,
  ): Promise<EngagementActivity[]> => {
    const json = await post("/v1/emailer_messages/search", {
      per_page: query.limit ?? DEFAULT_ACTIVITY_LIMIT,
      ...(query.contactEmail ? { q_keywords: query.contactEmail } : {}),
    });
    const rows =
      json && Array.isArray(json.emailer_messages) ? json.emailer_messages : [];

    const activities = rows.flatMap((row): EngagementActivity[] => {
      if (!isRecord(row)) return [];
      const id = str(row.id);
      const baseAt = str(row.created_at) ?? str(row.sent_at);
      if (!id || !baseAt) return [];
      const repliedAt = str(row.replied_at);
      const openedAt = str(row.opened_at);
      const kind = repliedAt
        ? "email_replied"
        : openedAt
          ? "email_opened"
          : "email_sent";

      return [
        {
          channel: "email",
          contactEmail: str(row.to_email) ?? query.contactEmail ?? null,
          contactName: str(row.to_name),
          direction: repliedAt ? "inbound" : "outbound",
          id,
          kind,
          occurredAt: repliedAt ?? openedAt ?? baseAt,
          preview: str(row.body_text),
          raw: row,
          subject: str(row.subject),
        },
      ];
    });

    const { since } = query;

    return since
      ? activities.filter((activity) => activity.occurredAt >= since)
      : activities;
  };

  return {
    enrichCompany,
    enrichPerson,
    id: "apollo",
    listActivities,
    searchPeople,
    searchCompanies,
  };
};
