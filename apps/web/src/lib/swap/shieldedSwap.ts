/**
 * Shielded Swap Service
 *
 * Pure service module (no React) for building privacy-preserving swap transactions
 * through Ekubo AMM pools. The user's identity is hidden — only the router
 * contract appears as the on-chain swap participant.
 *
 * Architecture:
 *   User → ShieldedSwapRouter (ILocker) → Ekubo Core → Privacy Pools
 *
 * This module handles:
 * - Building the shielded_swap contract call with all serialized params
 * - Looking up Ekubo pool keys for token pairs
 * - Estimating swap output via RPC reads
 * - Slippage calculations
 */

import { CallData, RpcProvider, Contract, type Abi } from "starknet";
import {
  CONTRACTS,
  EXTERNAL_TOKENS,
  NETWORK_CONFIG,
  TOKEN_METADATA,
  type NetworkType,
  type TokenSymbol,
} from "../contracts/addresses";

// ============================================================================
// Types
// ============================================================================

export interface ECPoint {
  x: string;
  y: string;
}

export interface PPWithdrawalProof {
  global_tree_proof: {
    siblings: string[];
    path_indices: boolean[];
    leaf: string;
    root: string;
    tree_size: number;
  };
  deposit_commitment: string;
  association_set_id: string | null;
  association_proof: {
    siblings: string[];
    path_indices: boolean[];
    leaf: string;
    root: string;
    tree_size: number;
  } | null;
  exclusion_set_id: string | null;
  exclusion_proof: null;
  nullifier: string;
  amount: string;
  recipient: string;
  range_proof_data: string[];
}

export interface PoolKey {
  token0: string;
  token1: string;
  fee: string;
  tick_spacing: string;
  extension: string;
}

export interface ShieldedSwapParams {
  inputToken: string;
  outputToken: string;
  inputAmount: string; // wei
  minOutputAmount: string; // wei, slippage-adjusted
  withdrawalProof: PPWithdrawalProof;
  depositCommitment: string;
  depositAmountCommitment: ECPoint;
  depositAssetId: string;
  depositRangeProof: string[];
  sourcePool: string;
  destPool: string;
}

export type SwapStage =
  | "idle"
  | "generating-proofs"
  | "submitting"
  | "confirming"
  | "confirmed"
  | "error";

export interface SwapEstimate {
  expectedOutput: bigint;
  priceImpact: number;
  fee: bigint;
  route: string;
}

// ============================================================================
// Contract Addresses
// ============================================================================

export const EKUBO_CORE = {
  sepolia: "0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384",
  mainnet: "0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b",
} as const;

// Shielded swap router — deployed per network
export const SHIELDED_SWAP_ROUTER = {
  sepolia: "0x056b76b42487b943a0d33f5787437ee08af9fd61e1926de9602b3cfb5392f1d6",
  mainnet: "0x0",
} as const;

// Per-token privacy pool instances (each initialized with a single ERC20)
export const PRIVACY_POOL_REGISTRY: Record<string, Record<string, string>> = {
  sepolia: {
    // SAGE pool is the primary deployed pool
    SAGE: CONTRACTS.sepolia.PRIVACY_POOLS,
    // Per-token pools (deployed 2026-02-06)
    ETH: "0x07ad28f81b8e90e9e7ae0a2bd5692d54df7fc9df91bbc2d403845698caf0fe67",
    STRK: "0x03624fd7adc5e5b82e0925c68dd4714fde4031da4a9222ca7bd223ef71418e2b",
    USDC: CONTRACTS.sepolia.USDC_PRIVACY_POOL,
    // Deployed: 2026-02-07 via sncast
    wBTC: "0x06ca244b53fea7ebee5a169f6f3a26ff22cd57c772f3f563ed1bafc367555263",
  },
  mainnet: {
    SAGE: "0x0",
    ETH: "0x0",
    STRK: "0x0",
    USDC: "0x0",
    wBTC: "0x0",
  },
};

// Default Ekubo fee tiers: fee = fraction * 2^128 (0.128 fixed-point)
// e.g. 0.05% fee → 0.0005 * 2^128 = 170141183460469231731687303715884105
const EKUBO_FEE_TIERS = {
  low: "34028236692093846346337460743176821",       // 0.01%
  medium: "170141183460469231731687303715884105",    // 0.05%
  high: "1020847100762815390390123822295304634",     // 0.30%
} as const;

const EKUBO_TICK_SPACINGS: Record<string, string> = {
  low: "10",
  medium: "50",
  high: "200",
};

// ============================================================================
// Shielded Swap Router ABI (minimal for call building)
// ============================================================================

const SHIELDED_SWAP_ROUTER_ABI = [
  {
    name: "shielded_swap",
    type: "function",
    inputs: [
      {
        name: "request",
        type: "sage_contracts::obelysk::shielded_swap_router::ShieldedSwapRequest",
      },
    ],
    outputs: [],
    state_mutability: "external",
  },
  {
    name: "get_pool",
    type: "function",
    inputs: [
      {
        name: "token",
        type: "core::starknet::contract_address::ContractAddress",
      },
    ],
    outputs: [
      {
        type: "core::starknet::contract_address::ContractAddress",
      },
    ],
    state_mutability: "view",
  },
  {
    name: "get_swap_count",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::integer::u64" }],
    state_mutability: "view",
  },
] as Abi;

// ============================================================================
// Ekubo Core ABI (minimal for output estimation)
// ============================================================================

const EKUBO_QUOTE_ABI = [
  {
    name: "quote",
    type: "function",
    inputs: [
      { name: "pool_key", type: "(core::starknet::contract_address::ContractAddress,core::starknet::contract_address::ContractAddress,core::integer::u128,core::integer::u128,core::starknet::contract_address::ContractAddress)" },
      { name: "amount", type: "core::integer::u128" },
      { name: "is_token1", type: "core::bool" },
    ],
    outputs: [{ type: "core::integer::u128" }],
    state_mutability: "view",
  },
] as Abi;

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get the correctly ordered Ekubo pool key for a token pair.
 * Ekubo requires token0 < token1 (lexicographic on felt252).
 */
export function getEkuboPoolKey(
  token0Address: string,
  token1Address: string,
  feeTier: "low" | "medium" | "high" = "medium"
): PoolKey {
  // Ekubo requires token0 < token1
  const t0 = BigInt(token0Address);
  const t1 = BigInt(token1Address);

  const [sorted0, sorted1] =
    t0 < t1
      ? [token0Address, token1Address]
      : [token1Address, token0Address];

  return {
    token0: sorted0,
    token1: sorted1,
    fee: EKUBO_FEE_TIERS[feeTier],
    tick_spacing: EKUBO_TICK_SPACINGS[feeTier],
    extension: "0x0", // No extension — use standard Ekubo pools
  };
}

/**
 * Determine if the input token is token1 in the pool key.
 * Required for SwapParameters.is_token1.
 */
export function isInputToken1(poolKey: PoolKey, inputToken: string): boolean {
  return BigInt(inputToken) === BigInt(poolKey.token1);
}

/**
 * Estimate swap output by reading Ekubo pool state via RPC.
 * Returns the expected output amount in wei.
 */
export async function estimateSwapOutput(
  inputToken: string,
  outputToken: string,
  amountIn: bigint,
  network: NetworkType = "sepolia"
): Promise<SwapEstimate> {
  const rpcUrl = NETWORK_CONFIG[network]?.rpcUrl;
  if (!rpcUrl) {
    throw new Error(`No RPC URL for network: ${network}`);
  }

  const poolKey = getEkuboPoolKey(inputToken, outputToken);
  const isToken1 = isInputToken1(poolKey, inputToken);

  try {
    const provider = new RpcProvider({ nodeUrl: rpcUrl });
    const coreAddress = EKUBO_CORE[network as keyof typeof EKUBO_CORE] || EKUBO_CORE.sepolia;

    const contract = new Contract({ abi: EKUBO_QUOTE_ABI, address: coreAddress, providerOrAccount: provider });
    const result = await contract.call("quote", [
      {
        token0: poolKey.token0,
        token1: poolKey.token1,
        fee: poolKey.fee,
        tick_spacing: poolKey.tick_spacing,
        extension: poolKey.extension,
      },
      amountIn.toString(),
      isToken1,
    ]);

    const expectedOutput = BigInt(result.toString());

    // Rough price impact calculation (simplified)
    const priceImpact =
      amountIn > 0n
        ? Number((amountIn - expectedOutput) * 10000n / amountIn) / 100
        : 0;

    return {
      expectedOutput,
      priceImpact: Math.abs(priceImpact),
      fee: (amountIn * BigInt(poolKey.fee)) / (2n ** 128n),
      route: `${inputToken} → Ekubo → ${outputToken}`,
    };
  } catch {
    throw new Error(
      "Failed to estimate swap output. Pool may not exist for this pair."
    );
  }
}

/**
 * Calculate minimum output with slippage tolerance.
 */
export function getMinOutputWithSlippage(
  expectedOutput: bigint,
  slippageBps: number
): bigint {
  if (slippageBps < 0 || slippageBps > 5000) {
    throw new Error("Slippage must be between 0 and 5000 bps (50%)");
  }
  return (expectedOutput * BigInt(10000 - slippageBps)) / 10000n;
}

/**
 * Build the contract calls for a shielded swap transaction.
 * Returns an array of Call objects ready for useSendTransaction.
 */
export function buildShieldedSwapCalls(
  params: ShieldedSwapParams,
  network: NetworkType = "sepolia"
): { contractAddress: string; entrypoint: string; calldata: string[] }[] {
  const routerAddress =
    SHIELDED_SWAP_ROUTER[network as keyof typeof SHIELDED_SWAP_ROUTER] ||
    SHIELDED_SWAP_ROUTER.sepolia;

  if (routerAddress === "0x0") {
    throw new Error(`Shielded swap router not deployed on ${network}`);
  }

  const poolKey = getEkuboPoolKey(params.inputToken, params.outputToken);
  const isToken1 = isInputToken1(poolKey, params.inputToken);

  const TWO_POW_128 = 2n ** 128n;
  const formatHex = (n: bigint) => "0x" + n.toString(16);

  // Build the withdrawal proof calldata
  const proof = params.withdrawalProof;

  // Serialize LeanIMTProof: siblings (array), path_indices (array), leaf, root, tree_size
  const serializeIMTProof = (p: typeof proof.global_tree_proof) => {
    const data: string[] = [];
    // siblings array length + elements
    data.push(formatHex(BigInt(p.siblings.length)));
    p.siblings.forEach((s) => data.push(s));
    // path_indices array length + elements (bool as felt)
    data.push(formatHex(BigInt(p.path_indices.length)));
    p.path_indices.forEach((b) => data.push(b ? "0x1" : "0x0"));
    // leaf, root, tree_size
    data.push(p.leaf);
    data.push(p.root);
    data.push(formatHex(BigInt(p.tree_size)));
    return data;
  };

  // Build full calldata manually to match Cairo Serde layout
  const calldata: string[] = [];

  // source_pool
  calldata.push(params.sourcePool);

  // withdrawal_proof (PPWithdrawalProof):
  //   global_tree_proof
  calldata.push(...serializeIMTProof(proof.global_tree_proof));
  //   deposit_commitment
  calldata.push(proof.deposit_commitment);
  //   association_set_id: Option<felt252>
  if (proof.association_set_id) {
    calldata.push("0x0"); // Some variant
    calldata.push(proof.association_set_id);
  } else {
    calldata.push("0x1"); // None variant
  }
  //   association_proof: Option<LeanIMTProof>
  if (proof.association_proof) {
    calldata.push("0x0"); // Some
    calldata.push(...serializeIMTProof(proof.association_proof));
  } else {
    calldata.push("0x1"); // None
  }
  //   exclusion_set_id: Option<felt252>
  calldata.push("0x1"); // None
  //   exclusion_proof: Option<ExclusionProofData>
  calldata.push("0x1"); // None
  //   nullifier
  calldata.push(proof.nullifier);
  //   amount: u256 (low, high)
  const amount = BigInt(proof.amount);
  calldata.push(formatHex(amount % TWO_POW_128));
  calldata.push(formatHex(amount / TWO_POW_128));
  //   recipient
  calldata.push(proof.recipient);
  //   range_proof_data: Span<felt252>
  calldata.push(formatHex(BigInt(proof.range_proof_data.length)));
  proof.range_proof_data.forEach((d) => calldata.push(d));

  // pool_key
  calldata.push(poolKey.token0);
  calldata.push(poolKey.token1);
  calldata.push(poolKey.fee);
  calldata.push(poolKey.tick_spacing);
  calldata.push(poolKey.extension);

  // swap_params
  //   amount: i129 { mag: u128, sign: bool }
  const swapAmount = BigInt(params.inputAmount);
  calldata.push(formatHex(swapAmount)); // mag
  calldata.push("0x0"); // sign = false (positive = exact input, selling this amount)
  //   is_token1
  calldata.push(isToken1 ? "0x1" : "0x0");
  //   sqrt_ratio_limit: u256
  // Ekubo SDK MIN/MAX sqrt ratio limits
  // sqrt_ratio = sqrt(token1/token0). Selling token1 → sqrt_ratio INCREASES → MAX.
  // Selling token0 → sqrt_ratio DECREASES → MIN.
  // Ekubo sqrt_ratio limits (from ekubo starknet-typescript-sdk tick.ts)
  const MIN_SQRT_RATIO = 18446748437148339061n;
  const MAX_SQRT_RATIO = 6277100250585753475930931601400621808602321654880405518632n;
  if (isToken1) {
    // Selling token1: sqrt_ratio increases → MAX_SQRT_RATIO
    calldata.push(formatHex(MAX_SQRT_RATIO % TWO_POW_128)); // low
    calldata.push(formatHex(MAX_SQRT_RATIO / TWO_POW_128)); // high
  } else {
    // Selling token0: sqrt_ratio decreases → MIN_SQRT_RATIO
    calldata.push(formatHex(MIN_SQRT_RATIO)); // low
    calldata.push("0x0"); // high
  }
  //   skip_ahead
  calldata.push("0x0");

  // min_amount_out: u256
  const minOut = BigInt(params.minOutputAmount);
  calldata.push(formatHex(minOut % TWO_POW_128));
  calldata.push(formatHex(minOut / TWO_POW_128));

  // dest_pool
  calldata.push(params.destPool);

  // deposit_commitment: felt252
  calldata.push(params.depositCommitment);

  // deposit_amount_commitment: ECPoint { x, y }
  calldata.push(params.depositAmountCommitment.x);
  calldata.push(params.depositAmountCommitment.y);

  // deposit_asset_id: felt252
  calldata.push(params.depositAssetId);

  // deposit_range_proof: Span<felt252>
  calldata.push(formatHex(BigInt(params.depositRangeProof.length)));
  params.depositRangeProof.forEach((d) => calldata.push(d));

  return [
    {
      contractAddress: routerAddress,
      entrypoint: "shielded_swap",
      calldata,
    },
  ];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the privacy pool address for a token on a given network.
 */
export function getPrivacyPoolForToken(
  network: NetworkType,
  tokenSymbol: string
): string {
  const pools = PRIVACY_POOL_REGISTRY[network];
  if (!pools) return "0x0";
  return pools[tokenSymbol] || "0x0";
}

/**
 * Get token symbol from address.
 */
export function getTokenSymbolFromAddress(
  address: string,
  network: NetworkType = "sepolia"
): TokenSymbol | null {
  const tokens = EXTERNAL_TOKENS[network];
  if (!tokens) return null;

  const normalized = address.toLowerCase();
  for (const [symbol, addr] of Object.entries(tokens)) {
    if (addr.toLowerCase() === normalized) {
      return symbol as TokenSymbol;
    }
  }

  // Check SAGE token
  const sageAddr = CONTRACTS[network]?.SAGE_TOKEN;
  if (sageAddr && sageAddr.toLowerCase() === normalized) {
    return "SAGE" as TokenSymbol;
  }

  return null;
}

/**
 * Get supported swap pairs (tokens with deployed privacy pools).
 */
export function getSupportedSwapTokens(
  network: NetworkType = "sepolia"
): { symbol: string; address: string; hasPool: boolean }[] {
  const tokens = EXTERNAL_TOKENS[network];
  if (!tokens) return [];

  const result: { symbol: string; address: string; hasPool: boolean }[] = [];

  // Add SAGE first
  const sageAddr = CONTRACTS[network]?.SAGE_TOKEN;
  if (sageAddr && sageAddr !== "0x0") {
    result.push({
      symbol: "SAGE",
      address: sageAddr,
      hasPool: getPrivacyPoolForToken(network, "SAGE") !== "0x0",
    });
  }

  // Add external tokens
  for (const [symbol, address] of Object.entries(tokens)) {
    if (address !== "0x0") {
      result.push({
        symbol,
        address,
        hasPool: getPrivacyPoolForToken(network, symbol) !== "0x0",
      });
    }
  }

  return result;
}

/**
 * Validate that both source and destination privacy pools are deployed
 * for a given token pair on the specified network.
 */
export function validateSwapPrerequisites(
  inputSymbol: string,
  outputSymbol: string,
  network: string
): { valid: boolean; error?: string } {
  const sourcePool = getPrivacyPoolForToken(network as NetworkType, inputSymbol);
  const destPool = getPrivacyPoolForToken(network as NetworkType, outputSymbol);

  if (sourcePool === "0x0" && destPool === "0x0") {
    return {
      valid: false,
      error: `No privacy pool deployed for ${inputSymbol} or ${outputSymbol}`,
    };
  }
  if (sourcePool === "0x0") {
    return {
      valid: false,
      error: `No privacy pool deployed for ${inputSymbol}`,
    };
  }
  if (destPool === "0x0") {
    return {
      valid: false,
      error: `No privacy pool deployed for ${outputSymbol}`,
    };
  }

  return { valid: true };
}

/**
 * Get the on-chain asset ID for a token symbol.
 * Used for deposit_asset_id in shielded swap calldata.
 */
export function getAssetIdForToken(tokenSymbol: string): string {
  const assetIds: Record<string, string> = {
    SAGE: "0x0",
    ETH: "0x1",
    STRK: "0x2",
    USDC: "0x3",
    wBTC: "0x4",
  };
  return assetIds[tokenSymbol] || "0x0";
}

/**
 * Format token amount for display with proper decimals.
 */
export function formatTokenAmount(
  amountWei: bigint | string,
  symbol: string,
  maxDecimals: number = 6
): string {
  const meta = TOKEN_METADATA[symbol as keyof typeof TOKEN_METADATA];
  const decimals = meta?.decimals ?? 18;
  const amount = BigInt(amountWei);
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;

  if (fraction === 0n) return `${whole} ${symbol}`;

  const fractionStr = fraction.toString().padStart(decimals, "0");
  const trimmed = fractionStr.slice(0, maxDecimals).replace(/0+$/, "");

  return trimmed ? `${whole}.${trimmed} ${symbol}` : `${whole} ${symbol}`;
}
