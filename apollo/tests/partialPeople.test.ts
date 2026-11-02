import { expect, test } from "bun:test";
import { isPersonSearchPartialError } from "@absolutejs/engagement";
import { apolloSource } from "../src";
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const person = (domain = "example.com") => ({
  name: "Jane Smith",
  title: "Head of Partnerships",
  organization: { name: "Example", primary_domain: domain },
});
test("a later reveal failure retains confirmed accounting and people and stops further dispatch", async () => {
  const ids: string[] = [];
  const source = apolloSource({
    apiKey: "fixture",
    fetchImpl: async (input, init) => {
      if (String(input).endsWith("api_search"))
        return response({ people: [{ id: "a" }, { id: "b" }, { id: "c" }] });
      const id = JSON.parse(String(init?.body)).id;
      ids.push(id);
      return id === "a"
        ? response({ person: person() })
        : response({ error: "private body" }, 503);
    },
  });
  try {
    await source.searchPeople?.({ domain: "example.com", limit: 3 });
    throw Error("Expected failure");
  } catch (error) {
    expect(isPersonSearchPartialError(error)).toBe(true);
    if (!isPersonSearchPartialError(error)) throw error;
    expect(error.result).toMatchObject({
      revealsAttempted: 2,
      revealsConfirmed: 1,
      searchRequests: 1,
      outcomes: [
        { id: "a", status: "fulfilled" },
        { id: "b", status: "unknown" },
      ],
    });
    expect(error.result.people[0]?.name).toBe("Jane Smith");
    expect(error.message).not.toContain("private body");
  }
  expect(ids).toEqual(["a", "b"]);
});
test("one acceptable employer-verified contact stops extra reveals, while mismatched employers do not", async () => {
  for (const firstMatches of [true, false]) {
    const ids: string[] = [];
    const source = apolloSource({
      apiKey: "fixture",
      fetchImpl: async (input, init) => {
        if (String(input).endsWith("api_search"))
          return response({ people: [{ id: "a" }, { id: "b" }, { id: "c" }] });
        const id = JSON.parse(String(init?.body)).id;
        ids.push(id);
        return response({
          person: person(
            id === "a" && !firstMatches ? "unrelated.com" : "example.com",
          ),
        });
      },
    });
    const result = await source.searchPeople?.({
      domain: "example.com",
      limit: 3,
      maxMatches: 1,
      requireEmployerMatch: true,
    });
    expect(ids).toEqual(firstMatches ? ["a"] : ["a", "b"]);
    expect(result?.revealsConfirmed).toBe(ids.length);
  }
});
