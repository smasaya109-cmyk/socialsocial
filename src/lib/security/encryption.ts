import crypto from "node:crypto";

type CipherPayload = {
  keyVersion: number;
  iv: string;
  tag: string;
  ciphertext: string;
};

const ALGO = "aes-256-gcm";

function parseKeyRing(): Record<number, Buffer> {
  const raw = process.env.TOKEN_ENCRYPTION_KEYS_JSON;
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEYS_JSON is required");
  }

  const parsed = JSON.parse(raw) as Record<string, string>;
  const keyRing: Record<number, Buffer> = {};

  for (const [version, keyBase64] of Object.entries(parsed)) {
    const key = Buffer.from(keyBase64, "base64");
    if (key.length !== 32) {
      throw new Error(`Encryption key version ${version} must be 32 bytes`);
    }
    keyRing[Number(version)] = key;
  }

  return keyRing;
}

function getActiveKeyVersion(): number {
  const raw = process.env.TOKEN_ACTIVE_KEY_VERSION;
  if (!raw) {
    throw new Error("TOKEN_ACTIVE_KEY_VERSION is required");
  }
  return Number(raw);
}

export function encryptSecret(secret: string): { encrypted: string; keyVersion: number } {
  const keyRing = parseKeyRing();
  const keyVersion = getActiveKeyVersion();
  const key = keyRing[keyVersion];
  if (!key) {
    throw new Error(`Missing encryption key for version ${keyVersion}`);
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload: CipherPayload = {
    keyVersion,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };

  return {
    encrypted: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
    keyVersion
  };
}

export function decryptSecret(encrypted: string): string {
  const keyRing = parseKeyRing();
  const payload = JSON.parse(Buffer.from(encrypted, "base64").toString("utf8")) as CipherPayload;
  const key = keyRing[payload.keyVersion];
  if (!key) {
    throw new Error(`Missing decryption key for version ${payload.keyVersion}`);
  }

  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}
