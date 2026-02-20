import crypto from "node:crypto";

export class InternalAuthError extends Error {
  status: number;

  constructor() {
    super("Unauthorized");
    this.status = 401;
  }
}

export class InternalAuthConfigError extends Error {
  status: number;

  constructor() {
    super("Service misconfigured");
    this.status = 503;
  }
}

export function requireInternalApiKey(request: Request) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    throw new InternalAuthConfigError();
  }

  const provided = request.headers.get("x-internal-api-key");
  if (!provided) {
    throw new InternalAuthError();
  }

  const left = Buffer.from(provided, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new InternalAuthError();
  }
}
