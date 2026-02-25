/**
 * On-Chain Stealth Address Hook
 *
 * Replaces the API-based `useStealthPageData` with client-side on-chain
 * event scanning via `starknet_getEvents`. Returns the same data shape
 * so the stealth page component stays unchanged.
 *
 * Claim flow:
 *   1. User scans for stealth payments addressed to them
 *   2. For each unclaimed payment, derive the stealth spending key
 *   3. Build a Schnorr spending proof (matches Cairo's verify_spending_proof)
 *   4. Submit claim_stealth_payment (or batch_claim) tx via wallet
 */

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import { RpcProvider, num, hash, CallData } from "starknet";
import { CONTRACTS, NETWORK_CONFIG } from "../contracts/addresses";
import { useNetwork } from "../contexts/NetworkContext";
import { scanStealthPayments, type StealthPayment } from "../events/stealthEvents";
import {
  CURVE_ORDER,
  type ECPoint,
  scalarMult,
  addPoints,
  getGenerator,
  randomScalar,
  mod,
} from "../crypto";

// ============================================================================
// Stealth Spending Proof (client-side, matches Cairo verify_spending_proof)
// ============================================================================

/**
 * StealthSpendingProof matches the Cairo struct:
 *   commitment: ECPoint     — R = k * G
 *   challenge: felt252      — e = poseidon(stealth_addr, R.x, R.y, PK.x, PK.y, 'spending_challenge')
 *   response: felt252       — s = k + e * sk_stealth  (mod curve_order)
 *   stealth_pubkey: ECPoint — PK_stealth = sk_stealth * G
 */
interface StealthSpendingProof {
  commitment: ECPoint;
  challenge: bigint;
  response: bigint;
  stealth_pubkey: ECPoint;
}

/**
 * Compute the Fiat-Shamir challenge for spending proof.
 * Must match Cairo's compute_spending_challenge exactly:
 *   poseidon_hash_span([stealth_address, R.x, R.y, PK.x, PK.y, 'spending_challenge'])
 */
function computeSpendingChallenge(
  stealthAddress: bigint,
  commitment: ECPoint,
  stealthPubkey: ECPoint,
): bigint {
  // Domain separator: 'spending_challenge' as felt252
  // In Cairo, short strings are ASCII-encoded felts.
  // 'spending_challenge' = 0x7370656e64696e675f6368616c6c656e6765
  const DOMAIN = BigInt("0x7370656e64696e675f6368616c6c656e6765");

  const inputs = [
    "0x" + stealthAddress.toString(16),
    "0x" + commitment.x.toString(16),
    "0x" + commitment.y.toString(16),
    "0x" + stealthPubkey.x.toString(16),
    "0x" + stealthPubkey.y.toString(16),
    "0x" + DOMAIN.toString(16),
  ];

  return BigInt(hash.computePoseidonHashOnElements(inputs));
}

/**
 * Create a Schnorr spending proof for claiming a stealth payment.
 *
 * @param stealthSpendingKey - The derived spending key for this specific payment
 * @param stealthAddress - The stealth address (felt252) being claimed
 * @returns StealthSpendingProof ready for on-chain verification
 */
function createSpendingProof(
  stealthSpendingKey: bigint,
  stealthAddress: bigint,
): StealthSpendingProof {
  const G = getGenerator();

  // Compute stealth public key
  const stealth_pubkey = scalarMult(stealthSpendingKey, G);

  // Step 1: Random nonce k
  const k = randomScalar();

  // Step 2: Commitment R = k * G
  const commitment = scalarMult(k, G);

  // Step 3: Challenge e = H(stealth_addr, R, PK_stealth)
  const challenge = computeSpendingChallenge(stealthAddress, commitment, stealth_pubkey);

  // Step 4: Response s = k + e * sk_stealth (mod curve_order)
  const e_times_sk = mod(challenge * stealthSpendingKey, CURVE_ORDER);
  const response = mod(k + e_times_sk, CURVE_ORDER);

  return { commitment, challenge, response, stealth_pubkey };
}

/**
 * Derive the stealth spending key for a specific payment.
 *
 * Cairo logic:
 *   shared_secret = ec_mul(viewing_key, ephemeral_pubkey)
 *   scalar = poseidon(shared_secret.x, shared_secret.y, 'stealth_derive')
 *   sk_stealth = spending_key + scalar
 *
 * @param spendingKey - Worker's spending secret key
 * @param viewingKey - Worker's viewing secret key
 * @param ephemeralPubkey - R from the payment announcement
 */
function deriveStealthSpendingKey(
  spendingKey: bigint,
  viewingKey: bigint,
  ephemeralPubkey: ECPoint,
): bigint {
  // S = vk * R
  const sharedSecretPoint = scalarMult(viewingKey, ephemeralPubkey);

  // H(S.x, S.y, 'stealth_derive')
  const STEALTH_DERIVE = BigInt("0x737465616c74685f646572697665"); // 'stealth_derive' as felt252
  const sharedSecretScalar = BigInt(
    hash.computePoseidonHashOnElements([
      "0x" + sharedSecretPoint.x.toString(16),
      "0x" + sharedSecretPoint.y.toString(16),
      "0x" + STEALTH_DERIVE.toString(16),
    ])
  );

  // sk_stealth = sk_spend + H(S)
  return mod(spendingKey + sharedSecretScalar, CURVE_ORDER);
}

/**
 * Derive the stealth address from a stealth public key.
 * Must match Cairo: poseidon(PK.x, PK.y, 'stealth_address')
 */
function pubkeyToAddress(pubkey: ECPoint): bigint {
  const STEALTH_ADDRESS = BigInt("0x737465616c74685f61646472657373"); // 'stealth_address' as felt252
  return BigInt(
    hash.computePoseidonHashOnElements([
      "0x" + pubkey.x.toString(16),
      "0x" + pubkey.y.toString(16),
      "0x" + STEALTH_ADDRESS.toString(16),
    ])
  );
}

/**
 * Serialize a StealthSpendingProof to calldata for the contract.
 * Cairo expects: commitment(x,y), challenge, response, stealth_pubkey(x,y)
 */
function spendingProofToCalldata(proof: StealthSpendingProof): string[] {
  return [
    // commitment: ECPoint
    "0x" + proof.commitment.x.toString(16),
    "0x" + proof.commitment.y.toString(16),
    // challenge: felt252
    "0x" + proof.challenge.toString(16),
    // response: felt252
    "0x" + proof.response.toString(16),
    // stealth_pubkey: ECPoint
    "0x" + proof.stealth_pubkey.x.toString(16),
    "0x" + proof.stealth_pubkey.y.toString(16),
  ];
}

// ============================================================================
// Contract Read Helpers
// ============================================================================

async function fetchMetaAddress(
  rpcUrl: string,
  registryAddress: string,
  userAddress: string,
): Promise<{ spending_pub_key: string; viewing_pub_key: string } | null> {
  if (!registryAddress || registryAddress === "0x0") return null;
  if (!rpcUrl) return null;

  const provider = new RpcProvider({ nodeUrl: rpcUrl });

  // Primary path: call get_meta_address directly.
  // If the user isn't registered, the contract will revert and we catch it.
  // This avoids any has_meta_address boolean parsing issues.
  try {
    const result = await provider.callContract({
      contractAddress: registryAddress,
      entrypoint: "get_meta_address",
      calldata: [userAddress],
    });

    // Normalize: starknet.js v8 returns string[], but handle {result: string[]} for safety
    const data: string[] = Array.isArray(result)
      ? result
      : (result as unknown as { result: string[] }).result || [];

    // StealthMetaAddress struct: spending_pubkey(x,y), viewing_pubkey(x,y), scheme_id
    const spendingX = data[0] || "0x0";
    const spendingY = data[1] || "0x0";
    const viewingX = data[2] || "0x0";
    const viewingY = data[3] || "0x0";

    // Validate we got non-zero pubkeys
    if (BigInt(spendingX) === 0n && BigInt(viewingX) === 0n) {
      return null;
    }

    return {
      spending_pub_key: spendingX,
      viewing_pub_key: viewingX,
    };
  } catch (err) {
    // Contract reverts if user has no meta-address — this is expected for unregistered users
    const msg = err instanceof Error ? err.message : String(err);
    // Only log if it's NOT the expected "not registered" revert
    if (!msg.includes("not registered") && !msg.includes("No meta") && !msg.includes("not found")) {
      console.warn("[Stealth] fetchMetaAddress error:", msg);
    }
    return null;
  }
}

/**
 * Fetch an announcement from the contract to get the ephemeral pubkey
 * needed for stealth key derivation.
 */
async function fetchAnnouncement(
  rpcUrl: string,
  registryAddress: string,
  announcementIndex: string,
): Promise<{ ephemeral_pubkey: ECPoint; stealth_address: bigint } | null> {
  const provider = new RpcProvider({ nodeUrl: rpcUrl });

  try {
    // announcement_index is u256, serialize as (low, high)
    const idxBig = BigInt(announcementIndex);
    const result = await provider.callContract({
      contractAddress: registryAddress,
      entrypoint: "get_announcement",
      calldata: [
        "0x" + (idxBig & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toString(16),
        "0x" + (idxBig >> 128n).toString(16),
      ],
    });

    // StealthPaymentAnnouncement struct layout:
    // ephemeral_pubkey(x,y), stealth_address, encrypted_amount(c1_x, c1_y, c2_x, c2_y),
    // view_tag, timestamp, job_id(low, high)
    return {
      ephemeral_pubkey: {
        x: BigInt(result[0] || "0"),
        y: BigInt(result[1] || "0"),
      },
      stealth_address: BigInt(result[2] || "0"),
    };
  } catch (err) {
    console.error("[Stealth] Failed to fetch announcement:", err instanceof Error ? err.message : "unknown error");
    return null;
  }
}

// ============================================================================
// Main Hook
// ============================================================================

/** Claim parameters for the hook consumer */
export interface ClaimParams {
  /** Wallet address of the claimer */
  address: string;
  /** Announcement indices to claim */
  paymentIds: string[];
  /** Stealth spending key (spending_key) — kept in-memory only */
  spendingKey: bigint;
  /** Stealth viewing key (viewing_key) — kept in-memory only */
  viewingKey: bigint;
  /** Recipient address to receive the claimed STRK tokens */
  recipient?: string;
}

/**
 * On-chain stealth address hook.
 * Returns the same shape as `useStealthPageData` from `useApiData.ts`.
 */
export function useStealthOnChain(address: string | undefined) {
  const { network } = useNetwork();
  const { account } = useAccount();
  const { sendAsync } = useSendTransaction({});
  const [lastScanBlock, setLastScanBlock] = useState(0);

  const rpcUrl = NETWORK_CONFIG[network]?.rpcUrl || "";
  const contracts = CONTRACTS[network];
  // Hardcoded fallback — StealthRegistry is deployed on Sepolia at this address.
  // The CONTRACTS lookup can fail if network type doesn't match keys exactly.
  const SEPOLIA_STEALTH_REGISTRY = "0x02ab118a1527e3e00882d4bf75a479deccd7f16e2bc89417d54cb97cb9e2dc59";
  const registryAddress = contracts?.STEALTH_REGISTRY || SEPOLIA_STEALTH_REGISTRY;
  const registryDeployed = registryAddress !== "0x0";

  // Fetch meta-address from contract
  const metaAddressQuery = useQuery({
    queryKey: ["stealthMetaAddress", address, network, registryAddress],
    queryFn: () => fetchMetaAddress(rpcUrl, registryAddress, address!),
    enabled: !!address && registryDeployed && !!rpcUrl,
    staleTime: 30_000,
    retry: 2,
    refetchOnMount: true,
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
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const payments = paymentsQuery.data || [];

  // Scan mutation — triggers a fresh event scan
  const scanMutation = useMutation({
    mutationFn: async (_params: { address: string; timeRange: string }) => {
      setLastScanBlock(0);
      return scanStealthPayments({ network, fromBlock: 0 });
    },
    onSuccess: () => {
      paymentsQuery.refetch();
    },
  });

  // ========================================================================
  // Register meta-address mutation
  // ========================================================================
  const registerMutation = useMutation({
    mutationFn: async (params: { spendingPubKey: ECPoint; viewingPubKey: ECPoint }) => {
      if (!account) throw new Error("Wallet not connected");
      if (!registryDeployed) throw new Error("Stealth Registry not deployed on this network");

      const tx = await sendAsync([
        {
          contractAddress: registryAddress,
          entrypoint: "register_meta_address",
          calldata: [
            // spending_pubkey: ECPoint (x, y)
            "0x" + params.spendingPubKey.x.toString(16),
            "0x" + params.spendingPubKey.y.toString(16),
            // viewing_pubkey: ECPoint (x, y)
            "0x" + params.viewingPubKey.x.toString(16),
            "0x" + params.viewingPubKey.y.toString(16),
          ],
        },
      ]);
      return tx.transaction_hash;
    },
    onSuccess: () => {
      metaAddressQuery.refetch();
    },
  });

  // ========================================================================
  // Claim mutation — builds Schnorr spending proofs and submits tx
  // ========================================================================
  const claimMutation = useMutation({
    mutationFn: async (params: ClaimParams) => {
      if (!account) throw new Error("Wallet not connected");
      if (!registryDeployed) throw new Error("Stealth Registry not deployed on this network");
      if (params.paymentIds.length === 0) throw new Error("No payments to claim");

      const recipient = params.recipient || params.address;
      // Validate recipient address format
      if (!/^0x[a-fA-F0-9]{1,64}$/.test(recipient) || /^0x0+$/.test(recipient)) {
        throw new Error("Invalid recipient address format");
      }

      // For each payment, fetch announcement and build spending proof
      const proofs: StealthSpendingProof[] = [];
      const indices: bigint[] = [];

      for (const paymentId of params.paymentIds) {
        const announcement = await fetchAnnouncement(rpcUrl, registryAddress, paymentId);
        if (!announcement) {
          throw new Error(`Failed to fetch announcement ${paymentId}`);
        }

        // Derive stealth spending key for this payment
        const stealthSpendingKey = deriveStealthSpendingKey(
          params.spendingKey,
          params.viewingKey,
          announcement.ephemeral_pubkey,
        );

        // Verify derived address matches announcement
        const G = getGenerator();
        const stealthPubkey = scalarMult(stealthSpendingKey, G);
        const derivedAddress = pubkeyToAddress(stealthPubkey);

        if (derivedAddress !== announcement.stealth_address) {
          throw new Error(
            `Stealth address mismatch for payment ${paymentId}. ` +
            `This payment may not belong to the provided keys.`
          );
        }

        // Build Schnorr spending proof
        const proof = createSpendingProof(stealthSpendingKey, announcement.stealth_address);
        proofs.push(proof);
        indices.push(BigInt(paymentId));
      }

      // Single claim vs batch
      if (indices.length === 1) {
        const idx = indices[0];
        const proof = proofs[0];
        const tx = await sendAsync([
          {
            contractAddress: registryAddress,
            entrypoint: "claim_stealth_payment",
            calldata: [
              // announcement_index: u256 (low, high)
              "0x" + (idx & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toString(16),
              "0x" + (idx >> 128n).toString(16),
              // spending_proof: StealthSpendingProof struct
              ...spendingProofToCalldata(proof),
              // recipient: ContractAddress
              recipient,
            ],
          },
        ]);
        return tx.transaction_hash;
      }

      // Batch claim (max 20 per contract)
      const batchSize = Math.min(indices.length, 20);
      const batchIndices = indices.slice(0, batchSize);
      const batchProofs = proofs.slice(0, batchSize);

      // Build calldata: announcement_indices Array<u256>, spending_proofs Array<StealthSpendingProof>, recipient
      const calldata: string[] = [];

      // Array<u256> — length prefix then (low, high) pairs
      calldata.push(batchIndices.length.toString());
      for (const idx of batchIndices) {
        calldata.push("0x" + (idx & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toString(16));
        calldata.push("0x" + (idx >> 128n).toString(16));
      }

      // Array<StealthSpendingProof> — length prefix then each proof
      calldata.push(batchProofs.length.toString());
      for (const proof of batchProofs) {
        calldata.push(...spendingProofToCalldata(proof));
      }

      // recipient: ContractAddress
      calldata.push(recipient);

      const tx = await sendAsync([
        {
          contractAddress: registryAddress,
          entrypoint: "batch_claim_stealth_payments",
          calldata,
        },
      ]);

      return tx.transaction_hash;
    },
    onSuccess: () => {
      paymentsQuery.refetch();
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
    register: registerMutation.mutateAsync,
    isRegistering: registerMutation.isPending,
    registryDeployed,
    refetch: () => {
      metaAddressQuery.refetch();
      paymentsQuery.refetch();
    },
  };
}
