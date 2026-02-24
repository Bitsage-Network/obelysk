"use client";

/**
 * Protocol Event Polling Hooks
 *
 * Drop-in replacements for the dead WebSocket hooks (useTradingWebSocket, etc.).
 * Uses on-chain event polling via starknet_getEvents instead of WebSocket connections.
 *
 * Each hook polls at a configurable interval and maintains state identical to the
 * WebSocket hooks it replaces, so components can switch without UI changes.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchProtocolEvents,
  type ProtocolEvent,
  type TradingEventType,
  type GovernanceEventType,
  type StakingEventType,
  type DarkPoolEventType,
} from "../events/protocolEvents";
import { fetchPrivacyEvents, type PrivacyEvent } from "../events/privacyEvents";
import type { NetworkType } from "../contracts/addresses";

// ============================================================================
// Shared Polling Infrastructure
// ============================================================================

interface UseEventPollerOptions {
  /** Polling interval in milliseconds (default: 15000 = 15s) */
  pollInterval?: number;
  /** Start polling immediately (default: true) */
  autoStart?: boolean;
  /** Network to poll (default: "sepolia") */
  network?: NetworkType;
  /** Only fetch events from this block onward (default: fetches recent) */
  fromBlock?: number;
  /** Maximum events to keep in state */
  maxEvents?: number;
}

interface EventPollerState {
  isPolling: boolean;
  lastPollTime: number | null;
  error: string | null;
  pollCount: number;
}

// ============================================================================
// Trading Events Hook (replaces useTradingWebSocket)
// ============================================================================

export interface TradingOrder {
  order_id: string;
  maker: string;
  pair_id: string;
  side: "buy" | "sell";
  price: string;
  amount: string;
  tx_hash: string;
  block_number: number;
  timestamp: number;
}

export interface TradingTrade {
  trade_id: string;
  pair_id: string;
  maker: string;
  taker: string;
  price: string;
  amount: string;
  side: string;
  tx_hash: string;
  block_number: number;
  timestamp: number;
}

export function useTradingEvents(
  pairId?: number,
  options: UseEventPollerOptions = {},
) {
  const {
    pollInterval = 15000,
    autoStart = true,
    network = "sepolia",
    maxEvents = 100,
  } = options;

  const [orderBook, setOrderBook] = useState<{
    bids: TradingOrder[];
    asks: TradingOrder[];
  }>({ bids: [], asks: [] });
  const [recentTrades, setRecentTrades] = useState<TradingTrade[]>([]);
  const [state, setState] = useState<EventPollerState>({
    isPolling: false,
    lastPollTime: null,
    error: null,
    pollCount: 0,
  });

  const lastBlockRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const intervalRef = useRef<NodeJS.Timeout>();

  const poll = useCallback(async () => {
    if (!mountedRef.current) return;

    setState((prev) => ({ ...prev, isPolling: true, error: null }));

    try {
      const result = await fetchProtocolEvents<TradingEventType>({
        network,
        domain: "trading",
        fromBlock: lastBlockRef.current || undefined,
        chunkSize: 100,
      });

      if (!mountedRef.current) return;

      // Update last block
      if (result.events.length > 0) {
        lastBlockRef.current = Math.max(
          ...result.events.map((e) => e.blockNumber),
        ) + 1;
      }

      // Process events into orderbook and trades
      for (const event of result.events) {
        if (event.type === "order_placed") {
          const order: TradingOrder = {
            order_id: event.data.order_id || "",
            maker: event.data.maker || "",
            pair_id: event.data.pair_id || "",
            side: event.data.side === "1" ? "sell" : "buy",
            price: event.data.price_low || "0",
            amount: event.data.amount_low || "0",
            tx_hash: event.transactionHash,
            block_number: event.blockNumber,
            timestamp: Date.now(),
          };

          // Filter by pair if specified
          if (pairId !== undefined && order.pair_id !== String(pairId)) continue;

          setOrderBook((prev) => ({
            bids: order.side === "buy" ? [order, ...prev.bids] : prev.bids,
            asks: order.side === "sell" ? [order, ...prev.asks] : prev.asks,
          }));
        } else if (event.type === "order_filled" || event.type === "order_cancelled") {
          const orderId = event.data.order_id || "";
          setOrderBook((prev) => ({
            bids: prev.bids.filter((o) => o.order_id !== orderId),
            asks: prev.asks.filter((o) => o.order_id !== orderId),
          }));
        } else if (event.type === "trade_executed") {
          const trade: TradingTrade = {
            trade_id: event.data.trade_id || "",
            pair_id: event.data.pair_id || "",
            maker: event.data.maker || "",
            taker: event.data.taker || "",
            price: event.data.price_low || "0",
            amount: event.data.amount_low || "0",
            side: event.data.side === "1" ? "sell" : "buy",
            tx_hash: event.transactionHash,
            block_number: event.blockNumber,
            timestamp: Date.now(),
          };
          setRecentTrades((prev) => [trade, ...prev.slice(0, maxEvents - 1)]);
        }
      }

      setState((prev) => ({
        ...prev,
        isPolling: false,
        lastPollTime: Date.now(),
        pollCount: prev.pollCount + 1,
      }));
    } catch (error) {
      if (!mountedRef.current) return;
      setState((prev) => ({
        ...prev,
        isPolling: false,
        error: error instanceof Error ? error.message : "Polling failed",
      }));
    }
  }, [network, pairId, maxEvents]);

  useEffect(() => {
    mountedRef.current = true;

    if (autoStart) {
      poll(); // Initial poll
      intervalRef.current = setInterval(poll, pollInterval);
    }

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoStart, poll, pollInterval]);

  return {
    orderBook,
    recentTrades,
    ...state,
    isConnected: state.lastPollTime !== null,
    connectionState: state.isPolling ? "polling" as const : state.error ? "error" as const : "connected" as const,
    retry: poll,
  };
}

// ============================================================================
// Governance Events Hook (replaces useGovernanceWebSocket)
// ============================================================================

export interface GovernanceProposalEvent {
  proposal_id: string;
  proposer: string;
  description: string;
  proposal_type: string;
  voting_start: string;
  voting_end: string;
  tx_hash: string;
  block_number: number;
  timestamp: number;
}

export interface GovernanceVoteEvent {
  proposal_id: string;
  voter: string;
  support: boolean;
  voting_power: string;
  tx_hash: string;
  block_number: number;
  timestamp: number;
}

export function useGovernanceEvents(
  proposalId?: string,
  options: UseEventPollerOptions = {},
) {
  const {
    pollInterval = 30000, // 30s — governance events are less frequent
    autoStart = true,
    network = "sepolia",
    maxEvents = 100,
  } = options;

  const [proposals, setProposals] = useState<GovernanceProposalEvent[]>([]);
  const [votes, setVotes] = useState<GovernanceVoteEvent[]>([]);
  const [state, setState] = useState<EventPollerState>({
    isPolling: false,
    lastPollTime: null,
    error: null,
    pollCount: 0,
  });

  const lastBlockRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const intervalRef = useRef<NodeJS.Timeout>();

  const poll = useCallback(async () => {
    if (!mountedRef.current) return;
    setState((prev) => ({ ...prev, isPolling: true, error: null }));

    try {
      const result = await fetchProtocolEvents<GovernanceEventType>({
        network,
        domain: "governance",
        fromBlock: lastBlockRef.current || undefined,
        chunkSize: 100,
      });

      if (!mountedRef.current) return;

      if (result.events.length > 0) {
        lastBlockRef.current = Math.max(
          ...result.events.map((e) => e.blockNumber),
        ) + 1;
      }

      for (const event of result.events) {
        if (event.type === "proposal_created") {
          const proposal: GovernanceProposalEvent = {
            proposal_id: event.data.proposal_id || "",
            proposer: event.data.proposer || "",
            description: event.data.description || "",
            proposal_type: event.data.proposal_type || "0",
            voting_start: event.data.voting_start || "",
            voting_end: event.data.voting_end || "",
            tx_hash: event.transactionHash,
            block_number: event.blockNumber,
            timestamp: Date.now(),
          };

          if (proposalId && proposal.proposal_id !== proposalId) continue;
          setProposals((prev) => [proposal, ...prev]);
        } else if (event.type === "proposal_voted") {
          const vote: GovernanceVoteEvent = {
            proposal_id: event.data.proposal_id || "",
            voter: event.data.voter || "",
            support: event.data.vote_for === "1" || event.data.vote_for === "0x1",
            voting_power: event.data.voting_power_low || "0",
            tx_hash: event.transactionHash,
            block_number: event.blockNumber,
            timestamp: Date.now(),
          };

          if (proposalId && vote.proposal_id !== proposalId) continue;
          setVotes((prev) => [vote, ...prev.slice(0, maxEvents - 1)]);
        }
      }

      setState((prev) => ({
        ...prev,
        isPolling: false,
        lastPollTime: Date.now(),
        pollCount: prev.pollCount + 1,
      }));
    } catch (error) {
      if (!mountedRef.current) return;
      setState((prev) => ({
        ...prev,
        isPolling: false,
        error: error instanceof Error ? error.message : "Polling failed",
      }));
    }
  }, [network, proposalId, maxEvents]);

  useEffect(() => {
    mountedRef.current = true;
    if (autoStart) {
      poll();
      intervalRef.current = setInterval(poll, pollInterval);
    }
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoStart, poll, pollInterval]);

  return {
    proposals,
    votes,
    ...state,
    isConnected: state.lastPollTime !== null,
    connectionState: state.isPolling ? "polling" as const : state.error ? "error" as const : "connected" as const,
    retry: poll,
  };
}

// ============================================================================
// Staking Events Hook (replaces useStakingWebSocket)
// ============================================================================

export interface StakingEventItem {
  event_type: "staked" | "unstake_requested" | "unstake_completed" | "slashed" | "rewards_claimed";
  staker: string;
  amount: string;
  gpu_tier?: string;
  reason?: string;
  tx_hash: string;
  block_number: number;
  timestamp: number;
}

export function useStakingEvents(
  address?: string,
  options: UseEventPollerOptions = {},
) {
  const {
    pollInterval = 20000,
    autoStart = true,
    network = "sepolia",
    maxEvents = 100,
  } = options;

  const [stakingEvents, setStakingEvents] = useState<StakingEventItem[]>([]);
  const [state, setState] = useState<EventPollerState>({
    isPolling: false,
    lastPollTime: null,
    error: null,
    pollCount: 0,
  });

  const lastBlockRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const intervalRef = useRef<NodeJS.Timeout>();

  const poll = useCallback(async () => {
    if (!mountedRef.current) return;
    setState((prev) => ({ ...prev, isPolling: true, error: null }));

    try {
      const result = await fetchProtocolEvents<StakingEventType>({
        network,
        domain: "staking",
        fromBlock: lastBlockRef.current || undefined,
        chunkSize: 100,
        addressFilter: address,
      });

      if (!mountedRef.current) return;

      if (result.events.length > 0) {
        lastBlockRef.current = Math.max(
          ...result.events.map((e) => e.blockNumber),
        ) + 1;
      }

      const newEvents: StakingEventItem[] = [];
      for (const event of result.events) {
        if (event.type === "unknown") continue;

        const item: StakingEventItem = {
          event_type: event.type as StakingEventItem["event_type"],
          staker: event.data.staker || "",
          amount: event.data.amount_low || "0",
          gpu_tier: event.data.gpu_tier,
          reason: event.data.reason,
          tx_hash: event.transactionHash,
          block_number: event.blockNumber,
          timestamp: Date.now(),
        };
        newEvents.push(item);
      }

      if (newEvents.length > 0) {
        setStakingEvents((prev) => [...newEvents, ...prev].slice(0, maxEvents));
      }

      setState((prev) => ({
        ...prev,
        isPolling: false,
        lastPollTime: Date.now(),
        pollCount: prev.pollCount + 1,
      }));
    } catch (error) {
      if (!mountedRef.current) return;
      setState((prev) => ({
        ...prev,
        isPolling: false,
        error: error instanceof Error ? error.message : "Polling failed",
      }));
    }
  }, [network, address, maxEvents]);

  useEffect(() => {
    mountedRef.current = true;
    if (autoStart) {
      poll();
      intervalRef.current = setInterval(poll, pollInterval);
    }
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoStart, poll, pollInterval]);

  return {
    stakingEvents,
    ...state,
    isConnected: state.lastPollTime !== null,
    connectionState: state.isPolling ? "polling" as const : state.error ? "error" as const : "connected" as const,
    retry: poll,
  };
}

// ============================================================================
// Privacy Events Hook (replaces usePrivacyWebSocket, wraps existing service)
// ============================================================================

export function usePrivacyEvents(
  address?: string,
  options: UseEventPollerOptions = {},
) {
  const {
    pollInterval = 15000,
    autoStart = true,
    network = "sepolia",
    maxEvents = 100,
  } = options;

  const [privacyEvents, setPrivacyEvents] = useState<PrivacyEvent[]>([]);
  const [state, setState] = useState<EventPollerState>({
    isPolling: false,
    lastPollTime: null,
    error: null,
    pollCount: 0,
  });

  const lastBlockRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const intervalRef = useRef<NodeJS.Timeout>();

  const poll = useCallback(async () => {
    if (!mountedRef.current) return;
    setState((prev) => ({ ...prev, isPolling: true, error: null }));

    try {
      const result = await fetchPrivacyEvents({
        network,
        fromBlock: lastBlockRef.current || undefined,
        chunkSize: 100,
      });

      if (!mountedRef.current) return;

      if (result.events.length > 0) {
        lastBlockRef.current = Math.max(
          ...result.events.map((e) => e.blockNumber),
        ) + 1;

        setPrivacyEvents((prev) =>
          [...result.events, ...prev].slice(0, maxEvents),
        );
      }

      setState((prev) => ({
        ...prev,
        isPolling: false,
        lastPollTime: Date.now(),
        pollCount: prev.pollCount + 1,
      }));
    } catch (error) {
      if (!mountedRef.current) return;
      setState((prev) => ({
        ...prev,
        isPolling: false,
        error: error instanceof Error ? error.message : "Polling failed",
      }));
    }
  }, [network, maxEvents]);

  useEffect(() => {
    mountedRef.current = true;
    if (autoStart) {
      poll();
      intervalRef.current = setInterval(poll, pollInterval);
    }
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoStart, poll, pollInterval]);

  return {
    privacyEvents,
    ...state,
    isConnected: state.lastPollTime !== null,
    connectionState: state.isPolling ? "polling" as const : state.error ? "error" as const : "connected" as const,
    retry: poll,
  };
}

// ============================================================================
// Dark Pool Events Hook (commit/reveal/fill/settle activity)
// ============================================================================

export interface DarkPoolEventItem {
  event_type: DarkPoolEventType;
  order_id?: string;
  trader?: string;
  epoch_id?: string;
  clearing_price?: string;
  fill_amount?: string;
  asset?: string;
  amount?: string;
  tx_hash: string;
  block_number: number;
  timestamp: number;
}

export function useDarkPoolEvents(
  options: UseEventPollerOptions = {},
) {
  const {
    pollInterval = 8000, // 2 blocks — fast for dark pool activity
    autoStart = true,
    network = "sepolia",
    maxEvents = 100,
  } = options;

  const [darkPoolEvents, setDarkPoolEvents] = useState<DarkPoolEventItem[]>([]);
  const [state, setState] = useState<EventPollerState>({
    isPolling: false,
    lastPollTime: null,
    error: null,
    pollCount: 0,
  });

  // Start from a recent block, NOT block 0.
  // On Sepolia there are millions of blocks — querying from 0 causes
  // the RPC to silently timeout or return empty results.
  const lastBlockRef = useRef<number>(0);
  const initializedRef = useRef(false);
  const mountedRef = useRef(true);
  const intervalRef = useRef<NodeJS.Timeout>();

  const poll = useCallback(async () => {
    if (!mountedRef.current) return;

    // On first poll, fetch current block and look back ~500 blocks (~30 min)
    if (!initializedRef.current) {
      initializedRef.current = true;
      try {
        const { NETWORK_CONFIG: netCfg } = await import("../contracts/addresses");
        const rpcUrl = netCfg[network]?.rpcUrl;
        if (rpcUrl) {
          const res = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "starknet_blockNumber", params: [], id: 1 }),
          });
          const json = await res.json();
          const currentBlock = typeof json.result === "number" ? json.result : 0;
          if (currentBlock > 500) {
            lastBlockRef.current = currentBlock - 500;
          }
        }
      } catch {
        // If we can't fetch the block number, we'll use 0 and hope for the best
      }
    }

    setState((prev) => ({ ...prev, isPolling: true, error: null }));

    try {
      const result = await fetchProtocolEvents<DarkPoolEventType>({
        network,
        domain: "dark_pool",
        fromBlock: lastBlockRef.current || undefined,
        chunkSize: 100,
      });

      if (!mountedRef.current) return;

      if (result.events.length > 0) {
        lastBlockRef.current = Math.max(
          ...result.events.map((e) => e.blockNumber),
        ) + 1;
      } else if (lastBlockRef.current === 0) {
        // No events found from block 0 — advance to avoid re-querying the entire chain
        // This shouldn't happen with the initialization above, but guard against it
        initializedRef.current = false; // retry initialization on next poll
      }

      const newEvents: DarkPoolEventItem[] = [];
      for (const event of result.events) {
        if (event.type === "unknown") continue;

        const item: DarkPoolEventItem = {
          event_type: event.type,
          order_id: event.data.order_id_low || event.data.order_id,
          trader: event.data.trader,
          epoch_id: event.data.epoch_id,
          clearing_price: event.data.clearing_price_low,
          fill_amount: event.data.fill_amount_low,
          asset: event.data.asset,
          amount: event.data.amount_low,
          tx_hash: event.transactionHash,
          block_number: event.blockNumber,
          timestamp: Date.now(),
        };
        newEvents.push(item);
      }

      if (newEvents.length > 0) {
        setDarkPoolEvents((prev) => [...newEvents, ...prev].slice(0, maxEvents));
      }

      setState((prev) => ({
        ...prev,
        isPolling: false,
        lastPollTime: Date.now(),
        pollCount: prev.pollCount + 1,
      }));
    } catch (error) {
      if (!mountedRef.current) return;
      setState((prev) => ({
        ...prev,
        isPolling: false,
        error: error instanceof Error ? error.message : "Polling failed",
      }));
    }
  }, [network, maxEvents]);

  useEffect(() => {
    mountedRef.current = true;
    if (autoStart) {
      poll();
      intervalRef.current = setInterval(poll, pollInterval);
    }
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoStart, poll, pollInterval]);

  return {
    darkPoolEvents,
    ...state,
    isConnected: state.lastPollTime !== null,
    connectionState: state.isPolling ? "polling" as const : state.error ? "error" as const : "connected" as const,
    retry: poll,
  };
}
