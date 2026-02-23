/**
 * React Hook for ASP (Association Set Provider) Registry
 *
 * Fetches and manages ASP data from the PrivacyPools contract:
 * - List of registered ASPs
 * - ASP status (Active, Pending, Suspended, Revoked)
 * - Association sets managed by each ASP
 */

"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useReadContract, useProvider } from "@starknet-react/core";
import type { Abi } from "starknet";
import { CallData } from "starknet";
import { getContractAddresses, type NetworkType } from "../contracts";
import PrivacyPoolsABI from "../contracts/abis/PrivacyPools.json";

// ASP Status enum matching the Cairo contract
export type ASPStatus = "Pending" | "Active" | "Suspended" | "Revoked";

// Association Set Type enum
export type AssociationSetType = "Inclusion" | "Exclusion";

// ASP Info structure from contract
export interface ASPInfo {
  aspId: string;
  nameHash: string;
  displayName: string; // Decoded from nameHash or fetched from metadata
  publicKey: {
    x: string;
    y: string;
  };
  metadataUriHash: string;
  status: ASPStatus;
  registeredAt: number;
  stakedAmount: bigint;
  approvalVotes: number;
  totalSets: number;
  listIndex: number;
}

// Association set info
export interface AssociationSetInfo {
  setId: string;
  aspId: string;
  setType: AssociationSetType;
  memberCount: number;
  root: string;
  createdAt: number;
  lastUpdated: number;
  isActive: boolean;
}

// Hook options
interface UseASPRegistryOptions {
  network?: NetworkType;
  filterStatus?: ASPStatus[];
  refreshInterval?: number;
}

// Hook return type
interface UseASPRegistryReturn {
  asps: ASPInfo[];
  activeASPs: ASPInfo[];
  aspCount: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getASPById: (aspId: string) => ASPInfo | undefined;
  isASPActive: (aspId: string) => boolean;
}

// Parse ASP status from contract enum
function parseASPStatus(statusVariant: unknown): ASPStatus {
  if (!statusVariant || typeof statusVariant !== "object") return "Pending";

  const variant = statusVariant as Record<string, unknown>;
  if ("Active" in variant) return "Active";
  if ("Suspended" in variant) return "Suspended";
  if ("Revoked" in variant) return "Revoked";
  return "Pending";
}

// Decode name from felt252 hash (simple hex to string)
function decodeName(nameHash: string): string {
  try {
    // Remove 0x prefix and convert hex to string
    const hex = nameHash.replace("0x", "");
    let result = "";
    for (let i = 0; i < hex.length; i += 2) {
      const charCode = parseInt(hex.substr(i, 2), 16);
      if (charCode > 0) result += String.fromCharCode(charCode);
    }
    return result || `ASP-${nameHash.slice(0, 8)}`;
  } catch {
    return `ASP-${nameHash.slice(0, 8)}`;
  }
}

// Parse u256 from contract response
function parseU256(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (typeof value === "object" && value !== null) {
    const obj = value as { low?: bigint | string | number; high?: bigint | string | number };
    const low = BigInt(obj.low || 0);
    const high = BigInt(obj.high || 0);
    return low + (high << 128n);
  }
  return 0n;
}

export function useASPRegistry(options: UseASPRegistryOptions = {}): UseASPRegistryReturn {
  const { network = "sepolia", filterStatus, refreshInterval } = options;

  const addresses = getContractAddresses(network);
  const { provider } = useProvider();
  const [asps, setASPs] = useState<ASPInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get ASP count from contract
  const { data: aspCountData, refetch: refetchCount } = useReadContract({
    address: addresses.PRIVACY_POOLS as `0x${string}`,
    abi: PrivacyPoolsABI as Abi,
    functionName: "get_asp_count",
    args: [],
  });

  const aspCount = useMemo(() => {
    if (!aspCountData) return 0;
    return Number(aspCountData);
  }, [aspCountData]);

  // Fetch all ASP info on-chain via provider.callContract
  const fetchASPs = useCallback(async () => {
    if (aspCount === 0 || !provider) {
      setASPs([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const fetchedASPs: ASPInfo[] = [];
      const contractAddress = addresses.PRIVACY_POOLS;

      // ASP IDs are sequential felt252 values (1-indexed)
      for (let i = 1; i <= aspCount && i <= 50; i++) {
        try {
          const result = await provider.callContract({
            contractAddress,
            entrypoint: "get_asp_info",
            calldata: CallData.compile([i.toString()]),
          });

          if (result && result.length > 0) {
            // Parse the raw felt array into ASPInfo
            // Contract returns ASPInfo struct fields sequentially
            fetchedASPs.push({
              aspId: result[0] || "0x0",
              nameHash: result[1] || "0x0",
              displayName: decodeName(result[1] || "0x0"),
              publicKey: {
                x: result[2] || "0x0",
                y: result[3] || "0x0",
              },
              metadataUriHash: result[4] || "0x0",
              status: parseASPStatus({ [decodeStatusVariant(result[5])]: {} }),
              registeredAt: Number(BigInt(result[6] || 0)),
              stakedAmount: parseU256({ low: result[7], high: result[8] }),
              approvalVotes: Number(BigInt(result[9] || 0)),
              totalSets: Number(BigInt(result[10] || 0)),
              listIndex: i - 1,
            });
          }
        } catch {
          // ASP at this index may not exist, skip
        }
      }

      setASPs(fetchedASPs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch ASPs");
    } finally {
      setIsLoading(false);
    }
  }, [aspCount, provider, addresses.PRIVACY_POOLS]);

  // Decode status variant index from felt to enum key
  function decodeStatusVariant(felt: string | undefined): string {
    const val = Number(BigInt(felt || 0));
    const variants = ["Pending", "Active", "Suspended", "Revoked"];
    return variants[val] || "Pending";
  }

  // Initial fetch and refresh interval
  useEffect(() => {
    fetchASPs();

    if (refreshInterval && refreshInterval > 0) {
      const interval = setInterval(fetchASPs, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchASPs, refreshInterval]);

  // Refetch when count changes
  useEffect(() => {
    if (aspCount > 0) {
      fetchASPs();
    }
  }, [aspCount, fetchASPs]);

  // Filter active ASPs
  const activeASPs = useMemo(() => {
    let filtered = asps.filter((asp) => asp.status === "Active");

    if (filterStatus && filterStatus.length > 0) {
      filtered = asps.filter((asp) => filterStatus.includes(asp.status));
    }

    return filtered;
  }, [asps, filterStatus]);

  // Helper: Get ASP by ID
  const getASPById = useCallback(
    (aspId: string) => asps.find((asp) => asp.aspId === aspId),
    [asps]
  );

  // Helper: Check if ASP is active
  const isASPActive = useCallback(
    (aspId: string) => {
      const asp = getASPById(aspId);
      return asp?.status === "Active";
    },
    [getASPById]
  );

  // Refresh function
  const refresh = useCallback(async () => {
    await refetchCount();
    await fetchASPs();
  }, [refetchCount, fetchASPs]);

  return {
    asps,
    activeASPs,
    aspCount,
    isLoading,
    error,
    refresh,
    getASPById,
    isASPActive,
  };
}

// ============================================
// Hook for fetching a single ASP's info
// ============================================

export function useASPInfo(aspId: string | undefined, network: NetworkType = "sepolia") {
  const addresses = getContractAddresses(network);

  const { data, isLoading, isError, refetch } = useReadContract({
    address: addresses.PRIVACY_POOLS as `0x${string}`,
    abi: PrivacyPoolsABI as Abi,
    functionName: "get_asp_info",
    args: aspId ? [aspId] : undefined,
    enabled: !!aspId,
  });

  const aspInfo = useMemo((): ASPInfo | null => {
    if (!data) return null;

    const d = data as Record<string, unknown>;
    return {
      aspId: String(d.asp_id || "0x0"),
      nameHash: String(d.name_hash || "0x0"),
      displayName: decodeName(String(d.name_hash || "0x0")),
      publicKey: {
        x: String((d.public_key as Record<string, unknown>)?.x || "0x0"),
        y: String((d.public_key as Record<string, unknown>)?.y || "0x0"),
      },
      metadataUriHash: String(d.metadata_uri_hash || "0x0"),
      status: parseASPStatus(d.status),
      registeredAt: Number(d.registered_at || 0),
      stakedAmount: parseU256(d.staked_amount),
      approvalVotes: Number(d.approval_votes || 0),
      totalSets: Number(d.total_sets || 0),
      listIndex: Number(d.list_index || 0),
    };
  }, [data]);

  return { aspInfo, isLoading, isError, refetch };
}

// ============================================
// Hook for checking ASP active status
// ============================================

export function useIsASPActive(aspId: string | undefined, network: NetworkType = "sepolia") {
  const addresses = getContractAddresses(network);

  return useReadContract({
    address: addresses.PRIVACY_POOLS as `0x${string}`,
    abi: PrivacyPoolsABI as Abi,
    functionName: "is_asp_active",
    args: aspId ? [aspId] : undefined,
    enabled: !!aspId,
  });
}

// ============================================
// Hook for fetching association set info
// ============================================

export function useAssociationSetInfo(setId: string | undefined, network: NetworkType = "sepolia") {
  const addresses = getContractAddresses(network);

  const { data, isLoading, isError, refetch } = useReadContract({
    address: addresses.PRIVACY_POOLS as `0x${string}`,
    abi: PrivacyPoolsABI as Abi,
    functionName: "get_association_set_info",
    args: setId ? [setId] : undefined,
    enabled: !!setId,
  });

  const setInfo = useMemo((): AssociationSetInfo | null => {
    if (!data) return null;

    const d = data as Record<string, unknown>;
    const treeState = d.tree_state as Record<string, unknown> | undefined;

    return {
      setId: String(d.set_id || "0x0"),
      aspId: String(d.asp_id || "0x0"),
      setType: (d.set_type as Record<string, unknown>)?.Inclusion !== undefined ? "Inclusion" : "Exclusion",
      memberCount: Number(d.member_count || 0),
      root: String(treeState?.root || "0x0"),
      createdAt: Number(d.created_at || 0),
      lastUpdated: Number(d.last_updated || 0),
      isActive: Boolean(d.is_active),
    };
  }, [data]);

  return { setInfo, isLoading, isError, refetch };
}

// ============================================
// Hook for checking membership in association set
// ============================================

export function useIsInAssociationSet(
  setId: string | undefined,
  commitment: string | undefined,
  network: NetworkType = "sepolia"
) {
  const addresses = getContractAddresses(network);

  return useReadContract({
    address: addresses.PRIVACY_POOLS as `0x${string}`,
    abi: PrivacyPoolsABI as Abi,
    functionName: "is_in_association_set",
    args: setId && commitment ? [setId, commitment] : undefined,
    enabled: !!(setId && commitment),
  });
}

export type { UseASPRegistryOptions, UseASPRegistryReturn };
