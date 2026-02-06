/**
 * Privacy Event Service
 *
 * Fetches and parses on-chain privacy events from deployed Obelysk contracts.
 * Uses Starknet RPC `getEvents` with event selectors computed via getSelectorFromName.
 *
 * Tracked contracts:
 * - PrivacyPools (0x0d85..)       — deposits, withdrawals
 * - ShieldedSwapRouter (0x056b..) — shielded swaps, pool registrations
 * - ConfidentialTransfer (0x07ab..) — registrations, funding, transfers, withdrawals
 */

import { hash, num } from "starknet";
import { CONTRACTS, NETWORK_CONFIG, type NetworkType } from "../contracts/addresses";

// ============================================================================
// Event Selectors
// ============================================================================

const EVENT_SELECTORS = {
  // PrivacyPools events
  PPDepositExecuted: hash.getSelectorFromName("PPDepositExecuted"),
  PPWithdrawalExecuted: hash.getSelectorFromName("PPWithdrawalExecuted"),

  // ShieldedSwapRouter events
  ShieldedSwapExecuted: hash.getSelectorFromName("ShieldedSwapExecuted"),
  PoolRegistered: hash.getSelectorFromName("PoolRegistered"),

  // ConfidentialTransfer events
  AccountRegistered: hash.getSelectorFromName("AccountRegistered"),
  Funded: hash.getSelectorFromName("Funded"),
  ConfidentialTransfer: hash.getSelectorFromName("ConfidentialTransfer"),
  Withdrawal: hash.getSelectorFromName("Withdrawal"),
  Rollover: hash.getSelectorFromName("RolloverEvent"),

  // Shared upgrade events
  UpgradeScheduled: hash.getSelectorFromName("UpgradeScheduled"),
  UpgradeExecuted: hash.getSelectorFromName("UpgradeExecuted"),
} as const;

// ============================================================================
// Types
// ============================================================================

export type PrivacyEventType =
  | "deposit"
  | "withdrawal"
  | "shielded_swap"
  | "pool_registered"
  | "account_registered"
  | "funded"
  | "confidential_transfer"
  | "rollover"
  | "upgrade_scheduled"
  | "upgrade_executed"
  | "unknown";

export interface PrivacyEvent {
  id: string;
  type: PrivacyEventType;
  contractAddress: string;
  transactionHash: string;
  blockNumber: number;
  timestamp: Date | null;
  // Parsed event data (varies by type)
  data: Record<string, string>;
  // Raw keys/data for advanced usage
  rawKeys: string[];
  rawData: string[];
}

export interface FetchEventsOptions {
  network?: NetworkType;
  contractFilter?: string[];
  eventTypes?: PrivacyEventType[];
  fromBlock?: number;
  toBlock?: number | "latest";
  chunkSize?: number;
  continuationToken?: string;
}

export interface FetchEventsResult {
  events: PrivacyEvent[];
  continuationToken?: string;
  hasMore: boolean;
}

// ============================================================================
// Contract Address Mapping
// ============================================================================

function getPrivacyContractAddresses(network: NetworkType): Record<string, string> {
  const contracts = CONTRACTS[network];
  if (!contracts) return {};

  const addresses: Record<string, string> = {};

  if (contracts.PRIVACY_POOLS && contracts.PRIVACY_POOLS !== "0x0") {
    addresses[contracts.PRIVACY_POOLS.toLowerCase()] = "PrivacyPools";
  }
  if (contracts.SHIELDED_SWAP_ROUTER && contracts.SHIELDED_SWAP_ROUTER !== "0x0") {
    addresses[contracts.SHIELDED_SWAP_ROUTER.toLowerCase()] = "ShieldedSwapRouter";
  }
  if ("CONFIDENTIAL_TRANSFER" in contracts) {
    const ct = (contracts as Record<string, string>).CONFIDENTIAL_TRANSFER;
    if (ct && ct !== "0x0") {
      addresses[ct.toLowerCase()] = "ConfidentialTransfer";
    }
  }

  return addresses;
}

// ============================================================================
// Event Classification
// ============================================================================

function classifyEvent(
  eventKey: string,
  contractName: string,
): PrivacyEventType {
  // Match by selector
  if (eventKey === EVENT_SELECTORS.PPDepositExecuted) return "deposit";
  if (eventKey === EVENT_SELECTORS.PPWithdrawalExecuted) return "withdrawal";
  if (eventKey === EVENT_SELECTORS.ShieldedSwapExecuted) return "shielded_swap";
  if (eventKey === EVENT_SELECTORS.PoolRegistered) return "pool_registered";
  if (eventKey === EVENT_SELECTORS.AccountRegistered) return "account_registered";
  if (eventKey === EVENT_SELECTORS.Funded) return "funded";
  if (eventKey === EVENT_SELECTORS.ConfidentialTransfer) return "confidential_transfer";
  if (eventKey === EVENT_SELECTORS.Withdrawal) return "withdrawal";
  if (eventKey === EVENT_SELECTORS.Rollover) return "rollover";
  if (eventKey === EVENT_SELECTORS.UpgradeScheduled) return "upgrade_scheduled";
  if (eventKey === EVENT_SELECTORS.UpgradeExecuted) return "upgrade_executed";

  return "unknown";
}

function parseEventData(
  type: PrivacyEventType,
  keys: string[],
  data: string[],
): Record<string, string> {
  const parsed: Record<string, string> = {};

  switch (type) {
    case "deposit":
      // PPDepositExecuted: key[1]=commitment; data has amount, asset_id, etc.
      if (keys[1]) parsed.commitment = keys[1];
      if (data[0]) parsed.amount_low = data[0];
      if (data[1]) parsed.amount_high = data[1];
      break;

    case "withdrawal":
      // PPWithdrawalExecuted: key[1]=nullifier; or Withdrawal: key[1]=account
      if (keys[1]) parsed.key1 = keys[1];
      if (data[0]) parsed.to = data[0];
      if (data[1]) parsed.asset_id = data[1];
      if (data[2]) parsed.amount_low = data[2];
      if (data[3]) parsed.amount_high = data[3];
      break;

    case "shielded_swap":
      // ShieldedSwapExecuted: key[1]=swap_id
      if (keys[1]) parsed.swap_id = keys[1];
      if (data[0]) parsed.source_pool = data[0];
      if (data[1]) parsed.dest_pool = data[1];
      if (data[2]) parsed.input_token = data[2];
      if (data[3]) parsed.output_token = data[3];
      if (data[4]) parsed.input_amount_low = data[4];
      if (data[5]) parsed.input_amount_high = data[5];
      if (data[6]) parsed.output_amount_low = data[6];
      if (data[7]) parsed.output_amount_high = data[7];
      break;

    case "pool_registered":
      // PoolRegistered: key[1]=token
      if (keys[1]) parsed.token = keys[1];
      if (data[0]) parsed.pool = data[0];
      break;

    case "account_registered":
      // AccountRegistered: key[1]=account
      if (keys[1]) parsed.account = keys[1];
      if (data[0]) parsed.pk_x = data[0];
      if (data[1]) parsed.pk_y = data[1];
      break;

    case "funded":
      // Funded: key[1]=account
      if (keys[1]) parsed.account = keys[1];
      if (data[0]) parsed.asset_id = data[0];
      break;

    case "confidential_transfer":
      // ConfidentialTransfer: key[1]=from, key[2]=to
      if (keys[1]) parsed.from = keys[1];
      if (keys[2]) parsed.to = keys[2];
      if (data[0]) parsed.asset_id = data[0];
      break;

    case "rollover":
      // Rollover: key[1]=account
      if (keys[1]) parsed.account = keys[1];
      if (data[0]) parsed.asset_id = data[0];
      break;

    case "upgrade_scheduled":
      if (data[0]) parsed.new_class_hash = data[0];
      if (data[1]) parsed.scheduled_at = data[1];
      if (data[2]) parsed.execute_after = data[2];
      break;

    case "upgrade_executed":
      if (data[0]) parsed.old_class_hash = data[0];
      if (data[1]) parsed.new_class_hash = data[1];
      break;
  }

  return parsed;
}

// ============================================================================
// Core Fetch Function
// ============================================================================

/**
 * Fetch privacy events from all Obelysk contracts on the given network.
 *
 * Uses RPC `starknet_getEvents` with pagination via continuation_token.
 */
export async function fetchPrivacyEvents(
  options: FetchEventsOptions = {},
): Promise<FetchEventsResult> {
  const {
    network = "sepolia",
    contractFilter,
    eventTypes,
    fromBlock = 0,
    toBlock = "latest",
    chunkSize = 50,
    continuationToken,
  } = options;

  const rpcUrl = NETWORK_CONFIG[network]?.rpcUrl;
  if (!rpcUrl) {
    return { events: [], hasMore: false };
  }

  const contractMap = getPrivacyContractAddresses(network);
  const contractAddresses = contractFilter || Object.keys(contractMap);

  if (contractAddresses.length === 0) {
    return { events: [], hasMore: false };
  }

  // Build all event selectors we want to match
  const allSelectors = Object.values(EVENT_SELECTORS);

  const allEvents: PrivacyEvent[] = [];
  let lastContinuationToken: string | undefined;
  let hasMore = false;

  // Fetch events for each contract address
  for (const contractAddr of contractAddresses) {
    const normalizedAddr = contractAddr.toLowerCase();
    // Pad address to full felt252 representation
    const paddedAddr = num.toHex(num.toBigInt(contractAddr));

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
              keys: [allSelectors],
              chunk_size: chunkSize,
              ...(continuationToken ? { continuation_token: continuationToken } : {}),
            },
          },
          id: 1,
        }),
      });

      const json = await response.json();
      const result = json.result;

      if (!result || !result.events) continue;

      const contractName = contractMap[normalizedAddr] || "Unknown";

      for (const event of result.events) {
        const eventSelector = event.keys?.[0] || "";
        const eventType = classifyEvent(eventSelector, contractName);

        // Filter by event type if specified
        if (eventTypes && !eventTypes.includes(eventType)) continue;

        const parsed = parseEventData(eventType, event.keys || [], event.data || []);

        allEvents.push({
          id: `${event.transaction_hash}-${event.block_number}-${allEvents.length}`,
          type: eventType,
          contractAddress: event.from_address || contractAddr,
          transactionHash: event.transaction_hash,
          blockNumber: event.block_number,
          timestamp: null, // Will be resolved by the hook if needed
          data: parsed,
          rawKeys: event.keys || [],
          rawData: event.data || [],
        });
      }

      if (result.continuation_token) {
        lastContinuationToken = result.continuation_token;
        hasMore = true;
      }
    } catch (error) {
      console.error(`[PrivacyEvents] Error fetching events from ${contractAddr}:`, error);
    }
  }

  // Sort by block number (newest first)
  allEvents.sort((a, b) => b.blockNumber - a.blockNumber);

  return {
    events: allEvents,
    continuationToken: lastContinuationToken,
    hasMore,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get a human-readable label for an event type.
 */
export function getEventLabel(type: PrivacyEventType): string {
  const labels: Record<PrivacyEventType, string> = {
    deposit: "Privacy Deposit",
    withdrawal: "Privacy Withdrawal",
    shielded_swap: "Shielded Swap",
    pool_registered: "Pool Registered",
    account_registered: "Account Registered",
    funded: "Funded",
    confidential_transfer: "Confidential Transfer",
    rollover: "Rollover",
    upgrade_scheduled: "Upgrade Scheduled",
    upgrade_executed: "Upgrade Executed",
    unknown: "Unknown Event",
  };
  return labels[type];
}

/**
 * Get the explorer URL for a transaction.
 */
export function getEventExplorerUrl(
  txHash: string,
  network: NetworkType = "sepolia",
): string {
  const explorerUrl = NETWORK_CONFIG[network]?.explorerUrl || "";
  return `${explorerUrl}/tx/${txHash}`;
}

/**
 * Truncate a hex hash for display.
 */
export function truncateHash(hash: string, chars: number = 6): string {
  if (!hash || hash.length <= chars * 2 + 2) return hash;
  return `${hash.slice(0, chars + 2)}...${hash.slice(-chars)}`;
}

export { EVENT_SELECTORS };
