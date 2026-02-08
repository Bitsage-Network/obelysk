/**
 * In-memory rate limiter
 * Limits requests per owner address within a sliding window.
 */

import { config } from "./config";

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const limits = new Map<string, RateLimitEntry>();

/**
 * Check if an owner address is rate-limited.
 * Returns true if the request is allowed, false if rate-limited.
 */
export function checkRateLimit(ownerAddress: string): boolean {
  const now = Date.now();
  const key = ownerAddress.toLowerCase();

  const entry = limits.get(key);
  if (!entry) {
    limits.set(key, { count: 1, windowStart: now });
    return true;
  }

  // Check if window has expired
  if (now - entry.windowStart > config.rateLimitWindowMs) {
    limits.set(key, { count: 1, windowStart: now });
    return true;
  }

  // Within window — check count
  if (entry.count >= config.rateLimitMax) {
    return false;
  }

  entry.count += 1;
  return true;
}

/**
 * Get remaining requests for an owner address
 */
export function getRemainingRequests(ownerAddress: string): number {
  const now = Date.now();
  const key = ownerAddress.toLowerCase();
  const entry = limits.get(key);

  if (!entry || now - entry.windowStart > config.rateLimitWindowMs) {
    return config.rateLimitMax;
  }

  return Math.max(0, config.rateLimitMax - entry.count);
}
