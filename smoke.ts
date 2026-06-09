// Smoke test — run with: APOLLO_KEY=... bun smoke.ts
import { apolloSource } from "./apollo/src/index";

const apiKey = process.env.APOLLO_KEY;
if (!apiKey) throw new Error("set APOLLO_KEY");
const apollo = apolloSource({ apiKey });

const noRaw = (o: unknown) =>
  o && typeof o === "object"
    ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== "raw"))
    : o;

console.log("enrichCompany(stripe.com):");
console.log(noRaw(await apollo.enrichCompany?.({ domain: "stripe.com" })));
console.log("\nenrichPerson(l@nagy.vc):");
console.log(noRaw(await apollo.enrichPerson?.({ email: "l@nagy.vc" })));
console.log("\nlistActivities(limit 3):");
console.log(await apollo.listActivities?.({ limit: 3 }));
