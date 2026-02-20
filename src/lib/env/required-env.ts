const seenScopes = new Set<string>();

export function getMissingEnv(names: string[]): string[] {
  return names.filter((name) => !process.env[name]);
}

export function logMissingEnv(scope: string, names: string[]) {
  const missing = getMissingEnv(names);
  if (missing.length === 0) return;
  const key = `${scope}:${missing.join(",")}`;
  if (seenScopes.has(key)) return;
  seenScopes.add(key);
  console.error(`[env] missing required env vars in ${scope}: ${missing.join(", ")}`);
}

export function assertRequiredEnv(scope: string, names: string[]) {
  const missing = getMissingEnv(names);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars in ${scope}: ${missing.join(", ")}`);
  }
}
