/**
 * Protocol Event Service
 *
 * Extends on-chain event polling to cover ALL protocol domains:
 * - Trading (OTC Orderbook)
 * - Governance (SAGE Token proposals/votes)
 * - Staking (ProverStaking)
 * - Privacy (PrivacyPools, ShieldedSwapRouter, ConfidentialTransfer)
 *
 * Uses Starknet RPC `starknet_getEvents` — no WebSocket/coordinator dependency.
 */

import { hash, num } from "starknet";
import { CONTRACTS, NETWORK_CONFIG, type NetworkType } from "../contracts/addresses";

// ============================================================================
// Event Selectors by Domain
// ============================================================================

export const TRADING_SELECTORS = {
  OrderPlaced: hash.getSelectorFromName("OrderPlaced"),
  OrderCancelled: hash.getSelectorFromName("OrderCancelled"),
  OrderFilled: hash.getSelectorFromName("OrderFilled"),
  TradeExecuted: hash.getSelectorFromName("TradeExecuted"),
  PairAdded: hash.getSelectorFromName("PairAdded"),
} as const;

export const GOVERNANCE_SELECTORS = {
  ProposalCreated: hash.getSelectorFromName("ProposalCreated"),
  ProposalVoted: hash.getSelectorFromName("ProposalVoted"),
  ProposalExecuted: hash.getSelectorFromName("ProposalExecuted"),
  ProposalQuorumAchieved: hash.getSelectorFromName("ProposalQuorumAchieved"),
  VotingPowerUpdated: hash.getSelectorFromName("VotingPowerUpdated"),
} as const;

export const STAKING_SELECTORS = {
  Staked: hash.getSelectorFromName("Staked"),
  UnstakeRequested: hash.getSelectorFromName("UnstakeRequested"),
  UnstakeCompleted: hash.getSelectorFromName("UnstakeCompleted"),
  Slashed: hash.getSelectorFromName("Slashed"),
  RewardsClaimed: hash.getSelectorFromName("RewardsClaimed"),
  SuccessRecorded: hash.getSelectorFromName("SuccessRecorded"),
} as const;

export const STEALTH_SELECTORS = {
  MetaAddressRegistered: hash.getSelectorFromName("MetaAddressRegistered"),
  MetaAddressUpdated: hash.getSelectorFromName("MetaAddressUpdated"),
  StealthPaymentSent: hash.getSelectorFromName("StealthPaymentSent"),
  StealthPaymentClaimed: hash.getSelectorFromName("StealthPaymentClaimed"),
} as const;

export const DARK_POOL_SELECTORS = {
  OrderCommitted: hash.getSelectorFromName("OrderCommitted"),
  OrderRevealed: hash.getSelectorFromName("OrderRevealed"),
  OrderCancelled: hash.getSelectorFromName("OrderCancelled"),
  OrderFilled: hash.getSelectorFromName("OrderFilled"),
  EpochSettled: hash.getSelectorFromName("EpochSettled"),
  Deposited: hash.getSelectorFromName("Deposited"),
  Withdrawn: hash.getSelectorFromName("Withdrawn"),
} as const;

// ============================================================================
// Types
// ============================================================================

export type DarkPoolEventType =
  | "order_committed"
  | "order_revealed"
  | "order_cancelled"
  | "order_filled"
  | "epoch_settled"
  | "deposited"
  | "withdrawn"
  | "unknown";

export type TradingEventType =
  | "order_placed"
  | "order_cancelled"
  | "order_filled"
  | "trade_executed"
  | "pair_added"
  | "unknown";

export type GovernanceEventType =
  | "proposal_created"
  | "proposal_voted"
  | "proposal_executed"
  | "quorum_achieved"
  | "voting_power_updated"
  | "unknown";

export type StakingEventType =
  | "staked"
  | "unstake_requested"
  | "unstake_completed"
  | "slashed"
  | "rewards_claimed"
  | "success_recorded"
  | "unknown";

export type StealthEventType =
  | "meta_address_registered"
  | "meta_address_updated"
  | "payment_sent"
  | "payment_claimed"
  | "unknown";

export type ProtocolEventDomain = "trading" | "governance" | "staking" | "dark_pool" | "stealth";

export interface ProtocolEvent<T extends string = string> {
  id: string;
  domain: ProtocolEventDomain;
  type: T;
  contractAddress: string;
  transactionHash: string;
  blockNumber: number;
  timestamp: Date | null;
  data: Record<string, string>;
  rawKeys: string[];
  rawData: string[];
}

export interface FetchProtocolEventsOptions {
  network?: NetworkType;
  domain: ProtocolEventDomain;
  fromBlock?: number;
  toBlock?: number | "latest";
  chunkSize?: number;
  continuationToken?: string;
  addressFilter?: string; // Filter events by specific address in keys
}

export interface FetchProtocolEventsResult<T extends string = string> {
  events: ProtocolEvent<T>[];
  continuationToken?: string;
  hasMore: boolean;
}

// ============================================================================
// Domain Configuration
// ============================================================================

function getDomainConfig(domain: ProtocolEventDomain, network: NetworkType) {
  const contracts = CONTRACTS[network];
  if (!contracts) return null;

  switch (domain) {
    case "trading":
      return {
        address: contracts.OTC_ORDERBOOK,
        selectors: Object.values(TRADING_SELECTORS),
        classify: classifyTradingEvent as (s: string) => string,
        parse: parseTradingEventData as (t: string, k: string[], d: string[]) => Record<string, string>,
      };
    case "governance":
      return {
        address: contracts.SAGE_TOKEN,
        selectors: Object.values(GOVERNANCE_SELECTORS),
        classify: classifyGovernanceEvent as (s: string) => string,
        parse: parseGovernanceEventData as (t: string, k: string[], d: string[]) => Record<string, string>,
      };
    case "staking":
      return {
        address: contracts.STAKING,
        selectors: Object.values(STAKING_SELECTORS),
        classify: classifyStakingEvent as (s: string) => string,
        parse: parseStakingEventData as (t: string, k: string[], d: string[]) => Record<string, string>,
      };
    case "dark_pool":
      return {
        address: contracts.DARK_POOL,
        selectors: Object.values(DARK_POOL_SELECTORS),
        classify: classifyDarkPoolEvent as (s: string) => string,
        parse: parseDarkPoolEventData as (t: string, k: string[], d: string[]) => Record<string, string>,
      };
    case "stealth":
      return {
        address: contracts.STEALTH_REGISTRY,
        selectors: Object.values(STEALTH_SELECTORS),
        classify: classifyStealthEvent as (s: string) => string,
        parse: parseStealthEventData as (t: string, k: string[], d: string[]) => Record<string, string>,
      };
  }
}

// ============================================================================
// Trading Event Classification & Parsing
// ============================================================================

function classifyTradingEvent(selector: string): TradingEventType {
  if (selector === TRADING_SELECTORS.OrderPlaced) return "order_placed";
  if (selector === TRADING_SELECTORS.OrderCancelled) return "order_cancelled";
  if (selector === TRADING_SELECTORS.OrderFilled) return "order_filled";
  if (selector === TRADING_SELECTORS.TradeExecuted) return "trade_executed";
  if (selector === TRADING_SELECTORS.PairAdded) return "pair_added";
  return "unknown";
}

function parseTradingEventData(
  type: TradingEventType,
  keys: string[],
  data: string[],
): Record<string, string> {
  const parsed: Record<string, string> = {};

  switch (type) {
    case "order_placed":
      // OrderPlaced: keys[1]=order_id, keys[2]=maker
      if (keys[1]) parsed.order_id = keys[1];
      if (keys[2]) parsed.maker = keys[2];
      if (data[0]) parsed.pair_id = data[0];
      if (data[1]) parsed.side = data[1]; // 0=buy, 1=sell
      if (data[2]) parsed.price_low = data[2];
      if (data[3]) parsed.price_high = data[3];
      if (data[4]) parsed.amount_low = data[4];
      if (data[5]) parsed.amount_high = data[5];
      break;

    case "order_filled":
      // OrderFilled: keys[1]=order_id
      if (keys[1]) parsed.order_id = keys[1];
      if (data[0]) parsed.filled_amount_low = data[0];
      if (data[1]) parsed.filled_amount_high = data[1];
      if (data[2]) parsed.taker = data[2];
      break;

    case "order_cancelled":
      // OrderCancelled: keys[1]=order_id
      if (keys[1]) parsed.order_id = keys[1];
      break;

    case "trade_executed":
      // TradeExecuted: keys[1]=trade_id
      if (keys[1]) parsed.trade_id = keys[1];
      if (data[0]) parsed.pair_id = data[0];
      if (data[1]) parsed.maker = data[1];
      if (data[2]) parsed.taker = data[2];
      if (data[3]) parsed.price_low = data[3];
      if (data[4]) parsed.price_high = data[4];
      if (data[5]) parsed.amount_low = data[5];
      if (data[6]) parsed.amount_high = data[6];
      if (data[7]) parsed.side = data[7];
      break;

    case "pair_added":
      if (keys[1]) parsed.pair_id = keys[1];
      if (data[0]) parsed.base_token = data[0];
      if (data[1]) parsed.quote_token = data[1];
      break;
  }

  return parsed;
}

// ============================================================================
// Governance Event Classification & Parsing
// ============================================================================

function classifyGovernanceEvent(selector: string): GovernanceEventType {
  if (selector === GOVERNANCE_SELECTORS.ProposalCreated) return "proposal_created";
  if (selector === GOVERNANCE_SELECTORS.ProposalVoted) return "proposal_voted";
  if (selector === GOVERNANCE_SELECTORS.ProposalExecuted) return "proposal_executed";
  if (selector === GOVERNANCE_SELECTORS.ProposalQuorumAchieved) return "quorum_achieved";
  if (selector === GOVERNANCE_SELECTORS.VotingPowerUpdated) return "voting_power_updated";
  return "unknown";
}

function parseGovernanceEventData(
  type: GovernanceEventType,
  keys: string[],
  data: string[],
): Record<string, string> {
  const parsed: Record<string, string> = {};

  switch (type) {
    case "proposal_created":
      // ProposalCreated: keys[1]=proposal_id, keys[2]=proposer
      if (keys[1]) parsed.proposal_id = keys[1];
      if (keys[2]) parsed.proposer = keys[2];
      if (data[0]) parsed.description = data[0];
      if (data[1]) parsed.proposal_type = data[1];
      if (data[2]) parsed.voting_start = data[2];
      if (data[3]) parsed.voting_end = data[3];
      break;

    case "proposal_voted":
      // ProposalVoted: keys[1]=proposal_id, keys[2]=voter
      if (keys[1]) parsed.proposal_id = keys[1];
      if (keys[2]) parsed.voter = keys[2];
      if (data[0]) parsed.vote_for = data[0]; // bool
      if (data[1]) parsed.voting_power_low = data[1];
      if (data[2]) parsed.voting_power_high = data[2];
      break;

    case "proposal_executed":
      // ProposalExecuted: keys[1]=proposal_id
      if (keys[1]) parsed.proposal_id = keys[1];
      break;

    case "quorum_achieved":
      if (keys[1]) parsed.proposal_id = keys[1];
      break;

    case "voting_power_updated":
      if (keys[1]) parsed.account = keys[1];
      if (data[0]) parsed.new_power_low = data[0];
      if (data[1]) parsed.new_power_high = data[1];
      break;
  }

  return parsed;
}

// ============================================================================
// Staking Event Classification & Parsing
// ============================================================================

function classifyStakingEvent(selector: string): StakingEventType {
  if (selector === STAKING_SELECTORS.Staked) return "staked";
  if (selector === STAKING_SELECTORS.UnstakeRequested) return "unstake_requested";
  if (selector === STAKING_SELECTORS.UnstakeCompleted) return "unstake_completed";
  if (selector === STAKING_SELECTORS.Slashed) return "slashed";
  if (selector === STAKING_SELECTORS.RewardsClaimed) return "rewards_claimed";
  if (selector === STAKING_SELECTORS.SuccessRecorded) return "success_recorded";
  return "unknown";
}

function parseStakingEventData(
  type: StakingEventType,
  keys: string[],
  data: string[],
): Record<string, string> {
  const parsed: Record<string, string> = {};

  switch (type) {
    case "staked":
      // Staked: keys[1]=staker
      if (keys[1]) parsed.staker = keys[1];
      if (data[0]) parsed.amount_low = data[0];
      if (data[1]) parsed.amount_high = data[1];
      if (data[2]) parsed.gpu_tier = data[2];
      break;

    case "unstake_requested":
      if (keys[1]) parsed.staker = keys[1];
      if (data[0]) parsed.amount_low = data[0];
      if (data[1]) parsed.amount_high = data[1];
      break;

    case "unstake_completed":
      if (keys[1]) parsed.staker = keys[1];
      if (data[0]) parsed.amount_low = data[0];
      if (data[1]) parsed.amount_high = data[1];
      break;

    case "slashed":
      if (keys[1]) parsed.staker = keys[1];
      if (data[0]) parsed.amount_low = data[0];
      if (data[1]) parsed.amount_high = data[1];
      if (data[2]) parsed.reason = data[2];
      break;

    case "rewards_claimed":
      if (keys[1]) parsed.staker = keys[1];
      if (data[0]) parsed.amount_low = data[0];
      if (data[1]) parsed.amount_high = data[1];
      break;

    case "success_recorded":
      if (keys[1]) parsed.worker = keys[1];
      if (data[0]) parsed.job_id = data[0];
      break;
  }

  return parsed;
}

// ============================================================================
// Dark Pool Event Classification & Parsing
// ============================================================================

function classifyDarkPoolEvent(selector: string): DarkPoolEventType {
  if (selector === DARK_POOL_SELECTORS.OrderCommitted) return "order_committed";
  if (selector === DARK_POOL_SELECTORS.OrderRevealed) return "order_revealed";
  if (selector === DARK_POOL_SELECTORS.OrderCancelled) return "order_cancelled";
  if (selector === DARK_POOL_SELECTORS.OrderFilled) return "order_filled";
  if (selector === DARK_POOL_SELECTORS.EpochSettled) return "epoch_settled";
  if (selector === DARK_POOL_SELECTORS.Deposited) return "deposited";
  if (selector === DARK_POOL_SELECTORS.Withdrawn) return "withdrawn";
  return "unknown";
}

function parseDarkPoolEventData(
  type: DarkPoolEventType,
  keys: string[],
  data: string[],
): Record<string, string> {
  const parsed: Record<string, string> = {};

  switch (type) {
    case "order_committed":
      // OrderCommitted: keys[1..2]=order_id(u256), keys[3]=trader
      if (keys[1]) parsed.order_id_low = keys[1];
      if (keys[2]) parsed.order_id_high = keys[2];
      if (keys[3]) parsed.trader = keys[3];
      if (data[0]) parsed.epoch = data[0];
      if (data[1]) parsed.side = data[1];
      if (data[2]) parsed.give_asset = data[2];
      if (data[3]) parsed.want_asset = data[3];
      if (data[4]) parsed.order_hash = data[4];
      break;

    case "order_revealed":
      // OrderRevealed: keys[1..2]=order_id(u256)
      if (keys[1]) parsed.order_id_low = keys[1];
      if (keys[2]) parsed.order_id_high = keys[2];
      if (data[0]) parsed.price_low = data[0];
      if (data[1]) parsed.price_high = data[1];
      if (data[2]) parsed.amount_low = data[2];
      if (data[3]) parsed.amount_high = data[3];
      break;

    case "order_cancelled":
      // OrderCancelled: keys[1..2]=order_id(u256), keys[3]=trader
      if (keys[1]) parsed.order_id_low = keys[1];
      if (keys[2]) parsed.order_id_high = keys[2];
      if (keys[3]) parsed.trader = keys[3];
      break;

    case "order_filled":
      // OrderFilled: keys[1..2]=order_id(u256)
      if (keys[1]) parsed.order_id_low = keys[1];
      if (keys[2]) parsed.order_id_high = keys[2];
      if (data[0]) parsed.fill_amount_low = data[0];
      if (data[1]) parsed.fill_amount_high = data[1];
      if (data[2]) parsed.clearing_price_low = data[2];
      if (data[3]) parsed.clearing_price_high = data[3];
      break;

    case "epoch_settled":
      // EpochSettled: keys[1]=epoch_id
      if (keys[1]) parsed.epoch_id = keys[1];
      if (data[0]) parsed.clearing_price_low = data[0];
      if (data[1]) parsed.clearing_price_high = data[1];
      if (data[2]) parsed.total_buy_filled_low = data[2];
      if (data[3]) parsed.total_buy_filled_high = data[3];
      if (data[4]) parsed.total_sell_filled_low = data[4];
      if (data[5]) parsed.total_sell_filled_high = data[5];
      if (data[6]) parsed.num_fills = data[6];
      break;

    case "deposited":
      // Deposited: keys[1]=trader
      if (keys[1]) parsed.trader = keys[1];
      if (data[0]) parsed.asset = data[0];
      if (data[1]) parsed.amount_low = data[1];
      if (data[2]) parsed.amount_high = data[2];
      break;

    case "withdrawn":
      // Withdrawn: keys[1]=trader
      if (keys[1]) parsed.trader = keys[1];
      if (data[0]) parsed.asset = data[0];
      if (data[1]) parsed.amount_low = data[1];
      if (data[2]) parsed.amount_high = data[2];
      break;
  }

  return parsed;
}

// ============================================================================
// Core Fetch Function
// ============================================================================

export async function fetchProtocolEvents<T extends string = string>(
  options: FetchProtocolEventsOptions,
): Promise<FetchProtocolEventsResult<T>> {
  const {
    network = "sepolia",
    domain,
    fromBlock = 0,
    toBlock = "latest",
    chunkSize = 50,
    continuationToken,
  } = options;

  const rpcUrl = NETWORK_CONFIG[network]?.rpcUrl;
  if (!rpcUrl) {
    return { events: [], hasMore: false };
  }

  const config = getDomainConfig(domain, network);
  if (!config || !config.address || config.address === "0x0") {
    return { events: [], hasMore: false };
  }

  const paddedAddr = num.toHex(num.toBigInt(config.address));

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
            keys: [config.selectors],
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

    const events: ProtocolEvent<T>[] = [];

    for (const event of result.events) {
      const eventSelector = event.keys?.[0] || "";
      const eventType = config.classify(eventSelector) as T;

      // Optional address filter (check if address appears in keys)
      if (options.addressFilter) {
        const normalizedFilter = num.toHex(num.toBigInt(options.addressFilter)).toLowerCase();
        const matchesAddress = event.keys?.some(
          (k: string) => num.toHex(num.toBigInt(k)).toLowerCase() === normalizedFilter,
        );
        if (!matchesAddress) continue;
      }

      const data = config.parse(eventType as string, event.keys || [], event.data || []);

      events.push({
        id: `${event.transaction_hash}-${event.block_number}-${events.length}`,
        domain,
        type: eventType,
        contractAddress: event.from_address || config.address,
        transactionHash: event.transaction_hash,
        blockNumber: event.block_number,
        timestamp: null,
        data,
        rawKeys: event.keys || [],
        rawData: event.data || [],
      });
    }

    // Sort by block number (newest first)
    events.sort((a, b) => b.blockNumber - a.blockNumber);

    return {
      events,
      continuationToken: result.continuation_token,
      hasMore: !!result.continuation_token,
    };
  } catch (error) {
    console.error(`[ProtocolEvents:${domain}] Error fetching events:`, error);
    return { events: [], hasMore: false };
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

export function getTradingEventLabel(type: TradingEventType): string {
  const labels: Record<TradingEventType, string> = {
    order_placed: "Order Placed",
    order_cancelled: "Order Cancelled",
    order_filled: "Order Filled",
    trade_executed: "Trade Executed",
    pair_added: "Pair Added",
    unknown: "Unknown",
  };
  return labels[type];
}

export function getGovernanceEventLabel(type: GovernanceEventType): string {
  const labels: Record<GovernanceEventType, string> = {
    proposal_created: "Proposal Created",
    proposal_voted: "Vote Cast",
    proposal_executed: "Proposal Executed",
    quorum_achieved: "Quorum Achieved",
    voting_power_updated: "Voting Power Updated",
    unknown: "Unknown",
  };
  return labels[type];
}

export function getStakingEventLabel(type: StakingEventType): string {
  const labels: Record<StakingEventType, string> = {
    staked: "Staked",
    unstake_requested: "Unstake Requested",
    unstake_completed: "Unstake Completed",
    slashed: "Slashed",
    rewards_claimed: "Rewards Claimed",
    success_recorded: "Success Recorded",
    unknown: "Unknown",
  };
  return labels[type];
}

// ============================================================================
// Stealth Event Classification & Parsing
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
      if (data[0]) parsed.spending_pubkey_x = data[0];
      if (data[1]) parsed.viewing_pubkey_x = data[1];
      if (data[2]) parsed.timestamp = data[2];
      break;

    case "payment_sent":
      // keys[1..2]=announcement_index(u256), keys[3]=stealth_address
      if (keys[1]) parsed.announcement_index_low = keys[1];
      if (keys[2]) parsed.announcement_index_high = keys[2];
      if (keys[3]) parsed.stealth_address = keys[3];
      if (data[0]) parsed.ephemeral_pubkey_x = data[0];
      if (data[1]) parsed.view_tag = data[1];
      if (data[2]) parsed.job_id_low = data[2];
      if (data[3]) parsed.job_id_high = data[3];
      if (data[4]) parsed.timestamp = data[4];
      break;

    case "payment_claimed":
      // keys[1..2]=announcement_index(u256), keys[3]=claimer
      if (keys[1]) parsed.announcement_index_low = keys[1];
      if (keys[2]) parsed.announcement_index_high = keys[2];
      if (keys[3]) parsed.claimer = keys[3];
      if (data[0]) parsed.recipient = data[0];
      if (data[1]) parsed.amount_low = data[1];
      if (data[2]) parsed.amount_high = data[2];
      if (data[3]) parsed.timestamp = data[3];
      break;
  }

  return parsed;
}

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
