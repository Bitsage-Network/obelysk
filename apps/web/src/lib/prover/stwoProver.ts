/**
 * STWO GPU Prover Service
 *
 * Client for interacting with BitSage prover nodes running STWO 2.0.0
 * with GPU acceleration (ICICLE backend).
 *
 * Proof Types:
 * - Range Proof: Proves amount is in valid range [0, 2^64]
 * - Balance Proof: Proves sender has sufficient encrypted balance
 * - Transfer Proof: Proves valid state transition for private transfer
 *
 * STWO Benefits:
 * - 100x faster than Stone prover
 * - 28x faster than competing ZK VMs
 * - M31 field (125x faster multiplication)
 * - Circle STARK protocol
 * - GPU acceleration via ICICLE (3.25x-7x speedup)
 *
 * @see https://github.com/starkware-libs/stwo
 * @see https://crates.io/crates/stwo
 */

import type { ECPoint } from "@/lib/crypto";

// ============================================================================
// TYPES
// ============================================================================

export type ProofType = "range" | "balance" | "transfer";

export interface ProverConfig {
  /** Prover API endpoint */
  apiUrl: string;
  /** Minimum security bits required (default: 96) */
  minSecurityBits: number;
  /** Request timeout in ms (default: 120000 for 2 min) */
  timeout: number;
  /** Whether to use GPU acceleration */
  useGpu: boolean;
}

export interface ProofResult {
  /** Fact hash for on-chain verification via Integrity */
  factHash: string;
  /** Time taken to generate proof in ms */
  proofTime: number;
  /** Security bits achieved */
  securityBits: number;
  /** Whether GPU was used */
  usedGpu: boolean;
  /** Prover node ID */
  proverId: string;
  /** Serialized proof data (for debugging) */
  proofData?: string;
}

export interface ProofProgress {
  /** Current stage */
  stage: "queued" | "preparing" | "proving" | "verifying" | "complete";
  /** Progress percentage (0-100) */
  progress: number;
  /** Estimated time remaining in ms */
  estimatedTimeRemaining: number;
  /** Current substage (e.g., "FRI layer 3/8") */
  substage?: string;
}

// Range Proof Input
export interface RangeProofInput {
  /** Pedersen commitment to the amount */
  commitment: ECPoint;
  /** Opening (randomness used in commitment) */
  opening: bigint;
  /** Amount being proven */
  amount: bigint;
  /** Maximum allowed value (default: 2^64) */
  maxValue?: bigint;
}

// Balance Proof Input
export interface BalanceProofInput {
  /** Encrypted balance (ElGamal ciphertext) */
  encryptedBalance: {
    c1: ECPoint;
    c2: ECPoint;
  };
  /** Amount being spent */
  amount: bigint;
  /** Nullifier for double-spend prevention */
  nullifier: string;
  /** Private key for decryption (never sent to prover) */
  privateKey?: never; // Type guard - never include private key
}

// Transfer Proof Input
export interface TransferProofInput {
  /** Sender's encrypted balance before transfer */
  senderBalanceBefore: {
    c1: ECPoint;
    c2: ECPoint;
  };
  /** Sender's encrypted balance after transfer */
  senderBalanceAfter: {
    c1: ECPoint;
    c2: ECPoint;
  };
  /** Receiver's encrypted amount */
  receiverEncryptedAmount: {
    c1: ECPoint;
    c2: ECPoint;
  };
  /** Transfer amount commitment */
  amountCommitment: ECPoint;
  /** Nullifier */
  nullifier: string;
  /** ZK proof that sender balance >= amount */
  balanceProofFactHash: string;
  /** ZK proof that amount is in valid range */
  rangeProofFactHash: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default prover API endpoints */
export const PROVER_ENDPOINTS = {
  mainnet: "https://prover.bitsage.network",
  sepolia: "https://prover.sepolia.bitsage.network",
  local: "http://localhost:8080",
} as const;

/** Default configuration */
const DEFAULT_CONFIG: ProverConfig = {
  apiUrl: PROVER_ENDPOINTS.sepolia,
  minSecurityBits: 96,
  timeout: 120000, // 2 minutes
  useGpu: true,
};

/** STWO circuit program hashes — pending deployment to Starknet Sepolia */
export const STWO_PROGRAM_HASHES = {
  rangeProof: null as string | null, // Not yet deployed
  balanceProof: null as string | null, // Not yet deployed
  transferProof: null as string | null, // Not yet deployed
};

// ============================================================================
// PROVER SERVICE
// ============================================================================

export class STWOProverService {
  private config: ProverConfig;
  private abortController: AbortController | null = null;

  constructor(config: Partial<ProverConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Request a range proof from the prover
   * Proves that a committed amount is in the range [0, maxValue]
   */
  async proveRange(input: RangeProofInput): Promise<ProofResult> {
    return this.requestProof("range", {
      commitment: this.serializeECPoint(input.commitment),
      opening: input.opening.toString(),
      amount: input.amount.toString(),
      max_value: (input.maxValue ?? BigInt(2) ** BigInt(64)).toString(),
    });
  }

  /**
   * Request a balance proof from the prover
   * Proves that encrypted balance >= amount without revealing balance
   */
  async proveBalance(input: BalanceProofInput): Promise<ProofResult> {
    return this.requestProof("balance", {
      encrypted_balance: {
        c1: this.serializeECPoint(input.encryptedBalance.c1),
        c2: this.serializeECPoint(input.encryptedBalance.c2),
      },
      amount: input.amount.toString(),
      nullifier: input.nullifier,
    });
  }

  /**
   * Request a transfer proof from the prover
   * Proves valid state transition for private transfer
   */
  async proveTransfer(input: TransferProofInput): Promise<ProofResult> {
    return this.requestProof("transfer", {
      sender_balance_before: {
        c1: this.serializeECPoint(input.senderBalanceBefore.c1),
        c2: this.serializeECPoint(input.senderBalanceBefore.c2),
      },
      sender_balance_after: {
        c1: this.serializeECPoint(input.senderBalanceAfter.c1),
        c2: this.serializeECPoint(input.senderBalanceAfter.c2),
      },
      receiver_encrypted_amount: {
        c1: this.serializeECPoint(input.receiverEncryptedAmount.c1),
        c2: this.serializeECPoint(input.receiverEncryptedAmount.c2),
      },
      amount_commitment: this.serializeECPoint(input.amountCommitment),
      nullifier: input.nullifier,
      balance_proof_fact_hash: input.balanceProofFactHash,
      range_proof_fact_hash: input.rangeProofFactHash,
    });
  }

  /**
   * Get proof generation progress via WebSocket
   */
  subscribeToProgress(
    jobId: string,
    onProgress: (progress: ProofProgress) => void
  ): () => void {
    const ws = new WebSocket(`${this.config.apiUrl.replace("http", "ws")}/ws/progress/${jobId}`);

    ws.onmessage = (event) => {
      try {
        const progress = JSON.parse(event.data) as ProofProgress;
        onProgress(progress);
      } catch (e) {
        console.error("Failed to parse progress:", e);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    // Return cleanup function
    return () => {
      ws.close();
    };
  }

  /**
   * Cancel an ongoing proof request
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Check prover node health and GPU status
   */
  async checkHealth(): Promise<{
    healthy: boolean;
    gpuAvailable: boolean;
    gpuModel?: string;
    queueDepth: number;
    avgProofTime: number;
  }> {
    try {
      const response = await fetch(`${this.config.apiUrl}/health`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        return { healthy: false, gpuAvailable: false, queueDepth: 0, avgProofTime: 0 };
      }

      return response.json();
    } catch {
      return { healthy: false, gpuAvailable: false, queueDepth: 0, avgProofTime: 0 };
    }
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async requestProof(
    proofType: ProofType,
    inputs: Record<string, unknown>
  ): Promise<ProofResult> {
    this.abortController = new AbortController();

    const startTime = Date.now();

    try {
      const response = await fetch(`${this.config.apiUrl}/prove/${proofType}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs,
          config: {
            min_security_bits: this.config.minSecurityBits,
            use_gpu: this.config.useGpu,
          },
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Prover error: ${error}`);
      }

      const result = await response.json();

      return {
        factHash: result.fact_hash,
        proofTime: Date.now() - startTime,
        securityBits: result.security_bits,
        usedGpu: result.used_gpu,
        proverId: result.prover_id,
        proofData: result.proof_data,
      };
    } finally {
      this.abortController = null;
    }
  }

  private serializeECPoint(point: ECPoint): { x: string; y: string } {
    return {
      x: typeof point.x === "bigint" ? point.x.toString() : point.x,
      y: typeof point.y === "bigint" ? point.y.toString() : point.y,
    };
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let proverInstance: STWOProverService | null = null;

/**
 * Get the singleton STWO prover instance
 */
export function getSTWOProver(config?: Partial<ProverConfig>): STWOProverService {
  if (!proverInstance || config) {
    proverInstance = new STWOProverService(config);
  }
  return proverInstance;
}

// ============================================================================
// REACT HOOK
// ============================================================================

import { useState, useCallback, useRef, useEffect } from "react";

export interface UseSTWOProverResult {
  /** Request a proof */
  prove: (type: ProofType, input: RangeProofInput | BalanceProofInput | TransferProofInput) => Promise<ProofResult>;
  /** Cancel ongoing proof */
  cancel: () => void;
  /** Current progress */
  progress: ProofProgress | null;
  /** Loading state */
  isProving: boolean;
  /** Error if proof failed */
  error: Error | null;
  /** Last proof result */
  lastResult: ProofResult | null;
  /** Prover health status */
  health: { healthy: boolean; gpuAvailable: boolean } | null;
}

export function useSTWOProver(config?: Partial<ProverConfig>): UseSTWOProverResult {
  const proverRef = useRef<STWOProverService>(getSTWOProver(config));
  const [progress, setProgress] = useState<ProofProgress | null>(null);
  const [isProving, setIsProving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastResult, setLastResult] = useState<ProofResult | null>(null);
  const [health, setHealth] = useState<{ healthy: boolean; gpuAvailable: boolean } | null>(null);

  // Check health on mount
  useEffect(() => {
    proverRef.current.checkHealth().then(setHealth);
  }, []);

  const prove = useCallback(async (
    type: ProofType,
    input: RangeProofInput | BalanceProofInput | TransferProofInput
  ): Promise<ProofResult> => {
    setIsProving(true);
    setError(null);
    setProgress({ stage: "queued", progress: 0, estimatedTimeRemaining: 30000 });

    try {
      let result: ProofResult;

      switch (type) {
        case "range":
          result = await proverRef.current.proveRange(input as RangeProofInput);
          break;
        case "balance":
          result = await proverRef.current.proveBalance(input as BalanceProofInput);
          break;
        case "transfer":
          result = await proverRef.current.proveTransfer(input as TransferProofInput);
          break;
        default:
          throw new Error(`Unknown proof type: ${type}`);
      }

      setLastResult(result);
      setProgress({ stage: "complete", progress: 100, estimatedTimeRemaining: 0 });
      return result;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      throw err;
    } finally {
      setIsProving(false);
    }
  }, []);

  const cancel = useCallback(() => {
    proverRef.current.cancel();
    setIsProving(false);
    setProgress(null);
  }, []);

  return {
    prove,
    cancel,
    progress,
    isProving,
    error,
    lastResult,
    health,
  };
}
