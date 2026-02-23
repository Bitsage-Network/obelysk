/**
 * Relay Client SDK
 *
 * Client for submitting dark pool transactions through the relay service.
 * The relay submits transactions on behalf of users, hiding their identity
 * by using the relay's own account to pay gas and execute.
 *
 * Supports SNIP-9 OutsideExecution pattern for delegated execution.
 */

export interface OutsideExecution {
  caller: string;       // Relayer address or ANY_CALLER ("0x0")
  nonce: string;        // Unique nonce (felt252 hex)
  executeAfter: number; // Unix timestamp
  executeBefore: number; // Unix timestamp
  calls: RelayCall[];
}

export interface RelayCall {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
}

export interface RelayPayload {
  outsideExecution: OutsideExecution;
  signature: string[];
  ownerAddress: string;
}

export interface RelayResult {
  transactionHash: string;
  status: "submitted" | "error";
  error?: string;
}

export interface RelayHealthStatus {
  healthy: boolean;
  relayerBalance?: string;
  pendingTxs?: number;
  uptime?: number;
}

/** Check if a hostname resolves to a private/internal IP range */
function isPrivateHost(hostname: string): boolean {
  // Reject private IP ranges: 10.x, 172.16-31.x, 192.168.x, 127.x (except localhost), 0.0.0.0, ::1
  const privatePatterns = [
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^127\./,
    /^0\.0\.0\.0$/,
    /^::1$/,
    /^\[::1\]$/,
  ];
  // Allow "localhost" explicitly (dev use)
  if (hostname === "localhost") return false;
  return privatePatterns.some((p) => p.test(hostname));
}

/** Validate a relay URL: must parse, must be https (http://localhost allowed for dev), no private IPs */
function validateRelayUrl(relayUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(relayUrl);
  } catch {
    throw new Error(`Invalid relay URL: ${relayUrl}`);
  }

  // Allow http only for localhost (dev)
  if (parsed.protocol === "http:" && parsed.hostname !== "localhost") {
    throw new Error(
      "Relay URL must use HTTPS. HTTP is only allowed for localhost during development.",
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Relay URL must use HTTPS. Got: ${parsed.protocol}`);
  }

  // Reject private/internal IPs (SSRF protection)
  if (isPrivateHost(parsed.hostname)) {
    throw new Error(
      `Relay URL points to a private/internal IP (${parsed.hostname}). This is not allowed.`,
    );
  }

  return parsed.origin + parsed.pathname.replace(/\/$/, "");
}

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{1,64}$/;
const MAX_PAYLOAD_BYTES = 100_000; // 100KB — generous for any legitimate dark pool tx

export class RelayClient {
  private baseUrl: string;

  constructor(relayUrl: string) {
    this.baseUrl = validateRelayUrl(relayUrl);
  }

  /**
   * Submit a transaction via the relay service
   */
  async submitViaRelay(
    outsideExecution: OutsideExecution,
    signature: string[],
    ownerAddress: string,
  ): Promise<{ transactionHash: string }> {
    const payload: RelayPayload = {
      outsideExecution,
      signature,
      ownerAddress,
    };

    // D12: Reject oversized payloads before sending
    const body = JSON.stringify(payload);
    if (body.length > MAX_PAYLOAD_BYTES) {
      throw new Error(
        `Relay payload too large (${body.length} bytes, max ${MAX_PAYLOAD_BYTES}). Check calldata construction.`,
      );
    }

    // D2: 30s timeout — generous for relay to broadcast + get tx hash
    const response = await fetch(`${this.baseUrl}/relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "Unknown error");
      throw new Error(`Relay error (${response.status}): ${errBody}`);
    }

    const result: RelayResult = await response.json();
    if (result.status === "error") {
      throw new Error(result.error || "Relay submission failed");
    }

    // D3: Validate transactionHash shape — don't trust arbitrary JSON from relay
    if (
      typeof result.transactionHash !== "string" ||
      !TX_HASH_PATTERN.test(result.transactionHash)
    ) {
      throw new Error(
        "Relay returned invalid transaction hash. Expected 0x-prefixed hex string.",
      );
    }

    return { transactionHash: result.transactionHash };
  }

  /**
   * Check if the relay service is healthy and operational
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get detailed relay service status
   */
  async getStatus(): Promise<RelayHealthStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/status`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return { healthy: false };
      const data = await response.json();
      return { healthy: true, ...data };
    } catch {
      return { healthy: false };
    }
  }
}

/**
 * Create a RelayClient instance from environment config
 */
export function createRelayClient(): RelayClient | null {
  const relayUrl = typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_RELAY_URL || "")
    : "";
  if (!relayUrl) return null;
  return new RelayClient(relayUrl);
}
