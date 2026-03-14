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
  },
  INSTAGRAM_MEDIA_REQUIRED: {
    code: "INSTAGRAM_MEDIA_REQUIRED",
    title: "Instagram media is required",
    message: "Instagram publishing needs an image or video asset. Attach media and retry.",
    retryable: false
  },
  INSTAGRAM_UNAUTHORIZED: {
    code: "INSTAGRAM_UNAUTHORIZED",
    title: "Instagram authorization failed",
    message: "Instagram authorization is invalid or expired. Reconnect your Instagram account and retry.",
    retryable: true
  },
  INSTAGRAM_SCOPE_MISSING: {
    code: "INSTAGRAM_SCOPE_MISSING",
    title: "Instagram scope is missing",
    message: "The Instagram connection is missing required permissions. Reconnect and retry.",
    retryable: true
  },
  INSTAGRAM_RATE_LIMIT: {
    code: "INSTAGRAM_RATE_LIMIT",
    title: "Instagram rate limited",
    message: "Instagram rate limit exceeded. Retry after a short wait.",
    retryable: true
  },
  INSTAGRAM_VIDEO_PROCESSING_TIMEOUT: {
    code: "INSTAGRAM_VIDEO_PROCESSING_TIMEOUT",
    title: "Instagram video processing timeout",
    message: "Instagram is still processing the video. Retry after a short wait.",
    retryable: true
  },
  INSTAGRAM_VIDEO_PROCESSING_FAILED: {
    code: "INSTAGRAM_VIDEO_PROCESSING_FAILED",
    title: "Instagram video processing failed",
    message: "Instagram could not process the uploaded video. Check format and retry.",
    retryable: true
  },
  THREADS_UNAUTHORIZED: {
    code: "THREADS_UNAUTHORIZED",
    title: "Threads authorization failed",
    message: "Threads authorization is invalid or expired. Reconnect your Threads account and retry.",
    retryable: true
  },
  THREADS_SCOPE_MISSING: {
    code: "THREADS_SCOPE_MISSING",
    title: "Threads scope is missing",
    message: "The Threads connection is missing required permissions. Reconnect and retry.",
    retryable: true
  },
  THREADS_RATE_LIMIT: {
    code: "THREADS_RATE_LIMIT",
    title: "Threads rate limited",
    message: "Threads rate limit exceeded. Retry after a short wait.",
    retryable: true
  },
  THREADS_VIDEO_INVALID: {
    code: "THREADS_VIDEO_INVALID",
    title: "Threads video rejected",
    message: "Threads rejected the video media. Check format and retry.",
    retryable: true
  },
  THREADS_VIDEO_NOT_READY: {
    code: "THREADS_VIDEO_NOT_READY",
    title: "Threads video is still preparing",
    message: "Threads is still preparing the video. Retry after a short wait.",
    retryable: true
  },
  THREADS_VIDEO_PROCESSING_TIMEOUT: {
    code: "THREADS_VIDEO_PROCESSING_TIMEOUT",
    title: "Threads video processing timeout",
    message: "Threads is still processing the video. Retry after a short wait.",
    retryable: true
  },
  THREADS_VIDEO_PROCESSING_FAILED: {
    code: "THREADS_VIDEO_PROCESSING_FAILED",
    title: "Threads video processing failed",
    message: "Threads could not process the uploaded video. Check format and retry.",
    retryable: true
  },
  THREADS_IMAGE_INVALID: {
    code: "THREADS_IMAGE_INVALID",
    title: "Threads image rejected",
    message: "Threads rejected the image media. Check format and retry.",
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
