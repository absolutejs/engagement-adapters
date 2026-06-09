# engagement-adapters

Monorepo for **`@absolutejs/engagement`** sales-engagement adapters.

A sales-engagement platform (Apollo, Outreach, Salesloft, …) is two things at once: an
**enrichment** source (who is this person / company) and an **activity** source (what
outreach has actually happened — emails sent, opened, replied; LinkedIn touches; calls).
Each adapter normalizes one provider to the single **`EngagementSource`** contract so a
consuming app can pull both without knowing which vendor is behind it.

## Packages

| Package | Provider | Publishes as |
| --- | --- | --- |
| `core/` | the `EngagementSource` contract + normalized types | `@absolutejs/engagement` |
| `apollo/` | [Apollo.io](https://apollo.io) | `@absolutejs/engagement-apollo` |

Add a provider by dropping a new `./<name>/` workspace that implements `EngagementSource`
and publishes as `@absolutejs/engagement-<name>` — same shape as every other adapter
monorepo in the ecosystem (`dataset-adapters`, `queue-adapters`, `voice-adapters`, …).

## Why it exists

The point isn't "another enrichment vendor" — we already have those. It's that a rep's
real outreach **activity** lives in these platforms, and that activity is what tells you
which deals to keep driving and which to let cool. Pulling it onto a unified deal timeline
is the value.

## License

Apache-2.0. Each adapter only orchestrates a third-party API it does not bundle; the
leverage is the consuming engine, not the adapter.
