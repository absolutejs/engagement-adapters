import { describe, expect, test } from "bun:test";
import { RateLimitError } from "../src";
import { manifest } from "../src/manifest";

describe("Engagement contracts", () => {
  test("retains a nominal provider rate-limit identity", () => {
    const error = new RateLimitError("apollo");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.name).toBe("RateLimitError");
    expect(error.provider).toBe("apollo");
    expect(error.message).toBe("apollo: rate limited");
  });

  test("hosts provider implementations behind the engagement source slot", () => {
    expect(manifest.slots?.source).toEqual({
      configPath: "source",
      contract: "engagement/source",
      description: "Who provides sales enrichment and outreach activity",
      known: ["@absolutejs/engagement-apollo"],
      required: true,
    });
    expect(manifest.wiring[0]?.server?.code).toBe(
      "const engagement = ${slot.source};",
    );
  });
});
