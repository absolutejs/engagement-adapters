import { describe, expect, test } from "bun:test";
import { RateLimitError } from "../src";

describe("Engagement contracts", () => {
  test("retains a nominal provider rate-limit identity", () => {
    const error = new RateLimitError("apollo");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.name).toBe("RateLimitError");
    expect(error.provider).toBe("apollo");
    expect(error.message).toBe("apollo: rate limited");
  });
});
