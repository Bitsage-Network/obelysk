/**
 * Stealth Payment Event Scanner
 *
 * Client-side scanner for StealthRegistry events using starknet_getEvents.
 * Replaces the offline coordinator API dependency with direct on-chain polling.
 *
 * Events scanned:
 * - MetaAddressRegistered(worker, spending_pubkey_x, viewing_pubkey_x, timestamp)
 * - StealthPaymentSent(announcement_index, stealth_address, ephemeral_pubkey_x, view_tag, job_id, timestamp)
 * - StealthPaymentClaimed(announcement_index, claimer, recipient, amount, timestamp)
 */

import { hash, num } from "starknet";
import { CONTRACTS, NETWORK_CONFIG, EXTERNAL_TOKENS, type NetworkType } from "../contracts/addresses";

// ============================================================================
// Event Selectors
// ============================================================================

export const STEALTH_SELECTORS = {
  MetaAddressRegistered: hash.getSelectorFromName("MetaAddressRegistered"),
  MetaAddressUpdated: hash.getSelectorFromName("MetaAddressUpdated"),
  StealthPaymentSent: hash.getSelectorFromName("StealthPaymentSent"),
  StealthPaymentClaimed: hash.getSelectorFromName("StealthPaymentClaimed"),
} as const;

// ============================================================================
// Types
// ============================================================================

export type StealthEventType =
  | "meta_address_registered"
  | "meta_address_updated"
  | "payment_sent"
  | "payment_claimed"
  | "unknown";

export interface StealthEvent {
  id: string;
  type: StealthEventType;
  transactionHash: string;
  blockNumber: number;
  data: Record<string, string>;
  rawKeys: string[];
  rawData: string[];
}

export interface StealthPayment {
  id: string;
  announcement_index: string;
  stealth_address: string;
  ephemeral_pubkey_x: string;
  view_tag: string;
  job_id: string;
  timestamp: number;
  amount_formatted: string;
  token_symbol: string;
  claimed: boolean;
  transactionHash: string;
}

export interface FetchStealthEventsOptions {
  network?: NetworkType;
  fromBlock?: number;
  toBlock?: number | "latest";
  chunkSize?: number;
  continuationToken?: string;
  selectorFilter?: string[]; // Only fetch specific event types
}

export interface FetchStealthEventsResult {
  events: StealthEvent[];
  continuationToken?: string;
  hasMore: boolean;
}

// ============================================================================
// Event Classification & Parsing
// ============================================================================

function classifyStealthEvent(selector: string): StealthEventType {
  if (selector === STEALTH_SELECTORS.MetaAddressRegistered) return "meta_address_registered";
  if (selector === STEALTH_SELECTORS.MetaAddressUpdated) return "meta_address_updated";
  if (selector === STEALTH_SELECTORS.StealthPaymentSent) return "payment_sent";
  if (selector === STEALTH_SELECTORS.StealthPaymentClaimed) return "payment_claimed";
  return "unknown";
}

function parseStealthEventData(
  type: StealthEventType,
  keys: string[],
  data: string[],
): Record<string, string> {
  const parsed: Record<string, string> = {};

  switch (type) {
    case "meta_address_registered":
    case "meta_address_updated":
      // keys[1]=worker
      if (keys[1]) parsed.worker = keys[1];
      // data: spending_pubkey_x, viewing_pubkey_x, timestamp
      if (data[0]) parsed.spending_pubkey_x = data[0];
      if (data[1]) parsed.viewing_pubkey_x = data[1];
      if (data[2]) parsed.timestamp = data[2];
      break;

    case "payment_sent":
      // keys[1..2]=announcement_index(u256), keys[3]=stealth_address
      if (keys[1]) parsed.announcement_index_low = keys[1];
      if (keys[2]) parsed.announcement_index_high = keys[2];
      if (keys[3]) parsed.stealth_address = keys[3];
      // data: ephemeral_pubkey_x, view_tag, job_id(u256), token, timestamp
      if (data[0]) parsed.ephemeral_pubkey_x = data[0];
      if (data[1]) parsed.view_tag = data[1];
      if (data[2]) parsed.job_id_low = data[2];
      if (data[3]) parsed.job_id_high = data[3];
      if (data[4]) parsed.token = data[4];
      if (data[5]) parsed.timestamp = data[5];
      break;

    case "payment_claimed":
      // keys[1..2]=announcement_index(u256), keys[3]=claimer
      if (keys[1]) parsed.announcement_index_low = keys[1];
      if (keys[2]) parsed.announcement_index_high = keys[2];
      if (keys[3]) parsed.claimer = keys[3];
      // data: recipient, amount(u256), timestamp
      if (data[0]) parsed.recipient = data[0];
      if (data[1]) parsed.amount_low = data[1];
      if (data[2]) parsed.amount_high = data[2];
      if (data[3]) parsed.timestamp = data[3];
      break;
  }

  return parsed;
}

// ============================================================================
// Core Fetch Function
// ============================================================================

export async function fetchStealthEvents(
  options: FetchStealthEventsOptions = {},
): Promise<FetchStealthEventsResult> {
  const {
    network = "sepolia",
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

  const contracts = CONTRACTS[network];
  const registryAddress = contracts?.STEALTH_REGISTRY;
  if (!registryAddress || registryAddress === "0x0") {
    return { events: [], hasMore: false };
  }

  const paddedAddr = num.toHex(num.toBigInt(registryAddress));
  const selectors = selectorFilter || Object.values(STEALTH_SELECTORS);

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

    const events: StealthEvent[] = [];

    for (const event of result.events) {
      const eventSelector = event.keys?.[0] || "";
      const eventType = classifyStealthEvent(eventSelector);
      const data = parseStealthEventData(eventType, event.keys || [], event.data || []);

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
    console.error("[StealthEvents] Error fetching events:", error);
    return { events: [], hasMore: false };
  }
}

// ============================================================================
// Stealth Payment Scanner
// ============================================================================

/**
 * Scan on-chain StealthPaymentSent events and match by view_tag.
 * In a full implementation, the viewing key would be used to check each
 * ephemeral_pubkey against the stealth address. For now, we return all
 * payment events since the registry is on Sepolia with low volume.
 */
export async function scanStealthPayments(options: {
  network?: NetworkType;
  fromBlock?: number;
}): Promise<StealthPayment[]> {
  const { network = "sepolia", fromBlock = 0 } = options;

  // Fetch payment_sent events
  const sentResult = await fetchStealthEvents({
    network,
    fromBlock,
    selectorFilter: [STEALTH_SELECTORS.StealthPaymentSent],
    chunkSize: 200,
  });

  // Fetch claimed events to mark which are claimed
  const claimedResult = await fetchStealthEvents({
    network,
    fromBlock,
    selectorFilter: [STEALTH_SELECTORS.StealthPaymentClaimed],
    chunkSize: 200,
  });

  // Build set of claimed announcement indices
  const claimedIndices = new Set<string>();
  for (const event of claimedResult.events) {
    const idx = event.data.announcement_index_low || "0";
    claimedIndices.add(idx);
  }

  // Build claimed amounts map
  const claimedAmounts = new Map<string, string>();
  for (const event of claimedResult.events) {
    const idx = event.data.announcement_index_low || "0";
    const amountLow = event.data.amount_low || "0";
    claimedAmounts.set(idx, amountLow);
  }

  // Convert sent events to StealthPayment objects
  const payments: StealthPayment[] = sentResult.events
    .filter((e) => e.type === "payment_sent")
    .map((event) => {
      const announcementIdx = event.data.announcement_index_low || "0";
      const isClaimed = claimedIndices.has(announcementIdx);
      const timestamp = event.data.timestamp
        ? Number(num.toBigInt(event.data.timestamp))
        : 0;

      // Resolve token symbol from on-chain token address
      const tokenAddr = event.data.token || "0x0";
      const tokenSymbol = resolveTokenSymbol(tokenAddr, network);

      return {
        id: announcementIdx,
        announcement_index: announcementIdx,
        stealth_address: event.data.stealth_address || "0x0",
        ephemeral_pubkey_x: event.data.ephemeral_pubkey_x || "0x0",
        view_tag: event.data.view_tag
          ? `0x${num.toBigInt(event.data.view_tag).toString(16).padStart(2, "0")}`
          : "0x00",
        job_id: event.data.job_id_low || "0",
        timestamp,
        amount_formatted: "encrypted", // Amount is encrypted on-chain
        token_symbol: tokenSymbol,
        claimed: isClaimed,
        transactionHash: event.transactionHash,
      };
    });

  return payments;
}

// ============================================================================
// Token Address → Symbol Resolution
// ============================================================================

function resolveTokenSymbol(tokenAddress: string, network: NetworkType): string {
  if (!tokenAddress || tokenAddress === "0x0") return "SAGE";
  const normalized = num.toHex(num.toBigInt(tokenAddress)).toLowerCase();

  // Check SAGE
  const sageAddr = CONTRACTS[network]?.SAGE_TOKEN;
  if (sageAddr && num.toHex(num.toBigInt(sageAddr)).toLowerCase() === normalized) return "SAGE";

  // Check external tokens
  const externals = EXTERNAL_TOKENS[network];
  if (externals) {
    for (const [symbol, addr] of Object.entries(externals)) {
      if (addr && num.toHex(num.toBigInt(addr)).toLowerCase() === normalized) return symbol;
    }
  }

  // Fallback: truncated address
  return `${tokenAddress.slice(0, 8)}...`;
}

// ============================================================================
// Utility
// ============================================================================

export function getStealthEventLabel(type: StealthEventType): string {
  const labels: Record<StealthEventType, string> = {
    meta_address_registered: "Meta-Address Registered",
    meta_address_updated: "Meta-Address Updated",
    payment_sent: "Stealth Payment Sent",
    payment_claimed: "Stealth Payment Claimed",
    unknown: "Unknown",
  };
  return labels[type];
}
