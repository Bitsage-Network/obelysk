/**
 * Obelysk Audit Relay
 *
 * Proxies encrypted audit report uploads to Irys/Arweave.
 * Holds IRYS_TOKEN server-side so pipeline users never need their own token.
 *
 * Endpoints:
 *   POST /v1/audit/upload   — Upload audit data to Arweave via Irys
 *   GET  /v1/audit/:txId    — Check upload status
 *   GET  /health            — Health check
 *
 * Environment:
 *   IRYS_TOKEN              — Irys API token (required)
 *   IRYS_BUNDLER_URL        — Irys bundler endpoint (default: https://node1.irys.xyz)
 *   ARWEAVE_GATEWAY         — Arweave gateway (default: https://arweave.net)
 *   PORT                    — Listen port (default: 3002)
 *   RELAY_API_KEY           — Optional API key for access control
 *   MAX_UPLOAD_MB           — Max upload size in MB (default: 50)
 */

import express from "express";
import cors from "cors";
import { createHash } from "crypto";

// ─── Config ──────────────────────────────────────────────────────────

const config = {
  port: parseInt(process.env.PORT || "3002", 10),
  irysToken: process.env.IRYS_TOKEN || "",
  irysUrl: process.env.IRYS_BUNDLER_URL || "https://node1.irys.xyz",
  arweaveGateway: process.env.ARWEAVE_GATEWAY || "https://arweave.net",
  apiKey: process.env.RELAY_API_KEY || "",
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_MB || "50", 10) * 1024 * 1024,
};

if (!config.irysToken) {
  console.error("[AuditRelay] FATAL: IRYS_TOKEN not set");
  process.exit(1);
}

// API key is REQUIRED for production
if (!config.apiKey) {
  console.error("[AuditRelay] FATAL: RELAY_API_KEY not set. API key is required.");
  process.exit(1);
}

// ─── App ─────────────────────────────────────────────────────────────

const app = express();
const startTime = Date.now();

/** Upload counter for metrics */
let uploadCount = 0;
let uploadBytes = 0;

// In-memory rate limiter (per-IP, sliding window)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 uploads per minute

// Restricted CORS
const ALLOWED_ORIGINS = [
  "https://obelysk.xyz",
  "https://www.obelysk.xyz",
];
if (process.env.NODE_ENV === "development") {
  ALLOWED_ORIGINS.push("http://localhost:3000");
}

app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "X-Api-Key", "Authorization"],
  })
);

// Security headers
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.use(express.json({ limit: `${config.maxUploadBytes}b` }));
app.use(express.raw({ type: "application/octet-stream", limit: `${config.maxUploadBytes}b` }));

// ─── Auth middleware (REQUIRED) ──────────────────────────────────────

function checkAuth(req, res, next) {
  const provided =
    req.headers["x-api-key"] ||
    req.headers["authorization"]?.replace("Bearer ", "");
  if (provided === config.apiKey) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// ─── Rate limit middleware ───────────────────────────────────────────

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return next();
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: "Rate limit exceeded" });
  }

  entry.count++;
  next();
}

// ─── Health ──────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "audit-relay",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    uploads: uploadCount,
    totalBytes: uploadBytes,
    irysUrl: config.irysUrl,
  });
});

// ─── Upload ──────────────────────────────────────────────────────────

app.post("/v1/audit/upload", checkAuth, rateLimit, async (req, res) => {
  try {
    const { data, tags, audit_id, model_id } = req.body;

    if (!data) {
      return res.status(400).json({ error: "Missing 'data' field (base64-encoded audit report)" });
    }

    // Build tags
    const allTags = [
      { name: "App-Name", value: "Obelysk-Audit" },
      { name: "Content-Type", value: "application/octet-stream" },
    ];
    if (audit_id) allTags.push({ name: "Audit-ID", value: String(audit_id) });
    if (model_id) allTags.push({ name: "Model-ID", value: String(model_id) });
    if (Array.isArray(tags)) {
      for (const t of tags) {
        if (t.name && t.value) allTags.push({ name: String(t.name), value: String(t.value) });
      }
    }

    // Forward to Irys
    const irysBody = JSON.stringify({ data, tags: allTags });

    const irysRes = await fetch(`${config.irysUrl}/tx/arweave`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.irysToken}`,
      },
      body: irysBody,
    });

    const irysText = await irysRes.text();

    if (!irysRes.ok) {
      console.error(`[AuditRelay] Irys upload failed (${irysRes.status}): ${irysText.slice(0, 200)}`);
      return res.status(502).json({ error: "Audit data upload failed" });
    }

    // Parse tx_id from response
    let txId;
    try {
      const parsed = JSON.parse(irysText);
      txId = parsed.id || parsed.tx_id;
    } catch {
      // Maybe plain text tx_id
      txId = irysText.trim().replace(/"/g, "");
    }

    if (!txId) {
      return res.status(502).json({ error: "Could not parse tx_id from Irys response" });
    }

    // Compute data hash for verification
    const rawBytes = Buffer.from(data, "base64");
    const dataHash = createHash("sha256").update(rawBytes).digest("hex");

    uploadCount++;
    uploadBytes += rawBytes.length;

    console.log(
      `[AuditRelay] Upload #${uploadCount}: tx=${txId} size=${rawBytes.length} audit=${audit_id || "?"} model=${model_id || "?"}`
    );

    res.json({
      tx_id: txId,
      size_bytes: rawBytes.length,
      gateway_url: `${config.arweaveGateway}/${txId}`,
      data_hash: dataHash,
    });
  } catch (err) {
    console.error("[AuditRelay] Upload error:", err);
    res.status(500).json({ error: err.message || "Internal relay error" });
  }
});

// ─── Status ──────────────────────────────────────────────────────────

app.get("/v1/audit/:txId", async (req, res) => {
  try {
    const { txId } = req.params;
    const statusRes = await fetch(`${config.arweaveGateway}/tx/${txId}/status`);
    const statusText = await statusRes.text();

    if (!statusRes.ok) {
      return res.json({ tx_id: txId, status: "not_found" });
    }

    try {
      const parsed = JSON.parse(statusText);
      res.json({
        tx_id: txId,
        status: parsed.block_height ? "confirmed" : "pending",
        block_height: parsed.block_height || null,
      });
    } catch {
      res.json({ tx_id: txId, status: "pending" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ───────────────────────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`[AuditRelay] Obelysk Audit Relay Service`);
  console.log(`[AuditRelay] Listening on port ${config.port}`);
  console.log(`[AuditRelay] Irys bundler: ${config.irysUrl}`);
  console.log(`[AuditRelay] Arweave gateway: ${config.arweaveGateway}`);
  console.log(`[AuditRelay] Max upload: ${config.maxUploadBytes / 1024 / 1024}MB`);
  console.log(`[AuditRelay] API key: ${config.apiKey ? "configured" : "open (no key)"}`);
});
