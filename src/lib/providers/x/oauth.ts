import crypto from "node:crypto";

export function createPkceVerifier(length = 64): string {
  const bytes = crypto.randomBytes(length);
  return toBase64Url(bytes).slice(0, length);
}

export function createPkceChallenge(verifier: string): string {
  const digest = crypto.createHash("sha256").update(verifier).digest();
  return toBase64Url(digest);
}

export function createOauthState(): string {
  return toBase64Url(crypto.randomBytes(24));
}

export function buildXAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: input.scope,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256"
  });
  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

function toBase64Url(value: Buffer): string {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

