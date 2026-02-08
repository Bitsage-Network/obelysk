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
import { getRemainingRequests } from "./rateLimiter";

const app = express();
const startTime = Date.now();
let pendingTxCount = 0;

// Middleware
app.use(cors());
app.use(express.json());

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

app.post("/relay", async (req, res) => {
  // 1. Validate payload
  const { valid, error, payload } = validatePayload(req.body);
  if (!valid || !payload) {
    res.status(400).json({ status: "error", error, transactionHash: "" });
    return;
  }

  // 2. Check rate limit before processing
  const remaining = getRemainingRequests(payload.ownerAddress);
  if (remaining <= 0) {
    res.status(429).json({
      status: "error",
      error: "Rate limit exceeded. Try again in a few minutes.",
      transactionHash: "",
    });
    return;
  }

  // 3. Submit via relay
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
// Start server
// ==========================================================================

validateConfig();

app.listen(config.port, () => {
  console.log(`[Relay] Obelysk Dark Pool Relay Service`);
  console.log(`[Relay] Listening on port ${config.port}`);
  console.log(`[Relay] Dark Pool: ${config.darkPoolAddress}`);
  console.log(`[Relay] Relayer: ${config.relayAccountAddress || "(not configured)"}`);
  console.log(`[Relay] Rate limit: ${config.rateLimitMax} req / ${config.rateLimitWindowMs / 1000}s per owner`);
});
