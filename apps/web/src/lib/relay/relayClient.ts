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

export class RelayClient {
  private baseUrl: string;

  constructor(relayUrl: string) {
    // Strip trailing slash
    this.baseUrl = relayUrl.replace(/\/$/, "");
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

    const response = await fetch(`${this.baseUrl}/relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "Unknown error");
      throw new Error(`Relay error (${response.status}): ${errBody}`);
    }

    const result: RelayResult = await response.json();
    if (result.status === "error") {
      throw new Error(result.error || "Relay submission failed");
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
