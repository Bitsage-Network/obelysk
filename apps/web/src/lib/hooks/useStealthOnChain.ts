/**
 * On-Chain Stealth Address Hook
 *
 * Replaces the API-based `useStealthPageData` with client-side on-chain
 * event scanning via `starknet_getEvents`. Returns the same data shape
 * so the stealth page component stays unchanged.
 */

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { RpcProvider, num } from "starknet";
import { CONTRACTS, NETWORK_CONFIG } from "../contracts/addresses";
import { useNetwork } from "../contexts/NetworkContext";
import { scanStealthPayments, type StealthPayment } from "../events/stealthEvents";

// ============================================================================
// Contract Read Helpers
// ============================================================================

async function fetchMetaAddress(
  rpcUrl: string,
  registryAddress: string,
  userAddress: string,
): Promise<{ spending_pub_key: string; viewing_pub_key: string } | null> {
  if (!registryAddress || registryAddress === "0x0") return null;

  const provider = new RpcProvider({ nodeUrl: rpcUrl });

  try {
    // Check if user has a meta-address registered
    const hasResult = await provider.callContract({
      contractAddress: registryAddress,
      entrypoint: "has_meta_address",
      calldata: [userAddress],
    });

    const hasMetaAddress = hasResult[0] !== "0x0";
    if (!hasMetaAddress) return null;

    // Fetch the meta-address
    const result = await provider.callContract({
      contractAddress: registryAddress,
      entrypoint: "get_meta_address",
      calldata: [userAddress],
    });

    // StealthMetaAddress struct: spending_pubkey(x,y), viewing_pubkey(x,y), scheme_id
    // Returns: [spending_x, spending_y, viewing_x, viewing_y, scheme_id]
    return {
      spending_pub_key: result[0] || "0x0",
      viewing_pub_key: result[2] || "0x0",
    };
  } catch {
    // Contract not deployed or user not registered
    return null;
  }
}

// ============================================================================
// Main Hook
// ============================================================================

/**
 * On-chain stealth address hook.
 * Returns the same shape as `useStealthPageData` from `useApiData.ts`.
 */
export function useStealthOnChain(address: string | undefined) {
  const { network } = useNetwork();
  const [lastScanBlock, setLastScanBlock] = useState(0);

  const rpcUrl = NETWORK_CONFIG[network]?.rpcUrl || "";
  const contracts = CONTRACTS[network];
  const registryAddress = contracts?.STEALTH_REGISTRY || "0x0";
  const registryDeployed = registryAddress !== "0x0";

  // Fetch meta-address from contract
  const metaAddressQuery = useQuery({
    queryKey: ["stealthMetaAddress", address, network],
    queryFn: () => fetchMetaAddress(rpcUrl, registryAddress, address!),
    enabled: !!address && registryDeployed,
    staleTime: 300_000, // 5 minutes
  });

  // Fetch stealth payments via on-chain event scanning
  const paymentsQuery = useQuery({
    queryKey: ["stealthPayments", network, lastScanBlock],
    queryFn: () =>
      scanStealthPayments({
        network,
        fromBlock: lastScanBlock,
      }),
    enabled: registryDeployed,
    staleTime: 60_000, // 1 minute
    refetchInterval: 120_000, // Auto-refresh every 2 minutes
  });

  const payments = paymentsQuery.data || [];

  // Scan mutation — triggers a fresh event scan
  const scanMutation = useMutation({
    mutationFn: async (_params: { address: string; timeRange: string }) => {
      // Reset fromBlock based on time range to scan fresh
      setLastScanBlock(0);
      return scanStealthPayments({ network, fromBlock: 0 });
    },
    onSuccess: () => {
      paymentsQuery.refetch();
    },
  });

  // Claim mutation — builds and sends claim_payment tx
  // For now, this is a placeholder since the contract isn't deployed.
  // The actual claim will use useSendTransaction to invoke claim_stealth_payment.
  const claimMutation = useMutation({
    mutationFn: async (_params: { address: string; paymentIds: string[] }) => {
      // TODO: When STEALTH_REGISTRY is deployed, build claim_stealth_payment calls
      // const calls = paymentIds.map(id => ({
      //   contractAddress: registryAddress,
      //   entrypoint: "claim_stealth_payment",
      //   calldata: [id, "0", /* spending_proof */, address],
      // }));
      // await sendAsync(calls);
      throw new Error("Stealth Registry not yet deployed. Claims will be available once the contract is live.");
    },
  });

  // Derived stats
  const unclaimedPayments = payments.filter((p) => !p.claimed);
  const unclaimedCount = unclaimedPayments.length;
  const totalUnclaimedValue = "0"; // Amounts are encrypted; can't sum plaintext

  return {
    metaAddress: metaAddressQuery.data ?? null,
    payments,
    totalPayments: payments.length,
    unclaimedCount,
    totalUnclaimedValue,
    isLoading: metaAddressQuery.isLoading || paymentsQuery.isLoading,
    isError: metaAddressQuery.isError || paymentsQuery.isError,
    scan: scanMutation.mutate,
    isScanning: scanMutation.isPending,
    scanResult: scanMutation.data,
    claim: claimMutation.mutate,
    isClaiming: claimMutation.isPending,
    claimResult: claimMutation.data,
    registryDeployed,
    refetch: () => {
      metaAddressQuery.refetch();
      paymentsQuery.refetch();
    },
  };
}
