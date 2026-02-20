function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (!setA.size || !setB.size) return 0;

  let inter = 0;
  for (const token of setA) {
    if (setB.has(token)) inter += 1;
  }
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function isSafeModeDuplicate(
  previousBody: string,
  currentBody: string,
  threshold = 0.9
): boolean {
  return jaccardSimilarity(previousBody, currentBody) >= threshold;
}
