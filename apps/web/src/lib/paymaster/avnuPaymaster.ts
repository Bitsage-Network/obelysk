/**
 * AVNU Paymaster Integration
 *
 * Enables gasless transactions for Obelysk Protocol using AVNU's paymaster service.
 * Users can execute privacy pool deposits, withdrawals, and transfers without
 * holding ETH/STRK for gas.
 *
 * Features:
 * - Sponsored gas (dApp pays gas for users)
 * - Pay gas in any token (USDC, SAGE, etc.)
 * - Seamless UX for privacy operations
 *
 * @see https://docs.avnu.fi/paymaster
 */

import { type AccountInterface, type Call, PaymasterRpc } from "starknet";

// ============================================================================
// TYPES
// ============================================================================

export type FeeMode = "sponsored" | "default";

export interface PaymasterConfig {
  /** Whether paymaster is active */
  active: boolean;
  /** Fee payment mode */
  feeMode: FeeMode;
  /** Token to pay gas with (if feeMode is 'default') */
  gasToken?: string;
}

export interface GaslessExecuteOptions {
  /** Account to execute from */
  account: AccountInterface;
  /** Calls to execute */
  calls: Call[];
  /** Paymaster configuration */
  paymaster: PaymasterConfig;
}

export interface GaslessResult {
  /** Transaction hash */
  transactionHash: string;
  /** Whether gas was sponsored */
  gasSponsored: boolean;
  /** Token used for gas (if not sponsored) */
  gasToken?: string;
  /** Gas amount (in gas token) */
  gasAmount?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** AVNU Paymaster endpoints */
export const AVNU_PAYMASTER_URLS = {
  mainnet: "https://starknet.paymaster.avnu.fi",
  sepolia: "https://sepolia.paymaster.avnu.fi",
} as const;

/** AVNU API endpoints */
export const AVNU_API_URLS = {
  mainnet: "https://starknet.api.avnu.fi",
  sepolia: "https://sepolia.api.avnu.fi",
} as const;

/** Common gas tokens on Starknet */
export const GAS_TOKENS = {
  mainnet: {
    ETH: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    STRK: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    USDC: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
    USDT: "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8",
  },
  sepolia: {
    ETH: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    STRK: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    USDC: "0x053b40A647CEDfca6cA84f542A0fe36736031905A9639a7f19A3C1e66bFd5080",
    SAGE: "0x072349097c8a802e7f66dc96b95aca84e4d78ddad22014904076c76293a99850",
    wBTC: "0x00452bd5c0512a61df7c7be8cfea5e4f893cb40e126bdc40aee6054db955129e",
  },
} as const;

// ============================================================================
// PAYMASTER SERVICE
// ============================================================================

export class AVNUPaymasterService {
  private network: "mainnet" | "sepolia";
  private paymasterUrl: string;
  private apiUrl: string;
  private paymasterRpc: PaymasterRpc;

  constructor(network: "mainnet" | "sepolia" = "sepolia") {
    this.network = network;
    this.paymasterUrl = AVNU_PAYMASTER_URLS[network];
    this.apiUrl = AVNU_API_URLS[network];

    // Build PaymasterRpc with API key header for sponsored (gasfree) mode
    const apiKey = process.env.NEXT_PUBLIC_AVNU_API_KEY;
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["x-paymaster-api-key"] = apiKey;
    }

    this.paymasterRpc = new PaymasterRpc({
      nodeUrl: this.paymasterUrl,
      headers,
    });
  }

  /**
   * Execute a gasless transaction using AVNU paymaster.
   * Uses account.executePaymasterTransaction() with PaymasterRpc (API key in headers).
   */
  async executeGasless(options: GaslessExecuteOptions): Promise<GaslessResult> {
    const { account, calls, paymaster: config } = options;

    try {
      if (!config.active) {
        const result = await account.execute(calls);
        return {
          transactionHash: result.transaction_hash,
          gasSponsored: false,
        };
      }

      const paymasterDetails = this.buildPaymasterDetails(config);

      // Try executePaymasterTransaction (available on starknet.js Account)
      // Wallet adapters from @starknet-react/core may not expose it,
      // so fall back to execute() with paymaster option
      const acct = account as AccountInterface & {
        executePaymasterTransaction?: (
          calls: Call[],
          details: typeof paymasterDetails,
        ) => Promise<{ transaction_hash: string }>;
      };

      let result: { transaction_hash: string };

      if (typeof acct.executePaymasterTransaction === "function") {
        // Set paymaster on the account so executePaymasterTransaction can use it
        (acct as unknown as { paymaster: PaymasterRpc }).paymaster = this.paymasterRpc;
        result = await acct.executePaymasterTransaction(calls, paymasterDetails);
      } else {
        // Fallback: pass paymaster inline (works at runtime even if types lag)
        result = await account.execute(calls, {
          // @ts-expect-error - starknet.js v8.9.2 runtime supports this but types may lag
          paymaster: {
            provider: this.paymasterRpc,
            params: { version: "0x1", feeMode: paymasterDetails.feeMode },
          },
        });
      }

      return {
        transactionHash: result.transaction_hash,
        gasSponsored: config.feeMode === "sponsored",
        gasToken: config.gasToken,
      };
    } catch (error) {
      console.error("[AVNU Paymaster] Transaction failed:", error);

      if (error instanceof Error) {
        throw new Error(`Paymaster execution failed: ${error.message}`);
      }
      throw new Error("Paymaster execution failed: Unknown error");
    }
  }

  /**
   * Check if an address is eligible for sponsored gas
   */
  async checkEligibility(address: string): Promise<{
    eligible: boolean;
    reason?: string;
    dailyLimitRemaining?: number;
  }> {
    try {
      const apiKey = process.env.NEXT_PUBLIC_AVNU_API_KEY;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["x-paymaster-api-key"] = apiKey;

      const response = await fetch(`${this.apiUrl}/paymaster/eligibility`, {
        method: "POST",
        headers,
        body: JSON.stringify({ address }),
      });

      if (!response.ok) {
        return { eligible: false, reason: "API error" };
      }

      return response.json();
    } catch {
      return { eligible: false, reason: "Network error" };
    }
  }

  /**
   * Estimate gas cost for a transaction
   */
  async estimateGas(calls: Call[], gasToken: string): Promise<{
    gasAmount: string;
    gasAmountInToken: string;
    tokenSymbol: string;
  }> {
    try {
      const apiKey = process.env.NEXT_PUBLIC_AVNU_API_KEY;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["x-paymaster-api-key"] = apiKey;

      const response = await fetch(`${this.apiUrl}/paymaster/estimate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          calls,
          gas_token: gasToken,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to estimate gas");
      }

      return response.json();
    } catch {
      return {
        gasAmount: "0",
        gasAmountInToken: "0",
        tokenSymbol: "STRK",
      };
    }
  }

  /**
   * Get supported gas tokens
   */
  getSupportedGasTokens(): Record<string, string> {
    return GAS_TOKENS[this.network];
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private buildPaymasterDetails(config: PaymasterConfig) {
    const feeMode = config.feeMode === "default" && config.gasToken
      ? { mode: "default" as const, gasToken: config.gasToken }
      : { mode: "sponsored" as const };

    return { feeMode };
  }
}

// ============================================================================
// SINGLETON (Network-aware caching)
// ============================================================================

const paymasterInstances = new Map<string, AVNUPaymasterService>();

/**
 * Get the AVNU paymaster instance for a specific network.
 * Uses a Map to cache instances per network, avoiding the bug where
 * switching networks would return the wrong instance.
 */
export function getAVNUPaymaster(network: "mainnet" | "sepolia" = "sepolia"): AVNUPaymasterService {
  const cached = paymasterInstances.get(network);
  if (cached) {
    return cached;
  }

  const instance = new AVNUPaymasterService(network);
  paymasterInstances.set(network, instance);
  return instance;
}

// ============================================================================
// PRIVACY POOL SPECIFIC HELPERS
// ============================================================================

import { CONTRACTS } from "@/lib/contracts/addresses";
import type { ECPoint } from "@/lib/crypto";

/**
 * Build a gasless privacy pool deposit call
 */
export function buildGaslessDepositCall(
  commitment: string,
  amountCommitment: ECPoint,
  assetId: string,
  amount: bigint,
  rangeProofData: string[],
  network: "sepolia" | "mainnet" = "sepolia"
): Call {
  const addresses = CONTRACTS[network];

  return {
    contractAddress: addresses.PRIVACY_POOLS,
    entrypoint: "pp_deposit",
    calldata: [
      commitment,
      amountCommitment.x.toString(),
      amountCommitment.y.toString(),
      assetId,
      "0x" + (amount % (2n ** 128n)).toString(16), // u256 low
      "0x" + (amount / (2n ** 128n)).toString(16), // u256 high
      rangeProofData.length.toString(),
      ...rangeProofData,
    ],
  };
}

/**
 * Execute a gasless privacy pool deposit
 */
export async function executeGaslessDeposit(
  account: AccountInterface,
  params: {
    commitment: string;
    amountCommitment: ECPoint;
    assetId: string;
    amount: bigint;
    rangeProofData: string[];
  },
  options: {
    sponsored?: boolean;
    gasToken?: string;
    network?: "sepolia" | "mainnet";
  } = {}
): Promise<GaslessResult> {
  const { sponsored = true, gasToken, network = "sepolia" } = options;

  const depositCall = buildGaslessDepositCall(
    params.commitment,
    params.amountCommitment,
    params.assetId,
    params.amount,
    params.rangeProofData,
    network
  );

  const paymaster = getAVNUPaymaster(network);

  return paymaster.executeGasless({
    account,
    calls: [depositCall],
    paymaster: {
      active: true,
      feeMode: sponsored ? "sponsored" : "default",
      gasToken,
    },
  });
}

// ============================================================================
// REACT HOOK
// ============================================================================

import { useState, useCallback, useMemo } from "react";
import { useAccount } from "@starknet-react/core";

export interface UseAVNUPaymasterResult {
  /** Execute gasless transaction */
  executeGasless: (calls: Call[], options?: { sponsored?: boolean; gasToken?: string }) => Promise<GaslessResult>;
  /** Check eligibility for sponsored gas */
  checkEligibility: () => Promise<{ eligible: boolean; reason?: string }>;
  /** Estimate gas cost */
  estimateGas: (calls: Call[], gasToken: string) => Promise<{ gasAmountInToken: string; tokenSymbol: string }>;
  /** Supported gas tokens */
  gasTokens: Record<string, string>;
  /** Loading state */
  isLoading: boolean;
  /** Error */
  error: Error | null;
  /** Last result */
  lastResult: GaslessResult | null;
}

export function useAVNUPaymaster(network: "mainnet" | "sepolia" = "sepolia"): UseAVNUPaymasterResult {
  const { account } = useAccount();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastResult, setLastResult] = useState<GaslessResult | null>(null);

  const paymaster = useMemo(() => getAVNUPaymaster(network), [network]);
  const gasTokens = useMemo(() => paymaster.getSupportedGasTokens(), [paymaster]);

  const executeGasless = useCallback(async (
    calls: Call[],
    options: { sponsored?: boolean; gasToken?: string } = {}
  ): Promise<GaslessResult> => {
    if (!account) {
      throw new Error("No account connected");
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await paymaster.executeGasless({
        account,
        calls,
        paymaster: {
          active: true,
          feeMode: options.sponsored !== false ? "sponsored" : "default",
          gasToken: options.gasToken,
        },
      });

      setLastResult(result);
      return result;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [account, paymaster]);

  const checkEligibility = useCallback(async () => {
    if (!account?.address) {
      return { eligible: false, reason: "No account connected" };
    }
    return paymaster.checkEligibility(account.address);
  }, [account, paymaster]);

  const estimateGas = useCallback(async (calls: Call[], gasToken: string) => {
    return paymaster.estimateGas(calls, gasToken);
  }, [paymaster]);

  return {
    executeGasless,
    checkEligibility,
    estimateGas,
    gasTokens,
    isLoading,
    error,
    lastResult,
  };
}
