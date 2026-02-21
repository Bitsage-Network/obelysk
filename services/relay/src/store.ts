/**
 * Persistent store for nonce tracking and rate limiting.
 *
 * Uses Redis when REDIS_URL is configured, falls back to in-memory
 * for local development. Both backends expose the same interface.
 */

import Redis from "ioredis";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface NonceStore {
  /** Returns true if the nonce was already used. */
  hasNonce(nonce: string): Promise<boolean>;
  /** Marks a nonce as used. TTL ensures automatic cleanup. */
  addNonce(nonce: string): Promise<void>;
}

export interface RateLimitStore {
  /** Increment the request count for an owner. Returns the new count. */
  increment(ownerAddress: string): Promise<number>;
  /** Get remaining requests for an owner. */
  remaining(ownerAddress: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const NONCE_TTL_SECONDS = 86400; // 24 hours — nonces expire after this
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "20", 10);
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "300000", 10);
const RATE_LIMIT_WINDOW_S = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);

// ---------------------------------------------------------------------------
// Redis backend
// ---------------------------------------------------------------------------

class RedisNonceStore implements NonceStore {
  constructor(private redis: Redis) {}

  async hasNonce(nonce: string): Promise<boolean> {
    const exists = await this.redis.exists(`nonce:${nonce}`);
    return exists === 1;
  }

  async addNonce(nonce: string): Promise<void> {
    await this.redis.set(`nonce:${nonce}`, "1", "EX", NONCE_TTL_SECONDS);
  }
}

class RedisRateLimitStore implements RateLimitStore {
  constructor(private redis: Redis) {}

  async increment(ownerAddress: string): Promise<number> {
    const key = `rl:${ownerAddress.toLowerCase()}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, RATE_LIMIT_WINDOW_S);
    }
    return count;
  }

  async remaining(ownerAddress: string): Promise<number> {
    const key = `rl:${ownerAddress.toLowerCase()}`;
    const count = parseInt((await this.redis.get(key)) || "0", 10);
    return Math.max(0, RATE_LIMIT_MAX - count);
  }
}

// ---------------------------------------------------------------------------
// In-memory fallback (development)
// ---------------------------------------------------------------------------

class MemoryNonceStore implements NonceStore {
  private nonces = new Map<string, number>();

  async hasNonce(nonce: string): Promise<boolean> {
    this.prune();
    return this.nonces.has(nonce);
  }

  async addNonce(nonce: string): Promise<void> {
    this.prune();
    this.nonces.set(nonce, Date.now());
  }

  private prune(): void {
    if (this.nonces.size <= 50000) return;
    const cutoff = Date.now() - NONCE_TTL_SECONDS * 1000;
    for (const [k, ts] of this.nonces) {
      if (ts < cutoff) this.nonces.delete(k);
    }
  }
}

class MemoryRateLimitStore implements RateLimitStore {
  private entries = new Map<string, { count: number; windowStart: number }>();

  async increment(ownerAddress: string): Promise<number> {
    const now = Date.now();
    const key = ownerAddress.toLowerCase();
    const entry = this.entries.get(key);

    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      this.entries.set(key, { count: 1, windowStart: now });
      return 1;
    }

    entry.count += 1;
    return entry.count;
  }

  async remaining(ownerAddress: string): Promise<number> {
    const now = Date.now();
    const key = ownerAddress.toLowerCase();
    const entry = this.entries.get(key);

    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      return RATE_LIMIT_MAX;
    }

    return Math.max(0, RATE_LIMIT_MAX - entry.count);
  }
}

// ---------------------------------------------------------------------------
// Factory — connect to Redis or fall back to in-memory
// ---------------------------------------------------------------------------

let redis: Redis | null = null;
let nonceStore: NonceStore;
let rateLimitStore: RateLimitStore;

export function initStore(): { nonceStore: NonceStore; rateLimitStore: RateLimitStore } {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 5) return null; // stop retrying
        return Math.min(times * 200, 2000);
      },
    });

    redis.on("connect", () => console.log("[Store] Redis connected"));
    redis.on("error", (err) => console.error("[Store] Redis error:", err.message));

    redis.connect().catch((err) => {
      console.error("[Store] Redis connection failed, falling back to in-memory:", err.message);
      nonceStore = new MemoryNonceStore();
      rateLimitStore = new MemoryRateLimitStore();
    });

    nonceStore = new RedisNonceStore(redis);
    rateLimitStore = new RedisRateLimitStore(redis);
    console.log("[Store] Using Redis backend");
  } else {
    nonceStore = new MemoryNonceStore();
    rateLimitStore = new MemoryRateLimitStore();
    console.log("[Store] Using in-memory backend (set REDIS_URL for persistence)");
  }

  return { nonceStore, rateLimitStore };
}

export function getNonceStore(): NonceStore {
  return nonceStore;
}

export function getRateLimitStore(): RateLimitStore {
  return rateLimitStore;
}

export async function shutdownStore(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
