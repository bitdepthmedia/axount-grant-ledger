const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "new",
  "amend",
  "including",
  "includes",
  "students",
  "student",
  "school",
  "district",
  "city",
  "of",
  "inc",
  "company",
  "group",
  "services",
  "materials",
  "supplies",
  "instructional",
  "inst",
  "imp",
]);

export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function significantTokens(value: unknown): Set<string> {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length > 2 && !STOPWORDS.has(token)),
  );
}

export function tokenOverlap(a: unknown, b: unknown): string[] {
  const left = significantTokens(a);
  const right = significantTokens(b);
  return [...left].filter((token) => right.has(token));
}
