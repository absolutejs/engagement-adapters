# @absolutejs/engagement

Provider-neutral contracts for sales enrichment and outreach activity in
AbsoluteJS. Applications depend on one `EngagementSource`; provider packages
such as `@absolutejs/engagement-apollo` implement that contract.

```ts
import type { EngagementSource } from "@absolutejs/engagement";

export const enrichLead = async (engagement: EngagementSource, email: string) =>
  engagement.enrichPerson?.({ email });
```

The package manifest exposes a required `engagement/source` slot. AbsoluteJS
Studio uses that slot to present compatible providers as no-code choices while
keeping credentials in the environment and provider response shapes behind the
shared contract.

## Providers

- [`@absolutejs/engagement-apollo`](https://www.npmjs.com/package/@absolutejs/engagement-apollo)
  — Apollo person and company enrichment, role-based people search, and
  outreach activity.

## License

Apache-2.0.
