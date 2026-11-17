import { expect, test } from "bun:test";
import { apolloSource } from "../src/index";
import { isPersonSearchPartialError } from "@absolutejs/engagement";

for (const rejectAfter of [0, 1])
  test(`quota rejection preserves ${rejectAfter} confirmed reveals`, async () => {
    let reveals = 0;
    const source = apolloSource({
      apiKey: "test",
      fetchImpl: Object.assign(
        async (input: Parameters<typeof fetch>[0]) => {
          if (String(input).endsWith("api_search"))
            return Response.json({ people: [{ id: "a" }, { id: "b" }] });
          if (reveals++ < rejectAfter)
            return Response.json({ person: { id: "a", name: "Test Person" } });
          return Response.json(
            { error_details: { code: "BILLING.LIMIT.CREDITS_EXHAUSTED" } },
            { status: 422 },
          );
        },
        { preconnect: () => undefined },
      ),
    });
    try {
      await source.searchPeople!({ limit: 2 });
      throw Error("Expected rejection");
    } catch (error) {
      if (!isPersonSearchPartialError(error)) throw error;
      expect(error.result.revealsConfirmed).toBe(rejectAfter);
      expect(error.result.people).toHaveLength(rejectAfter);
      expect(error.result.outcomes?.at(-1)?.status).toBe("rejected");
    }
  });
