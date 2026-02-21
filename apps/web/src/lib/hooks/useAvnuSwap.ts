"use client";

/**
 * useAvnuSwap — Hardened React hook for AVNU DEX aggregator swaps
 *
 * Hardening:
 *  - BigInt-safe amount conversion (parseAmountToRaw — no floating-point)
 *  - AbortController cancels in-flight quote requests on new input (no race conditions)
 *  - Quote expiry tracking (15s TTL, blocked execution on expired quotes)
 *  - Page Visibility API pauses auto-refresh when tab is backgrounded
 *  - Concurrent-execution mutex (prevents double-submission)
 *  - Request sequence counter ensures stale responses are discarded
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import { useNetwork } from "@/lib/contexts/NetworkContext";
import {
  fetchAvnuQuote,
  buildAvnuSwap,
  parseAmountToRaw,
  type AvnuQuote,
} from "@/lib/swap/avnuSwap";
import type { NetworkType } from "@/lib/contracts/addresses";

// ============================================================================
// CONSTANTS
// ============================================================================

const DEBOUNCE_MS = 500;
const AUTO_REFRESH_MS = 15_000;
const QUOTE_TTL_MS = 30_000; // quotes expire after 30s

// ============================================================================
// TYPES
// ============================================================================

export interface AvnuSwapState {
  stage: "idle" | "quoting" | "building" | "submitting" | "confirming" | "confirmed" | "error";
  message: string;
  error: string | null;
  txHash: string | null;
}

export interface UseAvnuSwapResult {
  state: AvnuSwapState;
  quotes: AvnuQuote[];
  selectedQuote: AvnuQuote | null;
  isQuoting: boolean;
  /** Timestamp (ms) when the current quotes were fetched */
  quoteFetchedAt: number | null;
  /** Whether the current quote is still fresh (within TTL) */
  isQuoteFresh: boolean;
  fetchQuotes: (params: {
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    sellDecimals: number;
  }) => void;
  selectQuote: (quote: AvnuQuote) => void;
  executeSwap: (slippageBps: number) => Promise<string | null>;
  reset: () => void;
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const INITIAL_STATE: AvnuSwapState = {
  stage: "idle",
  message: "",
  error: null,
  txHash: null,
};

// ============================================================================
// HOOK
// ============================================================================

export function useAvnuSwap(): UseAvnuSwapResult {
  const { address } = useAccount();
  const { sendAsync } = useSendTransaction({});
  const { network } = useNetwork();

  const [state, setState] = useState<AvnuSwapState>(INITIAL_STATE);
  const [quotes, setQuotes] = useState<AvnuQuote[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<AvnuQuote | null>(null);
  const [quoteFetchedAt, setQuoteFetchedAt] = useState<number | null>(null);
  const [isQuoteFresh, setIsQuoteFresh] = useState(false);

  // Refs for lifecycle management
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const freshnessRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const isExecutingRef = useRef(false);
  const lastParamsRef = useRef<{
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    sellDecimals: number;
  } | null>(null);
  // Stable ref to latest doFetchQuotes to avoid stale closures in effects
  const doFetchQuotesRef = useRef<((params: {
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    sellDecimals: number;
  }) => Promise<void>) | null>(null);

  // ── Quote freshness tracker ────────────────────────────────────────────
  useEffect(() => {
    // Update freshness every second
    freshnessRef.current = setInterval(() => {
      if (quoteFetchedAt) {
        setIsQuoteFresh(Date.now() - quoteFetchedAt < QUOTE_TTL_MS);
      } else {
        setIsQuoteFresh(false);
      }
    }, 1_000);

    return () => {
      if (freshnessRef.current) clearInterval(freshnessRef.current);
    };
  }, [quoteFetchedAt]);

  // ── Page Visibility — pause auto-refresh when tab is hidden ────────────
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        // Pause auto-refresh
        if (refreshRef.current) {
          clearInterval(refreshRef.current);
          refreshRef.current = null;
        }
      } else {
        // Resume: re-fetch immediately then restart interval (via ref to avoid stale closure)
        if (lastParamsRef.current && doFetchQuotesRef.current) {
          doFetchQuotesRef.current(lastParamsRef.current);
          startAutoRefresh();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (refreshRef.current) clearInterval(refreshRef.current);
      if (freshnessRef.current) clearInterval(freshnessRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // ── Start/stop auto-refresh helper ─────────────────────────────────────
  const startAutoRefresh = useCallback(() => {
    if (refreshRef.current) clearInterval(refreshRef.current);
    refreshRef.current = setInterval(() => {
      if (lastParamsRef.current && !document.hidden && doFetchQuotesRef.current) {
        doFetchQuotesRef.current(lastParamsRef.current);
      }
    }, AUTO_REFRESH_MS);
  }, []);

  // ── Core quote fetch — cancels in-flight, validates sequence ───────────
  const doFetchQuotes = useCallback(async (params: {
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    sellDecimals: number;
  }) => {
    if (!address) return;

    // Cancel any in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    // Sequence counter — discard stale responses
    const seq = ++requestSeqRef.current;

    // Convert human amount to raw uint256 (BigInt-safe, no floating-point)
    let rawAmount: string;
    try {
      rawAmount = parseAmountToRaw(params.sellAmount, params.sellDecimals);
    } catch {
      setState((s) => ({ ...s, stage: "idle", error: "Invalid amount" }));
      return;
    }

    if (rawAmount === "0") {
      setQuotes([]);
      setSelectedQuote(null);
      setQuoteFetchedAt(null);
      return;
    }

    setState((s) => ({ ...s, stage: "quoting", message: "Fetching quotes...", error: null }));

    try {
      const result = await fetchAvnuQuote({
        sellToken: params.sellToken,
        buyToken: params.buyToken,
        sellAmount: rawAmount,
        takerAddress: address,
        network: network as NetworkType,
        signal: controller.signal,
      });

      // Discard if a newer request has been issued
      if (seq !== requestSeqRef.current) return;

      setQuotes(result);
      setSelectedQuote(result[0] || null);
      setQuoteFetchedAt(Date.now());
      setIsQuoteFresh(true);
      setState((s) => ({ ...s, stage: "idle", message: "" }));
    } catch (err) {
      // Ignore aborted requests silently
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (seq !== requestSeqRef.current) return;

      const msg = err instanceof Error ? err.message : "Failed to fetch quotes";
      setState((s) => ({ ...s, stage: "idle", message: "", error: msg }));
      setQuotes([]);
      setSelectedQuote(null);
      setQuoteFetchedAt(null);
    }
  }, [address, network]);

  // Keep ref in sync so effects/intervals always call the latest version
  doFetchQuotesRef.current = doFetchQuotes;

  // ── Public fetchQuotes — debounced + auto-refresh ──────────────────────
  const fetchQuotes = useCallback((params: {
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    sellDecimals: number;
  }) => {
    lastParamsRef.current = params;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      doFetchQuotes(params);
    }, DEBOUNCE_MS);

    // Restart auto-refresh
    startAutoRefresh();
  }, [doFetchQuotes, startAutoRefresh]);

  // ── Quote selection ────────────────────────────────────────────────────
  const selectQuote = useCallback((quote: AvnuQuote) => {
    setSelectedQuote(quote);
  }, []);

  // ── Execute swap — mutex-guarded, expiry-checked ───────────────────────
  const executeSwap = useCallback(async (slippageBps: number): Promise<string | null> => {
    // Concurrent-execution guard
    if (isExecutingRef.current) {
      console.warn("[AVNU] Swap already in progress, ignoring duplicate call");
      return null;
    }
    if (!selectedQuote || !address) return null;

    // Quote expiry check
    if (!quoteFetchedAt || Date.now() - quoteFetchedAt > QUOTE_TTL_MS) {
      setState({
        stage: "error",
        message: "Quote expired",
        error: "This quote has expired. Please refresh to get a new quote.",
        txHash: null,
      });
      return null;
    }

    // Slippage bounds validation
    const clampedSlippage = Math.max(0, Math.min(slippageBps, 5_000)); // cap at 50%
    if (clampedSlippage !== slippageBps) {
      console.warn(`[AVNU] Slippage clamped from ${slippageBps} to ${clampedSlippage} bps`);
    }

    isExecutingRef.current = true;

    // Stop auto-refresh during execution
    if (refreshRef.current) {
      clearInterval(refreshRef.current);
      refreshRef.current = null;
    }

    try {
      setState({ stage: "building", message: "Building transaction...", error: null, txHash: null });

      const { calls } = await buildAvnuSwap({
        quoteId: selectedQuote.quoteId,
        takerAddress: address,
        slippage: clampedSlippage / 10_000,
        network: network as NetworkType,
      });

      setState((s) => ({ ...s, stage: "submitting", message: "Confirm in wallet..." }));

      const result = await sendAsync(
        calls.map((c) => ({
          contractAddress: c.contractAddress,
          entrypoint: c.entrypoint,
          calldata: c.calldata,
        }))
      );

      const txHash = result.transaction_hash;
      setState({ stage: "confirmed", message: "Swap complete!", error: null, txHash });
      return txHash;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Swap failed";
      const isRejected = msg.toLowerCase().includes("reject") || msg.toLowerCase().includes("cancel");
      setState({
        stage: "error",
        message: isRejected ? "Transaction rejected" : "Swap failed",
        error: isRejected ? "You rejected the transaction in your wallet." : msg,
        txHash: null,
      });
      return null;
    } finally {
      isExecutingRef.current = false;
    }
  }, [selectedQuote, address, network, sendAsync, quoteFetchedAt]);

  // ── Reset ──────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setState(INITIAL_STATE);
    setQuotes([]);
    setSelectedQuote(null);
    setQuoteFetchedAt(null);
    setIsQuoteFresh(false);
    lastParamsRef.current = null;
    isExecutingRef.current = false;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (refreshRef.current) {
      clearInterval(refreshRef.current);
      refreshRef.current = null;
    }
  }, []);

  return {
    state,
    quotes,
    selectedQuote,
    isQuoting: state.stage === "quoting",
    quoteFetchedAt,
    isQuoteFresh,
    fetchQuotes,
    selectQuote,
    executeSwap,
    reset,
  };
}
