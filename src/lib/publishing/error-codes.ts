export type PublishErrorMeta = {
  code: string;
  title: string;
  message: string;
  retryable: boolean;
};

const DEFAULT_META: PublishErrorMeta = {
  code: "UNKNOWN",
  title: "Publish failed",
  message: "The post could not be published. Please retry after checking provider settings.",
  retryable: true
};

const META_BY_CODE: Record<string, PublishErrorMeta> = {
  X_CREDITS_DEPLETED: {
    code: "X_CREDITS_DEPLETED",
    title: "X API credits depleted",
    message: "Your X API credits are depleted. Add credits or upgrade your X plan, then retry.",
    retryable: true
  },
  X_UNAUTHORIZED: {
    code: "X_UNAUTHORIZED",
    title: "X authorization failed",
    message: "X authorization is invalid or expired. Reconnect your X account and retry.",
    retryable: true
  },
  X_SCOPE_MISSING: {
    code: "X_SCOPE_MISSING",
    title: "X scope is missing",
    message: "The X connection is missing required permissions (tweet.write). Reconnect and retry.",
    retryable: true
  },
  X_RATE_LIMIT: {
    code: "X_RATE_LIMIT",
    title: "X rate limited",
    message: "X rate limit exceeded. Retry after a short wait.",
    retryable: true
  }
};

export function getPublishErrorMeta(code: string | null | undefined): PublishErrorMeta | null {
  if (!code) return null;
  return META_BY_CODE[code] ?? {
    ...DEFAULT_META,
    code
  };
}

