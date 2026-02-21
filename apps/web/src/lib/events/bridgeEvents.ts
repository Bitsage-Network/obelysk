/**
 * VM31 Confidential Bridge Event Scanner
 *
 * Client-side scanner for VM31ConfidentialBridge events using starknet_getEvents.
 * Tracks BridgeExecuted events to show users their bridged withdrawal history.
 *
 * Events scanned:
 * - BridgeExecuted(bridge_key, batch_id, withdrawal_idx, payout_recipient,
 *                  credit_recipient, token, amount, vm31_asset_id, confidential_asset_id)
 */

import { hash, num } from "starknet";
import { CONTRACTS, NETWORK_CONFIG, type NetworkType } from "../contracts/addresses";

// ============================================================================
// Event Selectors
// ============================================================================

export const BRIDGE_SELECTORS = {
  BridgeExecuted: hash.getSelectorFromName("BridgeExecuted"),
  AssetPairRegistered: hash.getSelectorFromName("AssetPairRegistered"),
  RelayerUpdated: hash.getSelectorFromName("RelayerUpdated"),
} as const;

// ============================================================================
// Types
// ============================================================================

export type BridgeEventType =
  | "bridge_executed"
  | "asset_pair_registered"
  | "relayer_updated"
  | "unknown";

export interface BridgeEvent {
  id: string;
  type: BridgeEventType;
  transactionHash: string;
  blockNumber: number;
  data: Record<string, string>;
  rawKeys: string[];
  rawData: string[];
}

export interface BridgeExecution {
  id: string;
  bridgeKey: string;
  batchId: string;
  withdrawalIdx: number;
  payoutRecipient: string;
  creditRecipient: string;
  token: string;
  amount: string;
  vm31AssetId: string;
  confidentialAssetId: string;
  transactionHash: string;
  blockNumber: number;
}

export interface FetchBridgeEventsOptions {
  network?: NetworkType;
  bridgeAddress?: string;
  fromBlock?: number;
  toBlock?: number | "latest";
  chunkSize?: number;
  continuationToken?: string;
  selectorFilter?: string[];
}

export interface FetchBridgeEventsResult {
  events: BridgeEvent[];
  continuationToken?: string;
  hasMore: boolean;
}

// ============================================================================
// Event Classification & Parsing
// ============================================================================

function classifyBridgeEvent(selector: string): BridgeEventType {
  if (selector === BRIDGE_SELECTORS.BridgeExecuted) return "bridge_executed";
  if (selector === BRIDGE_SELECTORS.AssetPairRegistered) return "asset_pair_registered";
  if (selector === BRIDGE_SELECTORS.RelayerUpdated) return "relayer_updated";
  return "unknown";
}

function parseBridgeEventData(
  type: BridgeEventType,
  keys: string[],
  data: string[],
): Record<string, string> {
  const parsed: Record<string, string> = {};

  switch (type) {
    case "bridge_executed":
      // BridgeExecuted has #[key] bridge_key
      // keys[1] = bridge_key
      if (keys[1]) parsed.bridge_key = keys[1];
      // data layout: batch_id, withdrawal_idx, payout_recipient, credit_recipient,
      //              token, amount(low, high), vm31_asset_id, confidential_asset_id
      if (data[0]) parsed.batch_id = data[0];
      if (data[1]) parsed.withdrawal_idx = data[1];
      if (data[2]) parsed.payout_recipient = data[2];
      if (data[3]) parsed.credit_recipient = data[3];
      if (data[4]) parsed.token = data[4];
      if (data[5]) parsed.amount_low = data[5];
      if (data[6]) parsed.amount_high = data[6];
      if (data[7]) parsed.vm31_asset_id = data[7];
      if (data[8]) parsed.confidential_asset_id = data[8];
      break;

    case "asset_pair_registered":
      // data: token, vm31_asset_id, confidential_asset_id
      if (data[0]) parsed.token = data[0];
      if (data[1]) parsed.vm31_asset_id = data[1];
      if (data[2]) parsed.confidential_asset_id = data[2];
      break;

    case "relayer_updated":
      // data: old_relayer, new_relayer
      if (data[0]) parsed.old_relayer = data[0];
      if (data[1]) parsed.new_relayer = data[1];
      break;
  }

  return parsed;
}

// ============================================================================
// Core Fetch Function
// ============================================================================

export async function fetchBridgeEvents(
  options: FetchBridgeEventsOptions = {},
): Promise<FetchBridgeEventsResult> {
  const {
    network = "sepolia",
    bridgeAddress,
    fromBlock = 0,
    toBlock = "latest",
    chunkSize = 100,
    continuationToken,
    selectorFilter,
  } = options;

  const rpcUrl = NETWORK_CONFIG[network]?.rpcUrl;
  if (!rpcUrl) {
    return { events: [], hasMore: false };
  }

  // Use provided bridge address or look up from contracts
  // VM31_CONFIDENTIAL_BRIDGE is not yet in the addresses file — use param
  const contractAddress = bridgeAddress;
  if (!contractAddress || contractAddress === "0x0") {
    return { events: [], hasMore: false };
  }

  const paddedAddr = num.toHex(num.toBigInt(contractAddress));
  const selectors = selectorFilter || Object.values(BRIDGE_SELECTORS);

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "starknet_getEvents",
        params: {
          filter: {
            from_block: typeof fromBlock === "number" ? { block_number: fromBlock } : fromBlock,
            to_block: toBlock === "latest" ? "latest" : { block_number: toBlock },
            address: paddedAddr,
            keys: [selectors],
            chunk_size: chunkSize,
            ...(continuationToken ? { continuation_token: continuationToken } : {}),
          },
        },
        id: 1,
      }),
    });

    const json = await response.json();
    const result = json.result;

    if (!result || !result.events) {
      return { events: [], hasMore: false };
    }

    const events: BridgeEvent[] = [];

    for (const event of result.events) {
      const eventSelector = event.keys?.[0] || "";
      const eventType = classifyBridgeEvent(eventSelector);
      const data = parseBridgeEventData(eventType, event.keys || [], event.data || []);

      events.push({
        id: `${event.transaction_hash}-${event.block_number}-${events.length}`,
        type: eventType,
        transactionHash: event.transaction_hash,
        blockNumber: event.block_number,
        data,
        rawKeys: event.keys || [],
        rawData: event.data || [],
      });
    }

    // Sort newest first
    events.sort((a, b) => b.blockNumber - a.blockNumber);

    return {
      events,
      continuationToken: result.continuation_token,
      hasMore: !!result.continuation_token,
    };
  } catch (error) {
    console.error("[BridgeEvents] Error fetching events:", error);
    return { events: [], hasMore: false };
  }
}

// ============================================================================
// Bridge Execution Scanner
// ============================================================================

/**
 * Scan BridgeExecuted events and return structured bridge execution records.
 * Optionally filter by credit_recipient to show only user's bridges.
 */
export async function scanBridgeExecutions(options: {
  network?: NetworkType;
  bridgeAddress?: string;
  fromBlock?: number;
  creditRecipient?: string;
}): Promise<BridgeExecution[]> {
  const {
    network = "sepolia",
    bridgeAddress,
    fromBlock = 0,
    creditRecipient,
  } = options;

  const result = await fetchBridgeEvents({
    network,
    bridgeAddress,
    fromBlock,
    selectorFilter: [BRIDGE_SELECTORS.BridgeExecuted],
    chunkSize: 200,
  });

  const executions: BridgeExecution[] = result.events
    .filter((e) => e.type === "bridge_executed")
    .map((event) => {
      const amountLow = BigInt(event.data.amount_low || "0");
      const amountHigh = BigInt(event.data.amount_high || "0");
      const amount = (amountHigh << 128n) | amountLow;

      return {
        id: event.data.bridge_key || event.id,
        bridgeKey: event.data.bridge_key || "0x0",
        batchId: event.data.batch_id || "0x0",
        withdrawalIdx: Number(num.toBigInt(event.data.withdrawal_idx || "0")),
        payoutRecipient: event.data.payout_recipient || "0x0",
        creditRecipient: event.data.credit_recipient || "0x0",
        token: event.data.token || "0x0",
        amount: amount.toString(),
        vm31AssetId: event.data.vm31_asset_id || "0x0",
        confidentialAssetId: event.data.confidential_asset_id || "0x0",
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
      };
    });

  // Filter by credit recipient if provided
  if (creditRecipient) {
    const normalizedRecipient = num.toHex(num.toBigInt(creditRecipient)).toLowerCase();
    return executions.filter(
      (e) => num.toHex(num.toBigInt(e.creditRecipient)).toLowerCase() === normalizedRecipient,
    );
  }

  return executions;
}

// ============================================================================
// Utility
// ============================================================================

export function getBridgeEventLabel(type: BridgeEventType): string {
  const labels: Record<BridgeEventType, string> = {
    bridge_executed: "Bridge Executed",
    asset_pair_registered: "Asset Pair Registered",
    relayer_updated: "Relayer Updated",
    unknown: "Unknown",
  };
  return labels[type];
}
