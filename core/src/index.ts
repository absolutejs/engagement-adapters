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

export type NormalizedPerson = {
  email: string | null;
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
  listActivities?: (query: ActivityQuery) => Promise<EngagementActivity[]>;
};
