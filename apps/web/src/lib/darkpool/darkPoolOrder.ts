/**
 * Dark Pool Order Service
 *
 * Client-side order construction for the commit-reveal batch auction.
 * Handles: order hashing, Pedersen commitments, balance proofs, calldata,
 * contract reads (epoch, balances, results), event parsing,
 * and IndexedDB storage of order notes.
 *
 * Privacy flow:
 *   1. Build order (price, amount, side, pair)
 *   2. Commit phase: submit H(order) + amount commitment + balance proof
 *   3. Reveal phase: open commitment with plaintext + salt
 *   4. Settle phase: contract matches at uniform clearing price
 */

import { hash, RpcProvider, type Call } from "starknet";
import { commit, commitmentToContractFormat } from "../crypto/pedersen";
import { randomScalar, mod } from "../crypto/elgamal";
import { CURVE_ORDER, type ElGamalCiphertext } from "../crypto/constants";
import type { ECPoint } from "../crypto/constants";
import {
  CONTRACTS,
  ASSET_ID_FOR_TOKEN,
  TOKEN_METADATA,
  NETWORK_CONFIG,
  type NetworkType,
  type TokenSymbol,
  getTokenAddressForSymbol,
  getRpcUrl,
} from "../contracts/addresses";

// ============================================================================
// Types
// ============================================================================

export interface DarkPoolOrder {
  price: bigint;           // Price in 18-decimal fixed point
  amount: bigint;          // Amount in token decimals
  side: "buy" | "sell";
  giveAsset: string;       // Asset ID (felt252 hex)
  wantAsset: string;       // Asset ID (felt252 hex)
  salt: bigint;            // Random salt for commitment
  amountBlinding: bigint;  // Pedersen blinding factor
}

export interface DarkPoolOrderNote {
  orderId: bigint;
  order: DarkPoolOrder;
  epoch: number;
  status: "committed" | "revealed" | "filled" | "claimed" | "cancelled" | "expired";
  trader?: string;         // Wallet address that created this note
  commitTxHash?: string;
  revealTxHash?: string;
  fillAmount?: bigint;
  clearingPrice?: bigint;
  createdAt: number;
}

export interface TradingPairInfo {
  giveSymbol: TokenSymbol;
  wantSymbol: TokenSymbol;
  giveAssetId: string;
  wantAssetId: string;
  label: string;
}

export type ContractEpochPhase = "Commit" | "Reveal" | "Settle" | "Closed";

export interface ContractEpochInfo {
  epoch: number;
  phase: ContractEpochPhase;
  genesisBlock: number;
  epochDuration: number;
  currentBlock: number;
  blocksInPhase: number;
  blocksRemaining: number;
  secondsRemaining: number;
}

export interface ContractEpochResult {
  epochId: number;
  clearingPrice: bigint;
  totalBuyFilled: bigint;
  totalSellFilled: bigint;
  numFills: number;
  settledAt: number;
}

export interface ContractOrderView {
  orderId: bigint;
  trader: string;
  side: "buy" | "sell";
  giveAsset: string;
  wantAsset: string;
  epoch: number;
  status: string;
  price: bigint;
  amount: bigint;
  fillAmount: bigint;
}

// ============================================================================
// Trading Pairs
// ============================================================================

export const DARK_POOL_PAIRS: TradingPairInfo[] = [
  {
    giveSymbol: "ETH",
    wantSymbol: "STRK",
    giveAssetId: ASSET_ID_FOR_TOKEN.ETH,
    wantAssetId: ASSET_ID_FOR_TOKEN.STRK,
    label: "ETH/STRK",
  },
  {
    giveSymbol: "ETH",
    wantSymbol: "USDC",
    giveAssetId: ASSET_ID_FOR_TOKEN.ETH,
    wantAssetId: ASSET_ID_FOR_TOKEN.USDC,
    label: "ETH/USDC",
  },
  {
    giveSymbol: "wBTC",
    wantSymbol: "ETH",
    giveAssetId: ASSET_ID_FOR_TOKEN.wBTC,
    wantAssetId: ASSET_ID_FOR_TOKEN.ETH,
    label: "wBTC/ETH",
  },
  {
    giveSymbol: "wBTC",
    wantSymbol: "STRK",
    giveAssetId: ASSET_ID_FOR_TOKEN.wBTC,
    wantAssetId: ASSET_ID_FOR_TOKEN.STRK,
    label: "wBTC/STRK",
  },
  {
    giveSymbol: "wBTC",
    wantSymbol: "USDC",
    giveAssetId: ASSET_ID_FOR_TOKEN.wBTC,
    wantAssetId: ASSET_ID_FOR_TOKEN.USDC,
    label: "wBTC/USDC",
  },
  {
    giveSymbol: "SAGE",
    wantSymbol: "STRK",
    giveAssetId: ASSET_ID_FOR_TOKEN.SAGE,
    wantAssetId: ASSET_ID_FOR_TOKEN.STRK,
    label: "SAGE/STRK",
  },
];

// ============================================================================
// RPC Provider
// ============================================================================

const _providers: Map<string, RpcProvider> = new Map();

function getProvider(network: NetworkType): RpcProvider {
  const rpcUrl = getRpcUrl(network);
  let provider = _providers.get(rpcUrl);
  if (!provider) {
    provider = new RpcProvider({ nodeUrl: rpcUrl });
    _providers.set(rpcUrl, provider);
  }
  return provider;
}

// ============================================================================
// Dark Pool ABI (minimal — for contract reads)
// ============================================================================

const DARK_POOL_ABI = [
  {
    name: "get_current_epoch",
    type: "function",
    inputs: [],
    outputs: [{ name: "epoch", type: "core::integer::u64" }],
    state_mutability: "view",
  },
  {
    name: "get_epoch_phase",
    type: "function",
    inputs: [],
    outputs: [{ name: "phase", type: "dark_pool_auction::dark_pool_auction::EpochPhase" }],
    state_mutability: "view",
  },
  {
    name: "get_encrypted_balance",
    type: "function",
    inputs: [
      { name: "trader", type: "core::starknet::contract_address::ContractAddress" },
      { name: "asset", type: "core::felt252" },
    ],
    outputs: [{ name: "balance", type: "dark_pool_auction::dark_pool_auction::ElGamalCiphertext" }],
    state_mutability: "view",
  },
  {
    name: "get_epoch_result",
    type: "function",
    inputs: [{ name: "epoch_id", type: "core::integer::u64" }],
    outputs: [{ name: "result", type: "dark_pool_auction::dark_pool_auction::EpochResult" }],
    state_mutability: "view",
  },
  {
    name: "get_order",
    type: "function",
    inputs: [{ name: "order_id", type: "core::integer::u256" }],
    outputs: [{ name: "order", type: "dark_pool_auction::dark_pool_auction::OrderView" }],
    state_mutability: "view",
  },
  {
    name: "get_epoch_orders",
    type: "function",
    inputs: [{ name: "epoch_id", type: "core::integer::u64" }],
    outputs: [{ name: "orders", type: "core::array::Array::<core::integer::u256>" }],
    state_mutability: "view",
  },
  {
    name: "is_order_claimed",
    type: "function",
    inputs: [{ name: "order_id", type: "core::integer::u256" }],
    outputs: [{ name: "claimed", type: "core::bool" }],
    state_mutability: "view",
  },
  {
    name: "get_epoch_pair_result",
    type: "function",
    inputs: [
      { name: "epoch_id", type: "core::integer::u64" },
      { name: "give_asset", type: "core::felt252" },
      { name: "want_asset", type: "core::felt252" },
    ],
    outputs: [{ name: "result", type: "dark_pool_auction::dark_pool_auction::EpochResult" }],
    state_mutability: "view",
  },
  {
    name: "get_session_key",
    type: "function",
    inputs: [
      { name: "owner", type: "core::starknet::contract_address::ContractAddress" },
    ],
    outputs: [{ name: "key", type: "core::felt252" }],
    state_mutability: "view",
  },
  {
    name: "get_epoch_duration",
    type: "function",
    inputs: [],
    outputs: [{ name: "duration", type: "core::integer::u64" }],
    state_mutability: "view",
  },
] as const;

// ============================================================================
// Contract Read Functions
// ============================================================================

/**
 * Get the dark pool contract address for a network
 */
export function getDarkPoolAddress(network: NetworkType): string {
  return (CONTRACTS[network] as Record<string, string>)?.DARK_POOL ?? "0x0";
}

/**
 * Read current epoch & phase from the contract (on-chain truth)
 */
export async function readEpochFromContract(
  network: NetworkType,
): Promise<ContractEpochInfo | null> {
  const contractAddress = getDarkPoolAddress(network);
  if (contractAddress === "0x0") return null;

  const provider = getProvider(network);

  try {
    // D11: Parallel reads: epoch, phase, block number, epoch_duration
    const [epochResult, phaseResult, blockResult, durationResult] = await Promise.all([
      provider.callContract({
        contractAddress,
        entrypoint: "get_current_epoch",
        calldata: [],
      }),
      provider.callContract({
        contractAddress,
        entrypoint: "get_epoch_phase",
        calldata: [],
      }),
      provider.getBlockNumber(),
      provider.callContract({
        contractAddress,
        entrypoint: "get_epoch_duration",
        calldata: [],
      }).catch(() => null), // Fall back to default if view doesn't exist (pre-upgrade)
    ]);

    const epoch = Number(BigInt(epochResult[0]));
    const phaseIndex = Number(BigInt(phaseResult[0]));
    const currentBlock = blockResult;

    const phaseMap: ContractEpochPhase[] = ["Commit", "Reveal", "Settle", "Closed"];
    const phase = phaseMap[phaseIndex] ?? "Closed";

    // D11: Read epoch_duration from contract, fall back to 50 (current on-chain default)
    // Estimate blocks remaining in phase
    // Contract uses: epoch_duration per phase, 3 phases per epoch
    // phase = ((current_block - genesis_block) % (3 * epoch_duration)) / epoch_duration
    const epochDuration = durationResult ? Number(BigInt(durationResult[0])) || 50 : 50;
    const totalEpochBlocks = 3 * epochDuration;
    const phaseOffset = phaseIndex * epochDuration;
    const blocksInPhase = epochDuration;
    // Account for genesis block offset — contract uses (current_block - genesis_block)
    // The epoch number from contract already factors this in, so we derive offset from epoch
    const genesisBlock = epoch > 0 ? currentBlock - (Number(BigInt(epoch.toString())) * totalEpochBlocks + phaseOffset + 1) : 0;
    const blocksSinceGenesis = currentBlock - genesisBlock;
    const blocksSinceEpochStart = blocksSinceGenesis % totalEpochBlocks;
    const blocksIntoPhase = blocksSinceEpochStart - phaseOffset;
    const blocksRemaining = Math.max(0, blocksInPhase - Math.max(0, blocksIntoPhase));

    return {
      epoch,
      phase,
      genesisBlock,
      epochDuration,
      currentBlock,
      blocksInPhase,
      blocksRemaining: blocksRemaining || 1,
      secondsRemaining: (blocksRemaining || 1) * 4, // ~4s per block
    };
  } catch (err) {
    console.warn("[DarkPool] Failed to read epoch from contract:", err);
    return null;
  }
}

/**
 * Read encrypted balance for a trader + asset from contract
 */
export async function readEncryptedBalance(
  network: NetworkType,
  trader: string,
  assetId: string,
): Promise<ElGamalCiphertext | null> {
  const contractAddress = getDarkPoolAddress(network);
  if (contractAddress === "0x0") return null;

  const provider = getProvider(network);

  try {
    const result = await provider.callContract({
      contractAddress,
      entrypoint: "get_encrypted_balance",
      calldata: [trader, assetId],
    });

    // Result returns 4 felts: l_x, l_y, r_x, r_y (matching Cairo ElGamalCiphertext)
    const c1_x = BigInt(result[0] || "0");
    const c1_y = BigInt(result[1] || "0");
    const c2_x = BigInt(result[2] || "0");
    const c2_y = BigInt(result[3] || "0");

    // Zero ciphertext = no balance deposited yet
    if (c1_x === 0n && c1_y === 0n && c2_x === 0n && c2_y === 0n) {
      return null;
    }

    return { c1_x, c1_y, c2_x, c2_y };
  } catch (err) {
    console.warn("[DarkPool] Failed to read encrypted balance:", err);
    return null;
  }
}

/**
 * Read AE hint for a trader + asset from contract (for O(1) balance decryption)
 */
export async function readBalanceHint(
  network: NetworkType,
  trader: string,
  assetId: string,
): Promise<{ encryptedAmount: bigint; nonce: bigint; mac: bigint } | null> {
  const contractAddress = getDarkPoolAddress(network);
  if (contractAddress === "0x0") return null;

  const provider = getProvider(network);

  try {
    const result = await provider.callContract({
      contractAddress,
      entrypoint: "get_balance_hint",
      calldata: [trader, assetId],
    });

    const encryptedAmount = BigInt(result[0] || "0");
    const nonce = BigInt(result[1] || "0");
    const mac = BigInt(result[2] || "0");

    // Zero hint = no hint stored
    if (encryptedAmount === 0n && nonce === 0n && mac === 0n) {
      return null;
    }

    return { encryptedAmount, nonce, mac };
  } catch {
    // View function may not exist yet (pre-upgrade) — fall back to local cache
    return loadCachedHint(trader, assetId);
  }
}

// ============================================================================
// Local AE Hint Cache (fallback before contract upgrade)
// ============================================================================

const HINT_CACHE_KEY = "obelysk-darkpool-hints";

interface CachedHintEntry {
  trader: string;
  assetId: string;
  encryptedAmount: string;
  nonce: string;
  mac: string;
}

/**
 * Cache an AE hint locally (used during deposit before contract upgrade)
 */
export function cacheHintLocally(
  trader: string,
  assetId: string,
  hint: { encryptedAmount: bigint; nonce: bigint; mac: bigint },
): void {
  try {
    const raw = localStorage.getItem(HINT_CACHE_KEY);
    const cache: CachedHintEntry[] = raw ? JSON.parse(raw) : [];
    // Upsert
    const idx = cache.findIndex((e) => e.trader === trader && e.assetId === assetId);
    const entry: CachedHintEntry = {
      trader,
      assetId,
      encryptedAmount: hint.encryptedAmount.toString(),
      nonce: hint.nonce.toString(),
      mac: hint.mac.toString(),
    };
    if (idx >= 0) cache[idx] = entry;
    else cache.push(entry);
    localStorage.setItem(HINT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage unavailable (SSR)
  }
}

/**
 * Load a cached hint from local storage
 */
function loadCachedHint(
  trader: string,
  assetId: string,
): { encryptedAmount: bigint; nonce: bigint; mac: bigint } | null {
  try {
    const raw = localStorage.getItem(HINT_CACHE_KEY);
    if (!raw) return null;
    const cache: CachedHintEntry[] = JSON.parse(raw);
    const entry = cache.find((e) => e.trader === trader && e.assetId === assetId);
    if (!entry) return null;
    return {
      encryptedAmount: BigInt(entry.encryptedAmount),
      nonce: BigInt(entry.nonce),
      mac: BigInt(entry.mac),
    };
  } catch {
    return null;
  }
}

/**
 * Read epoch settlement result from contract
 */
export async function readEpochResult(
  network: NetworkType,
  epochId: number,
): Promise<ContractEpochResult | null> {
  const contractAddress = getDarkPoolAddress(network);
  if (contractAddress === "0x0") return null;

  const provider = getProvider(network);

  try {
    const result = await provider.callContract({
      contractAddress,
      entrypoint: "get_epoch_result",
      calldata: [epochId.toString()],
    });

    // Returns: epoch_id, clearing_price (u256 = 2 felts), total_buy_filled (u256), total_sell_filled (u256), num_fills, settled_at
    const resultEpochId = Number(BigInt(result[0] || "0"));
    const clearingPrice = (BigInt(result[2] || "0") << 128n) | BigInt(result[1] || "0");
    const totalBuyFilled = (BigInt(result[4] || "0") << 128n) | BigInt(result[3] || "0");
    const totalSellFilled = (BigInt(result[6] || "0") << 128n) | BigInt(result[5] || "0");
    const numFills = Number(BigInt(result[7] || "0"));
    const settledAt = Number(BigInt(result[8] || "0"));

    // If never settled, settled_at will be 0
    if (settledAt === 0 && clearingPrice === 0n) return null;

    return {
      epochId: resultEpochId,
      clearingPrice,
      totalBuyFilled,
      totalSellFilled,
      numFills,
      settledAt,
    };
  } catch (err) {
    console.warn("[DarkPool] Failed to read epoch result:", err);
    return null;
  }
}

/**
 * Read epoch settlement result for a specific trading pair
 */
export async function readEpochPairResult(
  network: NetworkType,
  epochId: number,
  giveAsset: string,
  wantAsset: string,
): Promise<ContractEpochResult | null> {
  const contractAddress = getDarkPoolAddress(network);
  if (contractAddress === "0x0") return null;

  const provider = getProvider(network);

  try {
    const result = await provider.callContract({
      contractAddress,
      entrypoint: "get_epoch_pair_result",
      calldata: [epochId.toString(), giveAsset, wantAsset],
    });

    // Returns: epoch_id, clearing_price (u256 = 2 felts), total_buy_filled (u256), total_sell_filled (u256), num_fills, settled_at
    const resultEpochId = Number(BigInt(result[0] || "0"));
    const clearingPrice = (BigInt(result[2] || "0") << 128n) | BigInt(result[1] || "0");
    const totalBuyFilled = (BigInt(result[4] || "0") << 128n) | BigInt(result[3] || "0");
    const totalSellFilled = (BigInt(result[6] || "0") << 128n) | BigInt(result[5] || "0");
    const numFills = Number(BigInt(result[7] || "0"));
    const settledAt = Number(BigInt(result[8] || "0"));

    if (settledAt === 0 && clearingPrice === 0n) return null;

    return {
      epochId: resultEpochId,
      clearingPrice,
      totalBuyFilled,
      totalSellFilled,
      numFills,
      settledAt,
    };
  } catch (err) {
    console.warn("[DarkPool] Failed to read epoch pair result:", err);
    return null;
  }
}

/**
 * Read a single order view from contract
 */
export async function readOrderFromContract(
  network: NetworkType,
  orderId: bigint,
): Promise<ContractOrderView | null> {
  const contractAddress = getDarkPoolAddress(network);
  if (contractAddress === "0x0") return null;

  const provider = getProvider(network);

  try {
    const idLow = "0x" + (orderId & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toString(16);
    const idHigh = "0x" + (orderId >> 128n).toString(16);

    const result = await provider.callContract({
      contractAddress,
      entrypoint: "get_order",
      calldata: [idLow, idHigh],
    });

    // OrderView: order_id (u256=2), trader (felt), side (enum=1), give_asset, want_asset, epoch (u64), status (enum=1), price (u256=2), amount (u256=2), fill_amount (u256=2)
    const rOrderId = (BigInt(result[1] || "0") << 128n) | BigInt(result[0] || "0");
    const trader = result[2] || "0x0";
    const sideIndex = Number(BigInt(result[3] || "0"));
    const giveAsset = result[4] || "0x0";
    const wantAsset = result[5] || "0x0";
    const epoch = Number(BigInt(result[6] || "0"));
    const statusIndex = Number(BigInt(result[7] || "0"));
    const price = (BigInt(result[9] || "0") << 128n) | BigInt(result[8] || "0");
    const amount = (BigInt(result[11] || "0") << 128n) | BigInt(result[10] || "0");
    const fillAmount = (BigInt(result[13] || "0") << 128n) | BigInt(result[12] || "0");

    const sideMap = ["buy", "sell"] as const;
    const statusMap = ["Committed", "Revealed", "Filled", "PartialFill", "Cancelled", "Expired"];

    return {
      orderId: rOrderId,
      trader,
      side: sideMap[sideIndex] ?? "buy",
      giveAsset,
      wantAsset,
      epoch,
      status: statusMap[statusIndex] ?? "Committed",
      price,
      amount,
      fillAmount,
    };
  } catch (err) {
    console.warn("[DarkPool] Failed to read order:", err);
    return null;
  }
}

/**
 * Check if a filled order has already been claimed
 */
export async function readIsOrderClaimed(
  network: NetworkType,
  orderId: bigint,
): Promise<boolean> {
  const contractAddress = getDarkPoolAddress(network);
  if (contractAddress === "0x0") return false;

  const provider = getProvider(network);

  try {
    const idLow = "0x" + (orderId & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toString(16);
    const idHigh = "0x" + (orderId >> 128n).toString(16);

    const result = await provider.callContract({
      contractAddress,
      entrypoint: "is_order_claimed",
      calldata: [idLow, idHigh],
    });

    return BigInt(result[0] || "0") !== 0n;
  } catch {
    // View function may not exist on older deployment — assume not claimed
    return false;
  }
}

// ============================================================================
// Event Parsing (extract order ID from tx receipt)
// ============================================================================

/**
 * Parse OrderCommitted event from a transaction receipt to extract the real order ID.
 * The commit_order function returns u256 and emits OrderCommitted { order_id, ... }
 */
export function parseOrderIdFromReceipt(
  receipt: { events?: Array<{ keys?: string[]; data?: string[] }> },
): bigint | null {
  if (!receipt?.events) return null;

  // OrderCommitted event selector = sn_keccak("OrderCommitted")
  // D4: Use BigInt comparison to handle leading-zero differences in felt-hex
  const orderCommittedSelectorBigInt = BigInt(hash.getSelectorFromName("OrderCommitted"));

  // Keys: [event_selector, order_id_low, order_id_high, trader]
  for (const event of receipt.events) {
    const keys = event.keys ?? [];
    if (keys.length < 3) continue;

    try {
      // D4: Normalize both sides with BigInt() — avoids hex leading-zero mismatches
      if (BigInt(keys[0]) !== orderCommittedSelectorBigInt) continue;

      // In Cairo: #[key] order_id: u256 → emitted as 2 keys (low, high)
      const orderIdLow = BigInt(keys[1]);
      const orderIdHigh = BigInt(keys[2]);
      const orderId = (orderIdHigh << 128n) | orderIdLow;
      if (orderId > 0n) return orderId;
    } catch {
      // Malformed event data — skip
      continue;
    }
  }

  return null;
}

// ============================================================================
// Order Hash Computation
// ============================================================================

/**
 * Compute the order commitment hash: H(price, amount, side, giveAsset, wantAsset, salt)
 * Uses Poseidon hash (ZK-friendly, matches on-chain computation)
 */
export function computeOrderHash(order: DarkPoolOrder): bigint {
  const sideFelt = order.side === "buy" ? "0x0" : "0x1";
  const priceLow = "0x" + (order.price & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toString(16);
  const priceHigh = "0x" + (order.price >> 128n).toString(16);
  const amountLow = "0x" + (order.amount & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toString(16);
  const amountHigh = "0x" + (order.amount >> 128n).toString(16);

  const result = hash.computePoseidonHashOnElements([
    priceLow,
    priceHigh,
    amountLow,
    amountHigh,
    sideFelt,
    order.giveAsset,
    order.wantAsset,
    "0x" + order.salt.toString(16),
  ]);

  return BigInt(result);
}

// ============================================================================
// Amount Commitment
// ============================================================================

/**
 * Build Pedersen commitment to the order amount: C = g^amount * h^blinding
 * Used during commit phase to lock the amount without revealing it.
 */
export function commitOrderAmount(
  amount: bigint,
  blinding: bigint,
): { commitment: ECPoint; formatted: { x: string; y: string } } {
  const commitment = commit(amount, blinding);
  const formatted = commitmentToContractFormat(commitment);
  return { commitment, formatted };
}

/**
 * Create a new dark pool order with random salt and blinding
 */
export function createOrder(
  price: number,
  amount: number,
  side: "buy" | "sell",
  pair: TradingPairInfo,
  decimals: number = 18,
): DarkPoolOrder {
  const priceBigInt = BigInt(Math.round(price * 1e18)); // 18-decimal fixed point
  const amountBigInt = BigInt(Math.round(amount * 10 ** decimals));

  return {
    price: priceBigInt,
    amount: amountBigInt,
    side,
    giveAsset: side === "sell" ? pair.giveAssetId : pair.wantAssetId,
    wantAsset: side === "sell" ? pair.wantAssetId : pair.giveAssetId,
    salt: randomScalar(),
    amountBlinding: randomScalar(),
  };
}

// ============================================================================
// Balance Proof (Simplified)
// ============================================================================

/**
 * Build a balance proof with Poseidon Fiat-Shamir binding.
 * Challenge = poseidon(commitment.x, commitment.y, trader, asset)
 * This must match the on-chain verification in _verify_balance_proof.
 */
export function buildBalanceProof(
  _encBalance: ElGamalCiphertext | null,
  _amount: bigint,
  sk: bigint,
  trader?: string,
  asset?: string,
): { commitment: { x: string; y: string }; challenge: string; response: string } {
  // Generate a Schnorr-style proof of knowledge
  const k = randomScalar();
  const commitX = "0x" + mod(k, CURVE_ORDER).toString(16);
  const commitY = "0x" + mod(k * 2n, CURVE_ORDER).toString(16);

  // Compute challenge via Poseidon Fiat-Shamir: H(commit.x, commit.y, trader, asset)
  const traderFelt = trader || "0x0";
  const assetFelt = asset || "0x0";
  const challenge = BigInt(
    hash.computePoseidonHashOnElements([commitX, commitY, traderFelt, assetFelt])
  );
  const response = mod(k + challenge * sk, CURVE_ORDER);

  return {
    commitment: { x: commitX, y: commitY },
    challenge: "0x" + challenge.toString(16),
    response: "0x" + response.toString(16),
  };
}

// ============================================================================
// Transaction Calldata Builders
// ============================================================================

/**
 * Build commit transaction calls
 */
export function buildCommitCalls(
  order: DarkPoolOrder,
  proof: { commitment: { x: string; y: string }; challenge: string; response: string },
  contractAddress: string,
): Call[] {
  const orderHash = computeOrderHash(order);
  const { formatted: amountCommitment } = commitOrderAmount(order.amount, order.amountBlinding);
  const side = order.side === "buy" ? "0" : "1"; // enum variant index

  return [
    {
      contractAddress,
      entrypoint: "commit_order",
      calldata: [
        "0x" + orderHash.toString(16),       // order_hash
        amountCommitment.x,                    // amount_commitment.x
        amountCommitment.y,                    // amount_commitment.y
        side,                                  // side (Buy=0, Sell=1)
        order.giveAsset,                       // give_asset
        order.wantAsset,                       // want_asset
        proof.commitment.x,                    // balance_proof.commitment.x
        proof.commitment.y,                    // balance_proof.commitment.y
        proof.challenge,                       // balance_proof.challenge
        proof.response,                        // balance_proof.response
      ],
    },
  ];
}

/**
 * Build reveal transaction calls
 */
export function buildRevealCalls(
  orderId: bigint,
  order: DarkPoolOrder,
  contractAddress: string,
): Call[] {
  const priceLow = "0x" + (order.price & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toString(16);
  const priceHigh = "0x" + (order.price >> 128n).toString(16);
  const amountLow = "0x" + (order.amount & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toString(16);
  const amountHigh = "0x" + (order.amount >> 128n).toString(16);

  return [
    {
      contractAddress,
      entrypoint: "reveal_order",
      calldata: [
        "0x" + (orderId & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toString(16),
        "0x" + (orderId >> 128n).toString(16),
        priceLow,
        priceHigh,
        amountLow,
        amountHigh,
        "0x" + order.salt.toString(16),
        "0x" + order.amountBlinding.toString(16),
      ],
    },
  ];
}

/**
 * Build cancel transaction calls
 */
export function buildCancelCalls(orderId: bigint, contractAddress: string): Call[] {
  return [
    {
      contractAddress,
      entrypoint: "cancel_order",
      calldata: [
        "0x" + (orderId & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toString(16),
        "0x" + (orderId >> 128n).toString(16),
      ],
    },
  ];
}

/**
 * Build settle epoch transaction calls (permissionless)
 */
export function buildSettleCalls(epochId: number, contractAddress: string): Call[] {
  return [
    {
      contractAddress,
      entrypoint: "settle_epoch",
      calldata: [epochId.toString()],
    },
  ];
}

/**
 * Build deposit transaction calls (ERC20 approve + deposit)
 */
export function buildDepositCalls(
  asset: string,
  amount: bigint,
  encryptedAmount: ElGamalCiphertext,
  aeHint: { encryptedAmount: bigint; nonce: bigint; mac: bigint },
  tokenAddress: string,
  contractAddress: string,
): Call[] {
  const amountLow = "0x" + (amount & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toString(16);
  const amountHigh = "0x" + (amount >> 128n).toString(16);

  return [
    // Approve
    {
      contractAddress: tokenAddress,
      entrypoint: "approve",
      calldata: [contractAddress, amountLow, amountHigh],
    },
    // Deposit
    {
      contractAddress,
      entrypoint: "deposit",
      calldata: [
        asset,
        amountLow,
        amountHigh,
        "0x" + encryptedAmount.c1_x.toString(16),
        "0x" + encryptedAmount.c1_y.toString(16),
        "0x" + encryptedAmount.c2_x.toString(16),
        "0x" + encryptedAmount.c2_y.toString(16),
        "0x" + aeHint.encryptedAmount.toString(16),
        "0x" + aeHint.nonce.toString(16),
        "0x" + aeHint.mac.toString(16),
      ],
    },
  ];
}

/**
 * Build withdraw transaction calls
 * Includes encrypted_amount and ae_hint for homomorphic balance subtraction
 */
export function buildWithdrawCalls(
  asset: string,
  amount: bigint,
  encryptedAmount: ElGamalCiphertext,
  aeHint: { encryptedAmount: bigint; nonce: bigint; mac: bigint },
  proof: { commitment: { x: string; y: string }; challenge: string; response: string },
  contractAddress: string,
): Call[] {
  const amountLow = "0x" + (amount & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toString(16);
  const amountHigh = "0x" + (amount >> 128n).toString(16);

  return [
    {
      contractAddress,
      entrypoint: "withdraw",
      calldata: [
        asset,
        amountLow,
        amountHigh,
        // encrypted_amount (ElGamalCiphertext — 4 felts)
        "0x" + encryptedAmount.c1_x.toString(16),
        "0x" + encryptedAmount.c1_y.toString(16),
        "0x" + encryptedAmount.c2_x.toString(16),
        "0x" + encryptedAmount.c2_y.toString(16),
        // ae_hint (3 felts)
        "0x" + aeHint.encryptedAmount.toString(16),
        "0x" + aeHint.nonce.toString(16),
        "0x" + aeHint.mac.toString(16),
        // balance_proof (4 felts)
        proof.commitment.x,
        proof.commitment.y,
        proof.challenge,
        proof.response,
      ],
    },
  ];
}

/**
 * Build claim_fill transaction calls.
 * Called after settlement to update encrypted balances with fill amounts.
 */
export function buildClaimFillCalls(
  orderId: bigint,
  receiveEncrypted: ElGamalCiphertext,
  receiveHint: { encryptedAmount: bigint; nonce: bigint; mac: bigint },
  spendEncrypted: ElGamalCiphertext,
  spendHint: { encryptedAmount: bigint; nonce: bigint; mac: bigint },
  contractAddress: string,
): Call[] {
  const idLow = "0x" + (orderId & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")).toString(16);
  const idHigh = "0x" + (orderId >> 128n).toString(16);

  return [
    {
      contractAddress,
      entrypoint: "claim_fill",
      calldata: [
        idLow,
        idHigh,
        // receive_encrypted (ElGamalCiphertext — 4 felts)
        "0x" + receiveEncrypted.c1_x.toString(16),
        "0x" + receiveEncrypted.c1_y.toString(16),
        "0x" + receiveEncrypted.c2_x.toString(16),
        "0x" + receiveEncrypted.c2_y.toString(16),
        // receive_hint (3 felts)
        "0x" + receiveHint.encryptedAmount.toString(16),
        "0x" + receiveHint.nonce.toString(16),
        "0x" + receiveHint.mac.toString(16),
        // spend_encrypted (ElGamalCiphertext — 4 felts)
        "0x" + spendEncrypted.c1_x.toString(16),
        "0x" + spendEncrypted.c1_y.toString(16),
        "0x" + spendEncrypted.c2_x.toString(16),
        "0x" + spendEncrypted.c2_y.toString(16),
        // spend_hint (3 felts)
        "0x" + spendHint.encryptedAmount.toString(16),
        "0x" + spendHint.nonce.toString(16),
        "0x" + spendHint.mac.toString(16),
      ],
    },
  ];
}

// ============================================================================
// Session Key & Outside Execution Builders
// ============================================================================

/**
 * Build register_session_key transaction calls.
 * Registers a STARK public key for delegated execution.
 */
export function buildRegisterSessionKeyCalls(
  sessionPublicKey: string,
  contractAddress: string,
): Call[] {
  return [
    {
      contractAddress,
      entrypoint: "register_session_key",
      calldata: [sessionPublicKey],
    },
  ];
}

/**
 * Build revoke_session_key transaction calls
 */
export function buildRevokeSessionKeyCalls(contractAddress: string): Call[] {
  return [
    {
      contractAddress,
      entrypoint: "revoke_session_key",
      calldata: [],
    },
  ];
}

/**
 * Build execute_from_outside transaction calls (for relay submission).
 * The relay account submits this call on behalf of the user.
 *
 * Contract signature: execute_from_outside(caller, nonce, execute_after, execute_before,
 *   call_entrypoint, call_calldata: Array<felt252>, signature: Array<felt252>)
 */
export function buildExecuteFromOutsideCalls(
  caller: string,
  nonce: string,
  executeAfter: number,
  executeBefore: number,
  callEntrypoint: string,
  callCalldata: string[],
  signature: string[],
  contractAddress: string,
): Call[] {
  return [
    {
      contractAddress,
      entrypoint: "execute_from_outside",
      calldata: [
        caller,
        nonce,
        "0x" + executeAfter.toString(16),
        "0x" + executeBefore.toString(16),
        callEntrypoint,
        // Array<felt252> is serialized as: length, ...elements
        callCalldata.length.toString(),
        ...callCalldata,
        signature.length.toString(),
        ...signature,
      ],
    },
  ];
}

/**
 * Read a user's registered session key from the contract
 */
export async function readSessionKey(
  network: NetworkType,
  owner: string,
): Promise<string | null> {
  const contractAddress = getDarkPoolAddress(network);
  if (contractAddress === "0x0") return null;

  const provider = getProvider(network);

  try {
    const result = await provider.callContract({
      contractAddress,
      entrypoint: "get_session_key",
      calldata: [owner],
    });
    const key = result[0] || "0x0";
    return key === "0x0" ? null : key;
  } catch {
    return null;
  }
}

// ============================================================================
// IndexedDB Order Note Storage
// ============================================================================

const DB_NAME = "obelysk-darkpool";
const DB_VERSION = 1;
const STORE_NAME = "order-notes";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "orderId" });
        store.createIndex("by-epoch", "epoch");
        store.createIndex("by-status", "status");
      }
    };
  });
}

/**
 * Store an order note in IndexedDB.
 * The `trader` field scopes notes by wallet address.
 */
export async function storeOrderNote(note: DarkPoolOrderNote, trader?: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    // Serialize bigints for storage
    const serialized = {
      ...note,
      orderId: note.orderId.toString(),
      trader: trader ?? note.trader ?? "",
      order: {
        ...note.order,
        price: note.order.price.toString(),
        amount: note.order.amount.toString(),
        salt: note.order.salt.toString(),
        amountBlinding: note.order.amountBlinding.toString(),
      },
      fillAmount: note.fillAmount?.toString(),
      clearingPrice: note.clearingPrice?.toString(),
    };
    store.put(serialized);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Deserialize a raw IndexedDB record into a DarkPoolOrderNote.
 * Returns null if the record is corrupted.
 */
function deserializeOrderNote(raw: unknown): DarkPoolOrderNote | null {
  try {
    const r = raw as Record<string, unknown>;
    const orderRaw = r.order as Record<string, string>;
    return {
      ...r,
      orderId: BigInt(r.orderId as string),
      order: {
        ...orderRaw,
        price: BigInt(orderRaw.price),
        amount: BigInt(orderRaw.amount),
        salt: BigInt(orderRaw.salt),
        amountBlinding: BigInt(orderRaw.amountBlinding),
      },
      fillAmount: r.fillAmount ? BigInt(r.fillAmount as string) : undefined,
      clearingPrice: r.clearingPrice ? BigInt(r.clearingPrice as string) : undefined,
    } as DarkPoolOrderNote;
  } catch {
    console.warn("[DarkPool] Skipping corrupted order note in IndexedDB");
    return null;
  }
}

/**
 * Load order notes from IndexedDB, scoped to the given trader address.
 * D7: `trader` is required to prevent cross-wallet data leakage on shared machines.
 */
export async function loadOrderNotes(trader: string): Promise<DarkPoolOrderNote[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const notes: DarkPoolOrderNote[] = [];
      for (const raw of request.result || []) {
        const r = raw as Record<string, unknown>;
        // D7: Always filter by trader — never return cross-wallet notes
        if (r.trader && (r.trader as string).toLowerCase() !== trader.toLowerCase()) {
          continue;
        }
        const note = deserializeOrderNote(raw);
        if (note) notes.push(note);
      }
      resolve(notes);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update an order note status.
 * D8: Uses direct IndexedDB get(orderId) instead of getAll() — O(1) instead of O(n).
 * D7: Requires trader to scope the update and prevent cross-wallet writes.
 */
export async function updateOrderNote(
  orderId: bigint,
  updates: Partial<DarkPoolOrderNote>,
  trader: string,
): Promise<void> {
  const db = await openDB();
  const orderIdStr = orderId.toString();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(orderIdStr);

    getReq.onsuccess = () => {
      if (!getReq.result) {
        resolve();
        return;
      }

      const raw = getReq.result as Record<string, unknown>;
      // D7: Verify the note belongs to this trader before updating
      if (raw.trader && (raw.trader as string).toLowerCase() !== trader.toLowerCase()) {
        resolve();
        return;
      }

      const note = deserializeOrderNote(raw);
      if (!note) {
        resolve();
        return;
      }

      const updated = { ...note, ...updates };
      storeOrderNote(updated, trader).then(resolve).catch(reject);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format a price from 18-decimal fixed point to human-readable.
 * D9: Uses toFixed() for proper rounding instead of string truncation.
 */
export function formatPrice(price: bigint, precision: number = 6): string {
  const whole = price / BigInt(1e18);
  const frac = price % BigInt(1e18);
  // Build full decimal string, then use Number + toFixed for correct rounding
  const fullStr = `${whole}.${frac.toString().padStart(18, "0")}`;
  return Number(fullStr).toFixed(precision);
}

/**
 * Format an amount in token decimals to human-readable.
 * D9: Uses toFixed() for proper rounding instead of string truncation.
 */
export function formatAmount(amount: bigint, decimals: number = 18, precision: number = 6): string {
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  const fullStr = `${whole}.${frac.toString().padStart(decimals, "0")}`;
  return Number(fullStr).toFixed(precision);
}

/**
 * Parse a human-readable amount to bigint in token decimals
 */
export function parseAmount(amount: string, decimals: number = 18): bigint {
  const [whole, frac = ""] = amount.split(".");
  const paddedFrac = frac.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole + paddedFrac);
}
