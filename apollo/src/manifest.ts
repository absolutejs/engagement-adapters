import { defineImplementation, defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";
import type { ApolloOptions } from "./index";

export const manifest = defineManifest<ApolloOptions>()({
  contract: 2,
  discovery: {
    audiences: ["agent-hosts", "application-developers"],
    intents: [
      "enrich a person with Apollo",
      "enrich a company with Apollo",
      "search people by role",
      "read Apollo outreach activity",
    ],
    keywords: ["apollo", "engagement", "enrichment", "outreach", "sales"],
    protocols: ["HTTPS"],
  },
  identity: {
    accent: "#5c4cff",
    category: "sales",
    description:
      "Apollo-backed EngagementSource for person and company enrichment, role-based people search, and outreach activity with explicit provider-credit accounting.",
    docsUrl:
      "https://github.com/absolutejs/engagement-adapters/tree/main/apollo",
    name: "@absolutejs/engagement-apollo",
    tagline: "Connect Apollo enrichment and outreach to your site.",
  },
  implements: [
    defineImplementation<ApolloOptions>()({
      contract: "engagement/source",
      factory: "apolloSource",
      from: "@absolutejs/engagement-apollo",
      requires: {
        env: [
          {
            description: "Apollo API key",
            docsUrl: "https://developer.apollo.io/keys/",
            key: "APOLLO_API_KEY",
            secret: true,
          },
        ],
        peers: [
          {
            name: "@absolutejs/engagement",
            range: ">=0.0.7 <0.1",
            reason: "Shared engagement contracts and rate-limit identity",
          },
        ],
      },
      settings: Type.Object({
        baseUrl: Type.Optional(
          Type.String({
            description:
              "Apollo-compatible API origin. Leave empty for the official Apollo API.",
            format: "uri",
            title: "API origin",
          }),
        ),
      }),
      title: "Apollo",
      wiring: {
        code: "apolloSource({ apiKey: ${env.APOLLO_API_KEY}, ...${settings} })",
        imports: [
          {
            from: "@absolutejs/engagement-apollo",
            names: ["apolloSource"],
          },
        ],
      },
    }),
  ],
  settings: Type.Object({}),
  wiring: [],
});
