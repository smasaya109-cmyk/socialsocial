import { Redis } from "@upstash/redis";

const LOCK_TTL_SECONDS = 60;

function getRedisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("Upstash env vars are missing");
  }
  return new Redis({ url, token });
}

export async function acquireRedisLock(lockKey: string, ttlSeconds = LOCK_TTL_SECONDS): Promise<boolean> {
  const redis = getRedisClient();
  const result = await redis.set(lockKey, "1", {
    nx: true,
    ex: ttlSeconds
  });
  return result === "OK";
}

export async function releaseRedisLock(lockKey: string): Promise<void> {
  const redis = getRedisClient();
  await redis.del(lockKey);
}

export async function acquireIdempotencyLock(
  idempotencyKey: string,
  ttlSeconds = LOCK_TTL_SECONDS
): Promise<boolean> {
  return acquireRedisLock(`post-lock:${idempotencyKey}`, ttlSeconds);
}
