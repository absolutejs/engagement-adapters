// Apollo.io adapter for @absolutejs/engagement.
//
// Implements the EngagementSource contract over the Apollo REST API (api.apollo.io),
// authenticated with an `X-Api-Key`. Two well-documented enrichment calls plus a
// best-effort activity feed. Every response is parsed defensively — Apollo's payloads are
// untyped JSON and several capabilities are plan-gated, so a missing field or an
// unsupported plan yields `null`/`[]` rather than throwing.

import { RateLimitError } from "@absolutejs/engagement";
import type {
  ActivityQuery,
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

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null;

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const joinLocation = (parts: Array<string | null>): string | null => {
  const present = parts.filter((part): part is string => part !== null);

  return present.length > 0 ? present.join(", ") : null;
};

export const apolloSource = (options: ApolloOptions): EngagementSource => {
  const baseUrl = options.baseUrl ?? APOLLO_BASE_URL;
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Key": options.apiKey,
  };

  // A 429 is surfaced as a RateLimitError so the caller can DEFER (the window
  // resets, then retry) rather than read an empty body as "nothing found" and
  // act on it. Every other non-OK status stays a soft null (the provider is
  // best-effort + plan-gated; a missing capability must not throw).
  const post = async (path: string, body: Json): Promise<Json | null> => {
    const res = await doFetch(`${baseUrl}${path}`, {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    });
    if (res.status === 429) throw new RateLimitError("apollo");
    if (!res.ok) return null;
    const json: unknown = await res.json();

    return isRecord(json) ? json : null;
  };

  const get = async (path: string): Promise<Json | null> => {
    const res = await doFetch(`${baseUrl}${path}`, { headers, method: "GET" });
    if (res.status === 429) throw new RateLimitError("apollo");
    if (!res.ok) return null;
    const json: unknown = await res.json();

    return isRecord(json) ? json : null;
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
        [str(person.email), contact ? str(contact.email) : null, ...personalEmails]
          .filter((value): value is string => value !== null)
          .filter((value) => !LOCKED_EMAIL.test(value)),
      ),
    );

    return {
      company: org ? str(org.name) : null,
      companyDomain: org ? str(org.primary_domain) : null,
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
    const json = await post("/v1/people/match", { id });
    const person = json && isRecord(json.person) ? json.person : null;

    return person ? normalizePerson(person) : null;
  };

  const enrichPerson = async (
    query: EnrichPersonQuery,
  ): Promise<NormalizedPerson | null> => {
    const json = await post("/v1/people/match", {
      domain: query.domain,
      email: query.email,
      linkedin_url: query.linkedinUrl,
      name: query.name,
      organization_name: query.company,
    });
    const person = json && isRecord(json.person) ? json.person : null;

    return person ? normalizePerson(person) : null;
  };

  // Find the decision-makers at a company by role. Apollo's api_search returns
  // OBFUSCATED previews (first name + title + an id), so we reveal each hit by
  // id — yielding fully-resolved people (name, LinkedIn, email when allowed).
  const searchPeople = async (
    query: PersonSearchQuery,
  ): Promise<PersonSearchResult> => {
    const limit = query.limit ?? DEFAULT_SEARCH_LIMIT;
    const search = await post("/v1/mixed_people/api_search", {
      page: 1,
      per_page: limit,
      ...(query.titles && query.titles.length > 0
        ? { person_titles: query.titles }
        : {}),
      ...(query.domain ? { q_organization_domains_list: [query.domain] } : {}),
      ...(!query.domain && query.company
        ? { q_keywords: query.company }
        : {}),
    });
    // A non-OK search returns null (no charge); a parsed body means the search
    // request happened (and was billed).
    const searchRequests = search ? 1 : 0;
    const previews =
      search && Array.isArray(search.people) ? search.people : [];
    const ids = previews
      .map((person) => (isRecord(person) ? str(person.id) : null))
      .filter((id): id is string => id !== null);
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

  const enrichCompany = async (
    query: EnrichCompanyQuery,
  ): Promise<NormalizedCompany | null> => {
    if (!query.domain) return null;
    const json = await get(
      `/v1/organizations/enrich?domain=${encodeURIComponent(query.domain)}`,
    );
    const org = json && isRecord(json.organization) ? json.organization : null;
    if (!org) return null;

    return {
      description: str(org.short_description),
      domain: str(org.primary_domain),
      employeeCount: num(org.estimated_num_employees),
      foundedYear: num(org.founded_year),
      industry: str(org.industry),
      linkedinUrl: str(org.linkedin_url),
      name: str(org.name),
      raw: org,
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
  };
};
