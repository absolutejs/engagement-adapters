# @absolutejs/engagement-apollo

[Apollo.io](https://apollo.io) adapter for [`@absolutejs/engagement`](../core).

```ts
import { apolloSource } from "@absolutejs/engagement-apollo";

const apollo = apolloSource({ apiKey: process.env.APOLLO_KEY! });

// Enrichment
const person = await apollo.enrichPerson?.({ email: "jane@acme.com" });
const company = await apollo.enrichCompany?.({ domain: "acme.com" });

// Outreach activity (what's been sent / opened / replied) for a contact
const activity = await apollo.listActivities?.({
  contactEmail: "jane@acme.com",
});
```

## Capabilities

| Method           | Apollo endpoint                    | Notes                                                                                                                                                        |
| ---------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enrichPerson`   | `POST /v1/people/match`            | Consumes an enrichment credit per match.                                                                                                                     |
| `enrichCompany`  | `GET /v1/organizations/enrich`     | Domain required.                                                                                                                                             |
| `listActivities` | `POST /v1/emailer_messages/search` | **Plan-gated** — engagement API access varies by Apollo plan. Returns `[]` if unsupported; verify field mapping against a live account before relying on it. |

Company enrichment preserves provider identity and annual revenue with observation time and provider-estimate attribution. Apollo documents `organization.annual_revenue` as an estimate in USD; the adapter preserves that denomination. It does not infer currency from the company location.

Company enrichment returns `null` for no match (404), throws `RateLimitError` for 429, and throws `EngagementProviderError` for authentication, permission, server, or malformed-response failures. Errors exclude raw response bodies and credentials. Person/activity endpoints retain their existing behavior.

## License

Apache-2.0.
