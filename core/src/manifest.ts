import { defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";
import type { EngagementSource } from "./index";

export const manifest = defineManifest<
  Record<string, never>,
  EngagementSource
>()({
  contract: 2,
  discovery: {
    audiences: ["agent-hosts", "application-developers"],
    intents: [
      "normalize sales engagement providers",
      "enrich people and companies",
      "read outreach activity",
    ],
    keywords: ["engagement", "enrichment", "sales", "outreach", "crm"],
    protocols: ["TypeScript"],
  },
  identity: {
    accent: "#7c3aed",
    category: "sales",
    description:
      "Provider-neutral contracts for person and company enrichment, people search, and outreach activity. Provider adapters retain metering and rate-limit semantics without leaking vendor response shapes.",
    docsUrl: "https://github.com/absolutejs/engagement-adapters/tree/main/core",
    name: "@absolutejs/engagement",
    tagline: "One safe contract for sales enrichment and outreach activity.",
  },
  settings: Type.Object({}),
  slots: {
    source: {
      configPath: "source",
      contract: "engagement/source",
      description: "Who provides sales enrichment and outreach activity",
      known: ["@absolutejs/engagement-apollo"],
      required: true,
    },
  },
  wiring: [
    {
      description:
        "Create one provider-neutral engagement source for enrichment and outreach activity.",
      id: "default",
      server: {
        code: "const engagement = ${slot.source};",
        imports: [],
        placement: "module-scope",
      },
      title: "Create the engagement source",
    },
  ],
});
