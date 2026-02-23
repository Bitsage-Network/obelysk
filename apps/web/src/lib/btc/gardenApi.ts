/**
 * Garden Finance REST API Client
 *
 * Typed wrapper around Garden's 4 REST endpoints for native BTC bridging.
 * No external deps — uses fetch() with garden-app-id header auth.
 *
 * Flow (BTC→Starknet):
 *   1. GET /quote → fee + estimated time
 *   2. POST /orders → order_id + BTC deposit address
 *   3. User sends BTC to HTLC address
 *   4. GET /orders/:id → poll until destination_swap.redeem_tx_hash populated
 *
 * Flow (Starknet→BTC):
 *   1. GET /quote → fee + estimated time
 *   2. POST /orders → order_id + approval_transaction + initiate_transaction + typed_data
 *   3. Execute txs or sign typed_data (gasless SNIP-12)
 *   4. GET /orders/:id → poll until destination_swap.redeem_tx_hash populated
 */

// ============================================================================
// Config
// ============================================================================

const GARDEN_TESTNET_URL = "https://testnet.api.garden.finance/v2";
const GARDEN_MAINNET_URL = "https://api.garden.finance/v2";

const GARDEN_APP_ID =
  process.env.NEXT_PUBLIC_GARDEN_APP_ID ||
  "47d589e79ffbe321d296609f63922e64953da28ba08e07a7f4ba2d7978cfb931";

// ============================================================================
// Asset identifiers (chain:token format used by Garden API)
// ============================================================================

export const GARDEN_ASSETS = {
  sepolia: {
    btc: "bitcoin_testnet:btc",
    wbtc: "starknet_sepolia:wbtc",
  },
  mainnet: {
    btc: "bitcoin:btc",
    wbtc: "starknet:wbtc",
  },
} as const;

export type GardenNetwork = "sepolia" | "mainnet";

// ============================================================================
// Response types
// ============================================================================

export interface GardenAssetAmount {
  asset: string;
  amount: string;
  decimals?: number;
}

export interface GardenQuoteResponse {
  source: GardenAssetAmount;
  destination: GardenAssetAmount;
  solver_id: string;
  estimated_time: number;
  slippage: number;
  fee: string;
  fixed_fee: string;
}

/** Response from POST /orders for BTC→Starknet direction */
export interface GardenBtcOrderResponse {
  order_id: string;
  to: string;
  amount: string;
}

/** Transaction calldata returned by Garden for Starknet execution */
export interface GardenStarknetTx {
  to: string;
  selector: string;
  calldata: string[];
}

/** SNIP-12 typed data for gasless Starknet signing */
export interface GardenTypedData {
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  domain: Record<string, string>;
  message: Record<string, unknown>;
}

/** Response from POST /orders for Starknet→BTC direction */
export interface GardenStarknetOrderResponse {
  order_id: string;
  approval_transaction: GardenStarknetTx;
  initiate_transaction: GardenStarknetTx;
  typed_data: GardenTypedData;
}

export interface GardenSwapStatus {
  initiate_tx_hash?: string;
  redeem_tx_hash?: string;
  refund_tx_hash?: string;
  required_confirmations: number;
  current_confirmations: number;
  amount: string;
  chain: string;
}

export interface GardenOrderStatus {
  order_id: string;
  status: string;
  source_swap: GardenSwapStatus;
  destination_swap: GardenSwapStatus;
  created_at?: string;
  updated_at?: string;
}

/** Source/destination params for creating an order */
export interface GardenOrderAsset {
  asset: string;
  owner: string;
  amount: string;
}

// ============================================================================
// Helpers
// ============================================================================

function baseUrl(network: GardenNetwork): string {
  return network === "mainnet" ? GARDEN_MAINNET_URL : GARDEN_TESTNET_URL;
}

function headers(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "garden-app-id": GARDEN_APP_ID,
  };
}

async function gardenFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...headers(), ...init?.headers },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Garden API error (${res.status}): ${body || res.statusText}`);
  }

  return res.json();
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get a bridge quote (fees, estimated time, output amount).
 *
 * @param from   Source asset identifier (e.g. "bitcoin_testnet:btc")
 * @param to     Destination asset identifier (e.g. "starknet_sepolia:wbtc")
 * @param fromAmount  Amount in source token base units (satoshis for BTC)
 * @param network     "sepolia" or "mainnet"
 */
export async function getQuote(
  from: string,
  to: string,
  fromAmount: string,
  network: GardenNetwork,
): Promise<GardenQuoteResponse[]> {
  const url = `${baseUrl(network)}/quote?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&from_amount=${encodeURIComponent(fromAmount)}`;
  return gardenFetch<GardenQuoteResponse[]>(url);
}

/**
 * Create a bridge order.
 *
 * For BTC→Starknet: returns { order_id, to (BTC deposit address), amount }
 * For Starknet→BTC: returns { order_id, approval_transaction, initiate_transaction, typed_data }
 */
export async function createOrder(
  source: GardenOrderAsset,
  destination: GardenOrderAsset,
  network: GardenNetwork,
): Promise<GardenBtcOrderResponse | GardenStarknetOrderResponse> {
  const url = `${baseUrl(network)}/orders`;
  return gardenFetch(url, {
    method: "POST",
    body: JSON.stringify({ source, destination }),
  });
}

/**
 * Create a BTC→Starknet order (typed return).
 */
export async function createBtcToStarknetOrder(
  source: GardenOrderAsset,
  destination: GardenOrderAsset,
  network: GardenNetwork,
): Promise<GardenBtcOrderResponse> {
  return createOrder(source, destination, network) as Promise<GardenBtcOrderResponse>;
}

/**
 * Create a Starknet→BTC order (typed return).
 */
export async function createStarknetToBtcOrder(
  source: GardenOrderAsset,
  destination: GardenOrderAsset,
  network: GardenNetwork,
): Promise<GardenStarknetOrderResponse> {
  return createOrder(source, destination, network) as Promise<GardenStarknetOrderResponse>;
}

/**
 * Poll an order's status.
 *
 * Key status transitions:
 * - source_swap.current_confirmations increases as BTC confirms
 * - destination_swap.redeem_tx_hash populated → bridge complete
 * - source_swap.refund_tx_hash populated → bridge failed/refunded
 */
export async function getOrderStatus(
  orderId: string,
  network: GardenNetwork,
): Promise<GardenOrderStatus> {
  const url = `${baseUrl(network)}/orders/${encodeURIComponent(orderId)}`;
  return gardenFetch<GardenOrderStatus>(url);
}

/**
 * Initiate a gasless Starknet→BTC order using a signed SNIP-12 typed data message.
 * Alternative to executing approval + initiate transactions on-chain.
 */
export async function initiateGasless(
  orderId: string,
  signature: string[],
  network: GardenNetwork,
): Promise<void> {
  const url = `${baseUrl(network)}/orders/${encodeURIComponent(orderId)}/initiate`;
  await gardenFetch<unknown>(url, {
    method: "POST",
    body: JSON.stringify({ signature }),
  });
}

/**
 * Check if Garden bridge is available (env var set).
 */
export function isGardenAvailable(): boolean {
  return !!GARDEN_APP_ID && GARDEN_APP_ID.length > 0;
}
