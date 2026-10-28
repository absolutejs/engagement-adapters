import type { NormalizedCompany } from "./index";

export const companyWebsiteDomain = (
  value: string | null | undefined,
): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.hostname.toLowerCase().replace(/^www\./u, "")
      : null;
  } catch {
    return null;
  }
};
const words = (name: string) =>
  name
    .normalize("NFKC")
    .toLowerCase()
    .replace(
      /\b(?:incorporated|inc|limited|ltd|llc|corporation|corp|plc)\b/gu,
      "",
    )
    .match(/[\p{L}\p{N}]+/gu) ?? [];
/** A brand alias is accepted only on the independently returned exact domain.
 * Parent records, sibling domains and similar substrings never pass. */
export const companyIdentityMatch = (
  company: NormalizedCompany | null,
  name: string,
  website: string,
): "exact" | "domain_brand_alias" | null => {
  const expectedDomain = companyWebsiteDomain(website);
  if (
    !company?.name ||
    !expectedDomain ||
    companyWebsiteDomain(company.domain) !== expectedDomain
  )
    return null;
  const expected = words(name),
    actual = words(company.name);
  if (!expected.length || !actual.length) return null;
  if (expected.join("") === actual.join("")) return "exact";
  const shorter = expected.length < actual.length ? expected : actual;
  const longer = expected.length < actual.length ? actual : expected;
  return shorter.join("").length >= 3 &&
    shorter.every((word, index) => longer[index] === word)
    ? "domain_brand_alias"
    : null;
};
/** Ambiguous records are not resolved by selecting the highest revenue. */
export const selectCompanyIdentity = (
  companies: NormalizedCompany[],
  name: string,
  website: string,
): NormalizedCompany | null => {
  const matches = companies.filter((company) =>
    companyIdentityMatch(company, name, website),
  );
  const unique = new Map(
    matches.map((company) => [
      company.providerId ?? `${company.domain}:${company.name}`,
      company,
    ]),
  );
  return unique.size === 1 ? ([...unique.values()][0] ?? null) : null;
};
