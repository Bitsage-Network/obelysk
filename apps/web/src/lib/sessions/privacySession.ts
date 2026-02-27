/**
 * Privacy Session Keys
 *
 * Session key management for privacy operations based on starknet-agentic patterns.
 * Allows time-bounded, spending-limited privacy operations without repeated wallet signatures.
 *
 * Features:
 * - Time-bounded sessions (default 24 hours)
 * - Per-transaction spending limits
 * - Daily spending limits
 * - Operation whitelisting (deposit, transfer, withdraw)
 * - Automatic session refresh
 * - Wallet signature verification (EIP-712 style)
 * - Optional on-chain registration via SESSION_MANAGER contract
 *
 * @see https://github.com/keep-starknet-strange/starknet-agentic
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { useAccount, useSendTransaction, useProvider } from "@starknet-react/core";
import type { Call, AccountInterface } from "starknet";
import { ec, hash, RpcProvider, type TypedData } from "starknet";
import { CONTRACTS, getRpcUrl, getStarknetChainId, type NetworkType } from "@/lib/contracts/addresses";

// ============================================================================
// TYPES
// ============================================================================

export interface PrivacySessionPolicy {
  /** Session expiry time (Unix timestamp) */
  validUntil: number;
  /** Session start time (Unix timestamp) */
  validAfter: number;

  /** Maximum amount per transaction (in wei) */
  maxTransferPerTx: bigint;
  /** Maximum amount per day (in wei) */
  maxTransferPerDay: bigint;
  /** Maximum withdrawal amount per day (in wei) */
  maxWithdrawPerDay: bigint;

  /** Allowed operations */
  canDeposit: boolean;
  canTransfer: boolean;
  canWithdraw: boolean;
  canRagequit: boolean;

  /** Allowed recipient addresses (empty = all allowed) */
  allowedRecipients: string[];
  /** Allowed token IDs */
  allowedTokens: string[];
}

export interface PrivacySession {
  /** Session ID (Poseidon hash) */
  id: string;
  /** Session key (public - Stark curve) */
  sessionKey: string;
  /** Policy defining session bounds */
  policy: PrivacySessionPolicy;
  /** Whether session is active */
  isActive: boolean;
  /** Amount spent today */
  dailySpent: bigint;
  /** Amount withdrawn today */
  dailyWithdrawn: bigint;
  /** Creation timestamp */
  createdAt: number;
  /** Last used timestamp */
  lastUsed: number;
  /** Wallet signature authorizing this session (EIP-712 style) */
  walletSignature?: string[];
  /** Whether session is registered on-chain */
  isOnChain: boolean;
  /** On-chain transaction hash (if registered) */
  onChainTxHash?: string;
}

export interface SessionTransaction {
  /** Transaction hash */
  txHash: string;
  /** Operation type */
  type: "deposit" | "transfer" | "withdraw";
  /** Amount */
  amount: bigint;
  /** Timestamp */
  timestamp: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default session duration (24 hours in seconds) */
export const DEFAULT_SESSION_DURATION = 24 * 60 * 60;

/** Default spending limits */
export const DEFAULT_LIMITS = {
  maxTransferPerTx: BigInt("1000000000000000000000"), // 1000 SAGE
  maxTransferPerDay: BigInt("10000000000000000000000"), // 10,000 SAGE
  maxWithdrawPerDay: BigInt("5000000000000000000000"), // 5,000 SAGE
};

/** Session presets for different use cases */
export const SESSION_PRESETS = {
  /** Conservative: Low limits, no withdrawal */
  conservative: {
    duration: 4 * 60 * 60, // 4 hours
    maxTransferPerTx: BigInt("100000000000000000000"), // 100 SAGE
    maxTransferPerDay: BigInt("1000000000000000000000"), // 1,000 SAGE
    maxWithdrawPerDay: BigInt(0), // No withdrawals
    canDeposit: true,
    canTransfer: true,
    canWithdraw: false,
    canRagequit: false,
  },
  /** Standard: Balanced limits */
  standard: {
    duration: DEFAULT_SESSION_DURATION,
    maxTransferPerTx: DEFAULT_LIMITS.maxTransferPerTx,
    maxTransferPerDay: DEFAULT_LIMITS.maxTransferPerDay,
    maxWithdrawPerDay: DEFAULT_LIMITS.maxWithdrawPerDay,
    canDeposit: true,
    canTransfer: true,
    canWithdraw: true,
    canRagequit: false,
  },
  /** Power user: Higher limits */
  power: {
    duration: 7 * 24 * 60 * 60, // 7 days
    maxTransferPerTx: BigInt("10000000000000000000000"), // 10,000 SAGE
    maxTransferPerDay: BigInt("100000000000000000000000"), // 100,000 SAGE
    maxWithdrawPerDay: BigInt("50000000000000000000000"), // 50,000 SAGE
    canDeposit: true,
    canTransfer: true,
    canWithdraw: true,
    canRagequit: false,
  },
} as const;

export type SessionPreset = keyof typeof SESSION_PRESETS;

// ============================================================================
// SESSION STORAGE
// ============================================================================

const SESSION_STORAGE_KEY = "obelysk_privacy_sessions";

// Privacy sessions contain session keys, wallet signatures, and spending policies.
// Using sessionStorage (not localStorage) ensures data is scoped to the browser tab
// and cleared on tab/window close — preventing cross-session correlation and
// reducing the window for XSS-based exfiltration.

function loadSessions(): Map<string, PrivacySession> {
  if (typeof window === "undefined") return new Map();

  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) return new Map();

    const parsed = JSON.parse(stored);
    const sessions = new Map<string, PrivacySession>();

    for (const [key, value] of Object.entries(parsed)) {
      const session = value as PrivacySession;
      // Convert BigInt strings back to BigInt
      session.policy.maxTransferPerTx = BigInt(session.policy.maxTransferPerTx.toString());
      session.policy.maxTransferPerDay = BigInt(session.policy.maxTransferPerDay.toString());
      session.policy.maxWithdrawPerDay = BigInt(session.policy.maxWithdrawPerDay.toString());
      session.dailySpent = BigInt(session.dailySpent.toString());
      session.dailyWithdrawn = BigInt(session.dailyWithdrawn.toString());
      sessions.set(key, session);
    }

    return sessions;
  } catch {
    return new Map();
  }
}

function saveSessions(sessions: Map<string, PrivacySession>): void {
  if (typeof window === "undefined") return;

  const obj: Record<string, PrivacySession> = {};
  for (const [key, value] of sessions.entries()) {
    // Convert BigInt to string for JSON serialization
    obj[key] = {
      ...value,
      policy: {
        ...value.policy,
        maxTransferPerTx: value.policy.maxTransferPerTx.toString() as unknown as bigint,
        maxTransferPerDay: value.policy.maxTransferPerDay.toString() as unknown as bigint,
        maxWithdrawPerDay: value.policy.maxWithdrawPerDay.toString() as unknown as bigint,
      },
      dailySpent: value.dailySpent.toString() as unknown as bigint,
      dailyWithdrawn: value.dailyWithdrawn.toString() as unknown as bigint,
    };
  }

  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(obj));
}

// ============================================================================
// SESSION MANAGER
// ============================================================================

export class PrivacySessionManager {
  private sessions: Map<string, PrivacySession>;

  constructor() {
    this.sessions = loadSessions();
  }

  /**
   * Create a new privacy session with wallet signature verification
   *
   * This generates a proper EC keypair using Stark curve, requests wallet
   * signature to authorize the session, and optionally registers on-chain.
   */
  async createSession(
    account: AccountInterface,
    preset: SessionPreset | Partial<PrivacySessionPolicy> = "standard",
    options?: { registerOnChain?: boolean }
  ): Promise<PrivacySession> {
    const presetConfig = typeof preset === "string"
      ? SESSION_PRESETS[preset]
      : preset;

    const duration = (presetConfig as { duration?: number }).duration ?? DEFAULT_SESSION_DURATION;
    const now = Math.floor(Date.now() / 1000);

    // Generate proper EC keypair using Stark curve
    const privateKey = ec.starkCurve.utils.randomPrivateKey();
    const sessionKey = ec.starkCurve.getStarkKey(privateKey);

    const policy: PrivacySessionPolicy = {
      validAfter: now,
      validUntil: now + duration,
      maxTransferPerTx: (presetConfig as { maxTransferPerTx?: bigint }).maxTransferPerTx ?? DEFAULT_LIMITS.maxTransferPerTx,
      maxTransferPerDay: (presetConfig as { maxTransferPerDay?: bigint }).maxTransferPerDay ?? DEFAULT_LIMITS.maxTransferPerDay,
      maxWithdrawPerDay: (presetConfig as { maxWithdrawPerDay?: bigint }).maxWithdrawPerDay ?? DEFAULT_LIMITS.maxWithdrawPerDay,
      canDeposit: (presetConfig as { canDeposit?: boolean }).canDeposit ?? true,
      canTransfer: (presetConfig as { canTransfer?: boolean }).canTransfer ?? true,
      canWithdraw: (presetConfig as { canWithdraw?: boolean }).canWithdraw ?? true,
      canRagequit: (presetConfig as { canRagequit?: boolean }).canRagequit ?? false,
      allowedRecipients: [],
      allowedTokens: ["0"], // SAGE only by default
    };

    // Build typed data for wallet signature (EIP-712 / SNIP-12 style)
    const typedData: TypedData = {
      domain: {
        name: "Obelysk Privacy Session",
        version: "1",
        chainId: getStarknetChainId(),
      },
      types: {
        StarkNetDomain: [
          { name: "name", type: "felt" },
          { name: "version", type: "felt" },
          { name: "chainId", type: "felt" },
        ],
        PrivacySession: [
          { name: "sessionKey", type: "felt" },
          { name: "validUntil", type: "felt" },
          { name: "maxTransferPerDay", type: "u256" },
          { name: "canDeposit", type: "felt" },
          { name: "canTransfer", type: "felt" },
          { name: "canWithdraw", type: "felt" },
        ],
      },
      primaryType: "PrivacySession",
      message: {
        sessionKey: sessionKey,
        validUntil: policy.validUntil.toString(),
        maxTransferPerDay: policy.maxTransferPerDay.toString(),
        canDeposit: policy.canDeposit ? "1" : "0",
        canTransfer: policy.canTransfer ? "1" : "0",
        canWithdraw: policy.canWithdraw ? "1" : "0",
      },
    };

    // Request wallet signature to authorize the session
    let walletSignature: string[] | undefined;
    try {
      const signedMessage = await account.signMessage(typedData);
      walletSignature = signedMessage as unknown as string[];
      console.log("[PrivacySession] Session authorized by wallet signature");
    } catch (error) {
      console.warn("[PrivacySession] Wallet signature skipped (user rejected or not supported):", error);
      // Continue without signature - session will be client-only
    }

    // Compute proper session ID using Poseidon hash
    const sessionId = hash.computePoseidonHash(
      hash.computePoseidonHash(account.address, sessionKey),
      now.toString()
    );

    let isOnChain = false;
    let onChainTxHash: string | undefined;

    // Optionally register on-chain if SESSION_MANAGER is available
    const sessionNetwork: NetworkType = (process.env.NEXT_PUBLIC_STARKNET_NETWORK as NetworkType) || "sepolia";
    if (options?.registerOnChain && walletSignature && (CONTRACTS[sessionNetwork].SESSION_MANAGER as string) !== "0x0") {
      try {
        const provider = new RpcProvider({ nodeUrl: getRpcUrl(sessionNetwork) });

        const createSessionCall: Call = {
          contractAddress: CONTRACTS[sessionNetwork].SESSION_MANAGER,
          entrypoint: "create_privacy_session",
          calldata: [
            sessionKey,
            policy.validUntil.toString(),
            (policy.maxTransferPerDay % (2n ** 128n)).toString(),
            (policy.maxTransferPerDay / (2n ** 128n)).toString(),
            policy.canDeposit ? "1" : "0",
            policy.canTransfer ? "1" : "0",
            policy.canWithdraw ? "1" : "0",
            walletSignature.length.toString(),
            ...walletSignature,
          ],
        };

        const result = await account.execute([createSessionCall]);
        onChainTxHash = result.transaction_hash;

        // Wait for transaction confirmation
        await provider.waitForTransaction(onChainTxHash, { retryInterval: 2000 });
        isOnChain = true;
        console.log("[PrivacySession] Session registered on-chain:", onChainTxHash);
      } catch (error) {
        console.warn("[PrivacySession] On-chain registration failed, using client-only:", error);
      }
    }

    const session: PrivacySession = {
      id: sessionId,
      sessionKey,
      policy,
      isActive: true,
      dailySpent: BigInt(0),
      dailyWithdrawn: BigInt(0),
      createdAt: now,
      lastUsed: now,
      walletSignature,
      isOnChain,
      onChainTxHash,
    };

    // Store session locally
    this.sessions.set(account.address, session);
    saveSessions(this.sessions);

    return session;
  }

  /**
   * Get current session for an account
   */
  getSession(accountAddress: string): PrivacySession | null {
    const session = this.sessions.get(accountAddress);
    if (!session) return null;

    // Check if expired
    const now = Math.floor(Date.now() / 1000);
    if (session.policy.validUntil < now) {
      session.isActive = false;
      saveSessions(this.sessions);
      return null;
    }

    return session;
  }

  /**
   * Validate an operation against session policy
   */
  validateOperation(
    session: PrivacySession,
    operation: "deposit" | "transfer" | "withdraw" | "ragequit",
    amount: bigint
  ): { valid: boolean; reason?: string } {
    const now = Math.floor(Date.now() / 1000);

    // Check session validity
    if (!session.isActive) {
      return { valid: false, reason: "Session is not active" };
    }

    if (session.policy.validUntil < now) {
      return { valid: false, reason: "Session has expired" };
    }

    if (session.policy.validAfter > now) {
      return { valid: false, reason: "Session is not yet active" };
    }

    // Check operation permission
    switch (operation) {
      case "deposit":
        if (!session.policy.canDeposit) {
          return { valid: false, reason: "Session does not allow deposits" };
        }
        break;
      case "transfer":
        if (!session.policy.canTransfer) {
          return { valid: false, reason: "Session does not allow transfers" };
        }
        break;
      case "withdraw":
        if (!session.policy.canWithdraw) {
          return { valid: false, reason: "Session does not allow withdrawals" };
        }
        break;
      case "ragequit":
        if (!session.policy.canRagequit) {
          return { valid: false, reason: "Session does not allow ragequit" };
        }
        break;
    }

    // Check amount limits
    if (operation === "transfer" || operation === "deposit") {
      if (amount > session.policy.maxTransferPerTx) {
        return { valid: false, reason: "Amount exceeds per-transaction limit" };
      }

      if (session.dailySpent + amount > session.policy.maxTransferPerDay) {
        return { valid: false, reason: "Amount exceeds daily spending limit" };
      }
    }

    if (operation === "withdraw") {
      if (session.dailyWithdrawn + amount > session.policy.maxWithdrawPerDay) {
        return { valid: false, reason: "Amount exceeds daily withdrawal limit" };
      }
    }

    return { valid: true };
  }

  /**
   * Verify session has valid wallet authorization
   *
   * Returns true if:
   * - Session has a valid wallet signature, or
   * - Session is registered on-chain
   */
  verifySession(session: PrivacySession): { verified: boolean; method: "signature" | "onchain" | "none" } {
    // On-chain registration takes precedence
    if (session.isOnChain && session.onChainTxHash) {
      return { verified: true, method: "onchain" };
    }

    // Check for wallet signature
    if (session.walletSignature && session.walletSignature.length > 0) {
      // Signature present but cannot be cryptographically verified client-side
      // without the original message hash. Mark as unverified — on-chain
      // verification via SESSION_MANAGER is the proper path for mainnet.
      return { verified: false, method: "signature" };
    }

    // No verification available - session is client-only (not recommended for mainnet)
    return { verified: false, method: "none" };
  }

  /**
   * Check if session is mainnet-ready (has proper verification)
   */
  isMainnetReady(session: PrivacySession): boolean {
    const { verified, method } = this.verifySession(session);
    return verified && (method === "onchain" || method === "signature");
  }

  /**
   * Record a transaction against the session
   */
  recordTransaction(
    accountAddress: string,
    operation: "deposit" | "transfer" | "withdraw",
    amount: bigint
  ): void {
    const session = this.sessions.get(accountAddress);
    if (!session) return;

    session.lastUsed = Math.floor(Date.now() / 1000);

    if (operation === "transfer" || operation === "deposit") {
      session.dailySpent = session.dailySpent + amount;
    }

    if (operation === "withdraw") {
      session.dailyWithdrawn = session.dailyWithdrawn + amount;
    }

    saveSessions(this.sessions);
  }

  /**
   * Revoke a session
   */
  revokeSession(accountAddress: string): void {
    const session = this.sessions.get(accountAddress);
    if (session) {
      session.isActive = false;
      saveSessions(this.sessions);
    }
  }

  /**
   * Reset daily limits (call at midnight)
   */
  resetDailyLimits(accountAddress: string): void {
    const session = this.sessions.get(accountAddress);
    if (session) {
      session.dailySpent = BigInt(0);
      session.dailyWithdrawn = BigInt(0);
      saveSessions(this.sessions);
    }
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let sessionManagerInstance: PrivacySessionManager | null = null;

export function getPrivacySessionManager(): PrivacySessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new PrivacySessionManager();
  }
  return sessionManagerInstance;
}

// ============================================================================
// REACT HOOK
// ============================================================================

export interface UsePrivacySessionResult {
  /** Current session */
  session: PrivacySession | null;
  /** Create a new session */
  createSession: (preset?: SessionPreset | Partial<PrivacySessionPolicy>, options?: { registerOnChain?: boolean }) => Promise<PrivacySession>;
  /** Validate an operation */
  validateOperation: (operation: "deposit" | "transfer" | "withdraw" | "ragequit", amount: bigint) => { valid: boolean; reason?: string };
  /** Record a transaction */
  recordTransaction: (operation: "deposit" | "transfer" | "withdraw", amount: bigint) => void;
  /** Revoke current session */
  revokeSession: () => void;
  /** Time remaining in session (seconds) */
  timeRemaining: number;
  /** Whether session is active */
  isActive: boolean;
  /** Daily spending info */
  dailySpending: {
    spent: bigint;
    withdrawn: bigint;
    spendingLimit: bigint;
    withdrawLimit: bigint;
  };
  /** Session verification status */
  verification: {
    verified: boolean;
    method: "signature" | "onchain" | "none";
    isMainnetReady: boolean;
  };
}

export function usePrivacySession(): UsePrivacySessionResult {
  const { account, address } = useAccount();
  const [session, setSession] = useState<PrivacySession | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);

  const manager = useMemo(() => getPrivacySessionManager(), []);

  // Load session on mount
  useEffect(() => {
    if (address) {
      const existingSession = manager.getSession(address);
      setSession(existingSession);
    }
  }, [address, manager]);

  // Update time remaining
  useEffect(() => {
    if (!session) {
      setTimeRemaining(0);
      return;
    }

    const updateRemaining = () => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = Math.max(0, session.policy.validUntil - now);
      setTimeRemaining(remaining);

      if (remaining === 0 && session.isActive) {
        setSession({ ...session, isActive: false });
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);

    return () => clearInterval(interval);
  }, [session]);

  const createSession = useCallback(async (
    preset: SessionPreset | Partial<PrivacySessionPolicy> = "standard",
    options?: { registerOnChain?: boolean }
  ): Promise<PrivacySession> => {
    if (!account) {
      throw new Error("No account connected");
    }

    const newSession = await manager.createSession(account, preset, options);
    setSession(newSession);
    return newSession;
  }, [account, manager]);

  const validateOperation = useCallback((
    operation: "deposit" | "transfer" | "withdraw" | "ragequit",
    amount: bigint
  ) => {
    if (!session) {
      return { valid: false, reason: "No active session" };
    }
    return manager.validateOperation(session, operation, amount);
  }, [session, manager]);

  const recordTransaction = useCallback((
    operation: "deposit" | "transfer" | "withdraw",
    amount: bigint
  ) => {
    if (!address) return;
    manager.recordTransaction(address, operation, amount);

    // Update local state
    const updatedSession = manager.getSession(address);
    setSession(updatedSession);
  }, [address, manager]);

  const revokeSession = useCallback(() => {
    if (!address) return;
    manager.revokeSession(address);
    setSession(null);
  }, [address, manager]);

  const dailySpending = useMemo(() => ({
    spent: session?.dailySpent ?? BigInt(0),
    withdrawn: session?.dailyWithdrawn ?? BigInt(0),
    spendingLimit: session?.policy.maxTransferPerDay ?? BigInt(0),
    withdrawLimit: session?.policy.maxWithdrawPerDay ?? BigInt(0),
  }), [session]);

  // Compute verification status
  const verification = useMemo(() => {
    if (!session) {
      return {
        verified: false,
        method: "none" as const,
        isMainnetReady: false,
      };
    }
    const { verified, method } = manager.verifySession(session);
    return {
      verified,
      method,
      isMainnetReady: manager.isMainnetReady(session),
    };
  }, [session, manager]);

  return {
    session,
    createSession,
    validateOperation,
    recordTransaction,
    revokeSession,
    timeRemaining,
    isActive: session?.isActive ?? false,
    dailySpending,
    verification,
  };
}
