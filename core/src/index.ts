// @absolutejs/engagement — the contract every sales-engagement adapter implements.
//
// A provider (Apollo, Outreach, Salesloft, …) is normalized to ONE shape with two jobs:
//   1. enrichment — resolve a person/company from sparse input.
//   2. activity   — the outreach that has actually happened, on a unified timeline.
//
// Every field that a provider might not return is `| null` rather than optional, so a
// consumer never has to guess whether "missing" means "absent" or "not asked for". The
// untyped provider payload is preserved on `raw` for callers that need a field we have
// not normalized yet.

/**
 * Thrown by an adapter when the provider reports a rate limit (e.g. HTTP 429), so
 * a consumer can DEFER (retry when the window resets) instead of mistaking it for
 * "no results found". Other failures still resolve to null/[] — only an explicit
 * rate limit throws, because only it is meaningfully retryable-later.
 */
export class RateLimitError extends Error {
  constructor(public readonly provider: string) {
    super(`${provider}: rate limited`);
    this.name = "RateLimitError";
  }
}

export type NormalizedPerson = {
  /** Every known address (work + personal), best-first and de-duplicated. The
   *  primary is `emails[0]`; empty when the provider returned none. One list, so
   *  there's a single source of truth (no separate "primary" field to drift). */
  emails: string[];
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  company: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  photoUrl: string | null;
  location: string | null;
  raw?: unknown;
};

export type NormalizedCompany = {
  name: string | null;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  foundedYear: number | null;
  linkedinUrl: string | null;
  description: string | null;
  raw?: unknown;
};

export type EngagementChannel = "call" | "email" | "linkedin" | "meeting" | "other";

export type EngagementDirection = "inbound" | "outbound";

/**
 * One outreach touchpoint, normalized. `kind` is the provider's own event name (e.g.
 * "email_sent", "email_opened", "email_replied", "linkedin_message") kept verbatim so no
 * fidelity is lost; `channel` + `direction` are the normalized axes a consumer can rely on.
 */
export type EngagementActivity = {
  id: string;
  channel: EngagementChannel;
  direction: EngagementDirection;
  kind: string;
  occurredAt: string;
  subject: string | null;
  preview: string | null;
  contactEmail: string | null;
  contactName: string | null;
  raw?: unknown;
};

export type EnrichPersonQuery = {
  email?: string;
  name?: string;
  company?: string;
  domain?: string;
  linkedinUrl?: string;
};

export type EnrichCompanyQuery = {
  domain?: string;
  name?: string;
};

/**
 * Find the people at a company who match a set of role/title hints — "who are the
 * partnerships leads at X". A provider resolves this from its own DB (reliable +
 * instant, vs scraping the web). `titles` are matched loosely against each
 * person's title; `limit` caps how many people to return.
 */
export type PersonSearchQuery = {
  company?: string;
  domain?: string;
  titles?: string[];
  limit?: number;
};

export type ActivityQuery = {
  contactEmail?: string;
  /** ISO-8601 lower bound — only activities at or after this instant. */
  since?: string;
  limit?: number;
};

/**
 * A sales-engagement provider. Every capability is optional so an adapter can implement
 * only what its provider (and the caller's plan) supports — a consumer checks for the
 * method before calling it.
 */
export type EngagementSource = {
  /** Stable provider id, e.g. "apollo". */
  readonly id: string;
  enrichPerson?: (query: EnrichPersonQuery) => Promise<NormalizedPerson | null>;
  enrichCompany?: (query: EnrichCompanyQuery) => Promise<NormalizedCompany | null>;
  /** Find the decision-makers at a company by role — returns fully-resolved
   *  people (name, LinkedIn, email when the plan allows). */
  searchPeople?: (query: PersonSearchQuery) => Promise<NormalizedPerson[]>;
  listActivities?: (query: ActivityQuery) => Promise<EngagementActivity[]>;
};
