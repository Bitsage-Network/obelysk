/**
 * BTC Bridge Provider Interface
 *
 * Abstraction layer for bridging BTC into Starknet for VM31 shielding.
 *
 * Phase 1: ERC20Provider (trivial passthrough for wBTC/LBTC/tBTC/SolvBTC already on Starknet)
 * Phase 2: AtomiqProvider / GardenProvider (native BTC via HTLC bridges)
 */

export interface BridgeEstimate {
  /** Amount received on Starknet after fees (in token base units) */
  outputAmount: bigint;
  /** Bridge fee in source token units */
  fee: bigint;
  /** Estimated bridge time in seconds */
  estimatedTime: number;
  /** Starknet ERC20 address of the output token */
  tokenAddress: string;
}

export interface BridgeParams {
  /** Source amount in source token units */
  amount: bigint;
  /** Source asset symbol (e.g., "wBTC", "BTC") */
  sourceAsset: string;
  /** Starknet recipient address */
  recipient: string;
}

export interface BridgeResult {
  /** Whether the bridge operation succeeded */
  success: boolean;
  /** Transaction hash (Starknet or L1 depending on provider) */
  txHash?: string;
  /** Amount received on Starknet */
  outputAmount: bigint;
  /** Error message if failed */
  error?: string;
}

export interface BtcBridgeProvider {
  /** Provider identifier */
  name: "erc20" | "atomiq" | "garden";
  /** Human-readable display name */
  displayName: string;
  /** Assets this provider can bridge */
  supportedAssets: string[];
  /** Estimate bridge cost and time */
  estimateBridge(amount: bigint, sourceAsset: string): Promise<BridgeEstimate>;
  /** Execute the bridge operation */
  executeBridge(params: BridgeParams): Promise<BridgeResult>;
}

// ============================================================================
// Garden Finance Bridge Types (Phase 2)
// ============================================================================

/** Extended BridgeParams for Garden (native BTC → Starknet) */
export interface GardenBridgeParams extends BridgeParams {
  /** User's BTC source address (for the order source.owner) */
  btcAddress: string;
  /** Amount to receive after fees (from quote, in satoshis) */
  receiveAmount: string;
}

/** Extended BridgeResult for Garden orders */
export interface GardenBridgeResult extends BridgeResult {
  /** Garden order ID for status polling */
  orderId?: string;
  /** BTC HTLC address to send to (BTC→Starknet direction) */
  depositAddress?: string;
  /** Exact satoshi amount to send */
  depositAmount?: string;
}

/** Order progress status for UI display */
export interface GardenOrderProgress {
  status:
    | "pending"
    | "btc_sent"
    | "confirming"
    | "swapping"
    | "complete"
    | "refunded"
    | "error";
  /** Current BTC confirmations */
  confirmations: number;
  /** Required BTC confirmations for the HTLC */
  requiredConfirmations: number;
  /** Source chain tx hash (BTC txid or Starknet tx hash) */
  sourceTxHash?: string;
  /** Destination chain tx hash */
  destinationTxHash?: string;
  /** Estimated seconds remaining */
  estimatedTimeRemaining?: number;
}
