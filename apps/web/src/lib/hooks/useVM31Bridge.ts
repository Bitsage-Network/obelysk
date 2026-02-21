/**
 * useVM31Bridge Hook
 *
 * Frontend integration with the VM31ConfidentialBridge contract.
 * Bridges finalized VM31 UTXO withdrawals into ConfidentialTransfer encrypted balances.
 *
 * Architecture:
 *   - The bridge is relayer-driven: only the designated relayer can call
 *     bridge_withdrawal_to_confidential(). This hook provides monitoring
 *     and status views for end users.
 *   - Users see: bridge status, their bridged withdrawals, asset pairs,
 *     and can track pending/completed bridge operations.
 *   - The relayer (server-side) handles: VM31 batch finalization checks,
 *     withdrawal binding verification, ERC20 approve + fund_for calls.
 */

"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useAccount } from "@starknet-react/core";
import { useQuery } from "@tanstack/react-query";
import { RpcProvider, num } from "starknet";
import { CONTRACTS, NETWORK_CONFIG, EXTERNAL_TOKENS } from "../contracts/addresses";
import { useNetwork } from "../contexts/NetworkContext";
import {
  scanBridgeExecutions,
  type BridgeExecution,
} from "../events/bridgeEvents";

// ============================================================================
// Types
// ============================================================================

export interface AssetPair {
  token: string;
  tokenSymbol: string;
  vm31AssetId: string;
  confidentialAssetId: string;
}

export interface BridgeStatus {
  relayer: string;
  vm31Pool: string;
  confidentialTransfer: string;
  paused: boolean;
  pendingUpgrade: { classHash: string; scheduledAt: number } | null;
}

export interface UseVM31BridgeReturn {
  // Connection state
  bridgeAddress: string;
  bridgeDeployed: boolean;
  isLoading: boolean;
  error: string | null;

  // Bridge status (admin/monitoring)
  status: BridgeStatus | null;
  refreshStatus: () => void;

  // User's bridge history
  executions: BridgeExecution[];
  isLoadingExecutions: boolean;
  refreshExecutions: () => void;

  // Asset pair info
  getAssetPair: (tokenAddress: string) => Promise<AssetPair | null>;

  // Bridge key checks
  isBridgeKeyProcessed: (bridgeKey: string) => Promise<boolean>;
  computeBridgeKey: (params: {
    batchId: string;
    withdrawalIdx: number;
    payoutRecipient: string;
    creditRecipient: string;
    token: string;
    amount: bigint;
  }) => Promise<string>;
}

// ============================================================================
// Helpers
// ============================================================================

/** Resolve a token address to its symbol */
function resolveTokenSymbol(tokenAddress: string, network: string): string {
  const tokens = EXTERNAL_TOKENS[network as keyof typeof EXTERNAL_TOKENS];
  if (!tokens) return "UNKNOWN";

  const normalized = num.toHex(num.toBigInt(tokenAddress)).toLowerCase();
  for (const [symbol, addr] of Object.entries(tokens)) {
    if (num.toHex(num.toBigInt(addr)).toLowerCase() === normalized) {
      return symbol;
    }
  }

  // Check SAGE
  const contracts = CONTRACTS[network as keyof typeof CONTRACTS];
  if (contracts?.SAGE_TOKEN) {
    const sageNorm = num.toHex(num.toBigInt(contracts.SAGE_TOKEN)).toLowerCase();
    if (sageNorm === normalized) return "SAGE";
  }

  return "UNKNOWN";
}

// ============================================================================
// Hook
// ============================================================================

export function useVM31Bridge(): UseVM31BridgeReturn {
  const { address } = useAccount();
  const { network } = useNetwork();
  const [error, setError] = useState<string | null>(null);

  const rpcUrl = NETWORK_CONFIG[network]?.rpcUrl || "";

  // VM31ConfidentialBridge is not in the addresses file yet — will be "0x0"
  // Users provide the address via env var or it gets populated on deployment
  const bridgeAddress =
    (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_VM31_BRIDGE_ADDRESS) || "0x0";
  const bridgeDeployed = bridgeAddress !== "0x0";

  const provider = useMemo(
    () => (rpcUrl ? new RpcProvider({ nodeUrl: rpcUrl }) : null),
    [rpcUrl],
  );

  // ========================================================================
  // Bridge status query
  // ========================================================================
  const statusQuery = useQuery({
    queryKey: ["vm31BridgeStatus", network, bridgeAddress],
    queryFn: async (): Promise<BridgeStatus> => {
      if (!provider || !bridgeDeployed) {
        throw new Error("Bridge not deployed");
      }

      const [relayerResult, vm31PoolResult, ctResult, pendingUpgradeResult] =
        await Promise.all([
          provider.callContract({
            contractAddress: bridgeAddress,
            entrypoint: "get_relayer",
            calldata: [],
          }),
          provider.callContract({
            contractAddress: bridgeAddress,
            entrypoint: "get_vm31_pool",
            calldata: [],
          }),
          provider.callContract({
            contractAddress: bridgeAddress,
            entrypoint: "get_confidential_transfer",
            calldata: [],
          }),
          provider.callContract({
            contractAddress: bridgeAddress,
            entrypoint: "get_pending_upgrade",
            calldata: [],
          }),
        ]);

      const pendingClassHash = pendingUpgradeResult[0] || "0x0";
      const scheduledAt = Number(BigInt(pendingUpgradeResult[1] || "0"));
      const hasPendingUpgrade = pendingClassHash !== "0x0" && BigInt(pendingClassHash) !== 0n;

      // Check pause status via is_paused (PausableComponent)
      let paused = false;
      try {
        const pausedResult = await provider.callContract({
          contractAddress: bridgeAddress,
          entrypoint: "is_paused",
          calldata: [],
        });
        paused = pausedResult[0] !== "0x0" && BigInt(pausedResult[0] || "0") !== 0n;
      } catch {
        // is_paused may not exist — assume not paused
      }

      return {
        relayer: relayerResult[0] || "0x0",
        vm31Pool: vm31PoolResult[0] || "0x0",
        confidentialTransfer: ctResult[0] || "0x0",
        paused,
        pendingUpgrade: hasPendingUpgrade
          ? { classHash: pendingClassHash, scheduledAt }
          : null,
      };
    },
    enabled: bridgeDeployed && !!provider,
    staleTime: 120_000,
    retry: 1,
  });

  // ========================================================================
  // Bridge execution history for connected user
  // ========================================================================
  const executionsQuery = useQuery({
    queryKey: ["vm31BridgeExecutions", network, bridgeAddress, address],
    queryFn: () =>
      scanBridgeExecutions({
        network,
        bridgeAddress,
        fromBlock: 0,
        creditRecipient: address,
      }),
    enabled: bridgeDeployed && !!address,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  // ========================================================================
  // Get asset pair for a token
  // ========================================================================
  const getAssetPair = useCallback(
    async (tokenAddress: string): Promise<AssetPair | null> => {
      if (!provider || !bridgeDeployed) return null;

      try {
        const result = await provider.callContract({
          contractAddress: bridgeAddress,
          entrypoint: "get_asset_pair",
          calldata: [tokenAddress],
        });

        const vm31AssetId = result[0] || "0x0";
        const confidentialAssetId = result[1] || "0x0";

        if (BigInt(vm31AssetId) === 0n && BigInt(confidentialAssetId) === 0n) {
          return null;
        }

        return {
          token: tokenAddress,
          tokenSymbol: resolveTokenSymbol(tokenAddress, network),
          vm31AssetId,
          confidentialAssetId,
        };
      } catch (err) {
        console.error("[VM31Bridge] getAssetPair error:", err);
        return null;
      }
    },
    [provider, bridgeDeployed, bridgeAddress, network],
  );

  // ========================================================================
  // Check if a bridge key has been processed
  // ========================================================================
  const isBridgeKeyProcessed = useCallback(
    async (bridgeKey: string): Promise<boolean> => {
      if (!provider || !bridgeDeployed) return false;

      try {
        const result = await provider.callContract({
          contractAddress: bridgeAddress,
          entrypoint: "is_bridge_key_processed",
          calldata: [bridgeKey],
        });
        return result[0] !== "0x0" && BigInt(result[0] || "0") !== 0n;
      } catch {
        return false;
      }
    },
    [provider, bridgeDeployed, bridgeAddress],
  );

  // ========================================================================
  // Compute bridge key (for tracking pending operations)
  // ========================================================================
  const computeBridgeKey = useCallback(
    async (params: {
      batchId: string;
      withdrawalIdx: number;
      payoutRecipient: string;
      creditRecipient: string;
      token: string;
      amount: bigint;
    }): Promise<string> => {
      if (!provider || !bridgeDeployed) {
        throw new Error("Bridge not deployed");
      }

      const result = await provider.callContract({
        contractAddress: bridgeAddress,
        entrypoint: "compute_bridge_key",
        calldata: [
          params.batchId,
          params.withdrawalIdx.toString(),
          params.payoutRecipient,
          params.creditRecipient,
          params.token,
          // amount: u256 (low, high)
          "0x" + (params.amount & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toString(16),
          "0x" + (params.amount >> 128n).toString(16),
        ],
      });

      return result[0] || "0x0";
    },
    [provider, bridgeDeployed, bridgeAddress],
  );

  // ========================================================================
  // Error handling
  // ========================================================================
  useEffect(() => {
    if (statusQuery.error) {
      setError(statusQuery.error instanceof Error ? statusQuery.error.message : "Failed to fetch bridge status");
    } else {
      setError(null);
    }
  }, [statusQuery.error]);

  return {
    bridgeAddress,
    bridgeDeployed,
    isLoading: statusQuery.isLoading,
    error,

    status: statusQuery.data ?? null,
    refreshStatus: () => statusQuery.refetch(),

    executions: executionsQuery.data || [],
    isLoadingExecutions: executionsQuery.isLoading,
    refreshExecutions: () => executionsQuery.refetch(),

    getAssetPair,
    isBridgeKeyProcessed,
    computeBridgeKey,
  };
}

export default useVM31Bridge;
