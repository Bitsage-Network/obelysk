/**
 * Relay Microservice — Express server entry point
 *
 * Provides identity-hiding transaction submission for the Obelysk Dark Pool.
 * Users sign an OutsideExecution payload, send it here, and the relay
 * submits the transaction using its own funded account.
 */

import express from "express";
import cors from "cors";
import { config, validateConfig } from "./config";
import { validatePayload } from "./validation";
import { submitRelay, getRelayerBalance } from "./relay";
import { initStore, getNonceStore, getRateLimitStore, shutdownStore } from "./store";

const app = express();
const startTime = Date.now();
let pendingTxCount = 0;

// Initialize persistent store (Redis or in-memory fallback)
const { nonceStore, rateLimitStore } = initStore();

// Middleware — restricted CORS, request size limit, API key auth
const ALLOWED_ORIGINS = [
  "https://obelysk.xyz",
  "https://www.obelysk.xyz",
  /^https:\/\/.*\.obelysk\.xyz$/,
];
if (process.env.NODE_ENV === "development") {
  ALLOWED_ORIGINS.push("http://localhost:3000" as unknown as RegExp);
}

app.use(
  cors({
    origin: ALLOWED_ORIGINS as (string | RegExp)[],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "X-Api-Key", "Authorization"],
  })
);
app.use(express.json({ limit: "100kb" }));

// API key authentication middleware
function requireApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const apiKey = config.apiKey;
  if (!apiKey) return next(); // No key configured = open (dev mode only)

  const provided =
    req.headers["x-api-key"] ||
    (req.headers["authorization"] as string)?.replace("Bearer ", "");

  if (provided === apiKey) return next();

  res.status(401).json({ status: "error", error: "Unauthorized" });
}

// ==========================================================================
// Health check
// ==========================================================================

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: Math.floor((Date.now() - startTime) / 1000) });
});

// ==========================================================================
// Status (detailed)
// ==========================================================================

app.get("/status", async (_req, res) => {
  const balance = await getRelayerBalance();
  res.json({
    relayerBalance: balance,
    pendingTxs: pendingTxCount,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    darkPoolAddress: config.darkPoolAddress,
    rateLimitMax: config.rateLimitMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
  });
});

// ==========================================================================
// Relay endpoint
// ==========================================================================

app.post("/relay", requireApiKey, async (req, res) => {
  // 1. Validate payload
  const { valid, error, payload } = validatePayload(req.body);
  if (!valid || !payload) {
    res.status(400).json({ status: "error", error, transactionHash: "" });
    return;
  }

  // 2. Nonce replay protection
  const nonce = payload.outsideExecution.nonce;
  if (await nonceStore.hasNonce(nonce)) {
    res.status(409).json({
      status: "error",
      error: "Nonce already used (replay detected)",
      transactionHash: "",
    });
    return;
  }

  // 3. Check rate limit before processing
  const remaining = await rateLimitStore.remaining(payload.ownerAddress);
  if (remaining <= 0) {
    res.status(429).json({
      status: "error",
      error: "Rate limit exceeded. Try again in a few minutes.",
      transactionHash: "",
    });
    return;
  }

  // 4. Mark nonce as used + increment rate limit (atomic before submission)
  await nonceStore.addNonce(nonce);
  await rateLimitStore.increment(payload.ownerAddress);

  // 5. Submit via relay — return tx hash immediately, don't block on confirmation
  pendingTxCount++;
  try {
    const result = await submitRelay(payload);
    res.status(result.status === "submitted" ? 200 : 500).json(result);
  } catch (err) {
    res.status(500).json({
      status: "error",
      error: err instanceof Error ? err.message : "Internal relay error",
      transactionHash: "",
    });
  } finally {
    pendingTxCount = Math.max(0, pendingTxCount - 1);
  }
});

// ==========================================================================
// Transaction status polling endpoint
// ==========================================================================

app.get("/status/:txHash", async (req, res) => {
  try {
    const { RpcProvider } = await import("starknet");
    const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
    const receipt = await provider.getTransactionReceipt(req.params.txHash);
    res.json({
      txHash: req.params.txHash,
      status: receipt.statusReceipt || "RECEIVED",
    });
  } catch {
    res.json({
      txHash: req.params.txHash,
      status: "NOT_FOUND",
    });
  }
});

// ==========================================================================
// Start server
// ==========================================================================

validateConfig();

const server = app.listen(config.port, () => {
  console.log(`[Relay] Obelysk Dark Pool Relay Service`);
  console.log(`[Relay] Listening on port ${config.port}`);
  console.log(`[Relay] Dark Pool: ${config.darkPoolAddress}`);
  console.log(`[Relay] Relayer: ${config.relayAccountAddress || "(not configured)"}`);
  console.log(`[Relay] Rate limit: ${config.rateLimitMax} req / ${config.rateLimitWindowMs / 1000}s per owner`);
});

// Graceful shutdown — close Redis connection
function shutdown() {
  console.log("[Relay] Shutting down...");
  server.close(() => {
    shutdownStore().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 5000);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
