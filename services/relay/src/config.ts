/**
 * Relay service configuration
 * All values are loaded from environment variables with sensible defaults.
 */

export const config = {
  port: parseInt(process.env.PORT || "3001", 10),

  // Starknet
  rpcUrl: process.env.RPC_URL || "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/demo",
  relayPrivateKey: process.env.RELAY_PRIVATE_KEY || "",
  relayAccountAddress: process.env.RELAY_ACCOUNT_ADDRESS || "",
  darkPoolAddress: process.env.DARK_POOL_ADDRESS || "0x03534599fbdfc28e12148560363fbe2551a6dfdea9901a9189f27e1f22b4ef94",

  // Authentication
  apiKey: process.env.RELAY_API_KEY || "",

  // Rate limiting
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || "20", 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "300000", 10), // 5 minutes

  // Redis (optional — falls back to in-memory if not set)
  redisUrl: process.env.REDIS_URL || "",
};

export function validateConfig(): void {
  if (!config.relayPrivateKey) {
    console.warn("[Relay] RELAY_PRIVATE_KEY not set — relay will not be able to submit transactions");
  }
  if (!config.relayAccountAddress) {
    console.warn("[Relay] RELAY_ACCOUNT_ADDRESS not set — relay will not be able to submit transactions");
  }
}
