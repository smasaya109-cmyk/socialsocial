const MAX_BODY_LOG_CHARS = 120;

export function redactToken(value: string | null | undefined): string {
  if (!value) return "[redacted]";
  if (value.length < 8) return "[redacted]";
  return `${value.slice(0, 4)}...[redacted]...${value.slice(-2)}`;
}

export function redactSignedUrl(value: string | null | undefined): string {
  if (!value) return "[redacted-url]";
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}?[redacted_query]`;
  } catch {
    return "[redacted-url]";
  }
}

export function redactObjectKey(value: string | null | undefined): string {
  if (!value) return "[redacted-key]";
  if (value.length <= 20) return "[redacted-key]";
  return `${value.slice(0, 8)}...[redacted]...${value.slice(-8)}`;
}

export function redactBody(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length <= MAX_BODY_LOG_CHARS) {
    return `${value.slice(0, 32)}...[redacted]`;
  }
  return `${value.slice(0, 64)}...[redacted:${value.length - 64} chars]`;
}
