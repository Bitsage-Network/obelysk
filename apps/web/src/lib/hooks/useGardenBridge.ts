/**
 * useGardenBridge Hook
 *
 * Manages the full BTC → Starknet bridge lifecycle via Garden Finance:
 * 1. Fetch quote (debounced, on amount change)
 * 2. Create order → BTC deposit address (HTLC)
 * 3. Poll order status until wBTC arrives on Starknet
 *
 * After the bridge completes, the caller continues with the existing
 * VM31 deposit flow (ERC20 approve → relayer submit → STWO proof).
 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  getQuote,
  createBtcToStarknetOrder,
  getOrderStatus,
  GARDEN_ASSETS,
  isGardenAvailable,
  type GardenNetwork,
  type GardenQuoteResponse,
} from "../btc/gardenApi";
import type { GardenBridgeResult, GardenOrderProgress } from "../btc/types";

const POLL_INTERVAL_MS = 5_000;
const QUOTE_DEBOUNCE_MS = 600;

export function useGardenBridge(network: GardenNetwork) {
  const [quote, setQuote] = useState<GardenQuoteResponse | null>(null);
  const [order, setOrder] = useState<GardenBridgeResult | null>(null);
  const [progress, setProgress] = useState<GardenOrderProgress | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const available = isGardenAvailable();
  const assets = GARDEN_ASSETS[network];

  // ========================================================================
  // Fetch quote (debounced)
  // ========================================================================

  const fetchQuote = useCallback(
    async (satoshis: bigint) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setError(null);

      if (satoshis <= 0n) {
        setQuote(null);
        setIsQuoting(false);
        return;
      }

      setIsQuoting(true);

      debounceRef.current = setTimeout(async () => {
        try {
          const quotes = await getQuote(
            assets.btc,
            assets.wbtc,
            satoshis.toString(),
            network,
          );
          if (quotes && quotes.length > 0) {
            setQuote(quotes[0]);
          } else {
            setQuote(null);
            setError("No quotes available for this amount");
          }
        } catch (err) {
          setQuote(null);
          setError(err instanceof Error ? err.message : "Failed to fetch quote");
        } finally {
          setIsQuoting(false);
        }
      }, QUOTE_DEBOUNCE_MS);
    },
    [network, assets],
  );

  // ========================================================================
  // Create order → returns BTC deposit address
  // ========================================================================

  const createBridgeOrder = useCallback(
    async (
      btcAddress: string,
      starknetAddress: string,
      amount: bigint,
      receiveAmount: string,
    ): Promise<GardenBridgeResult | null> => {
      setError(null);

      try {
        const gardenOrder = await createBtcToStarknetOrder(
          {
            asset: assets.btc,
            owner: btcAddress,
            amount: amount.toString(),
          },
          {
            asset: assets.wbtc,
            owner: starknetAddress,
            amount: receiveAmount,
          },
          network,
        );

        const result: GardenBridgeResult = {
          success: true,
          outputAmount: BigInt(receiveAmount),
          orderId: gardenOrder.order_id,
          depositAddress: gardenOrder.to,
          depositAmount: gardenOrder.amount,
        };

        setOrder(result);
        setProgress({
          status: "pending",
          confirmations: 0,
          requiredConfirmations: 0,
        });

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create order";
        setError(msg);
        return null;
      }
    },
    [network, assets],
  );

  // ========================================================================
  // Poll order status
  // ========================================================================

  useEffect(() => {
    if (!order?.orderId) return;

    // Start polling
    pollRef.current = setInterval(async () => {
      try {
        const status = await getOrderStatus(order.orderId!, network);

        const src = status.source_swap;
        const dst = status.destination_swap;

        let progressStatus: GardenOrderProgress["status"] = "pending";
        let estimatedTimeRemaining: number | undefined;

        if (dst.refund_tx_hash) {
          progressStatus = "refunded";
        } else if (dst.redeem_tx_hash) {
          progressStatus = "complete";
        } else if (src.redeem_tx_hash || (src.current_confirmations >= src.required_confirmations && src.current_confirmations > 0)) {
          progressStatus = "swapping";
        } else if (src.current_confirmations > 0) {
          progressStatus = "confirming";
          // Rough estimate: ~10 min per BTC block
          const remaining = src.required_confirmations - src.current_confirmations;
          estimatedTimeRemaining = remaining * 600;
        } else if (src.initiate_tx_hash) {
          progressStatus = "btc_sent";
        }

        setProgress({
          status: progressStatus,
          confirmations: src.current_confirmations,
          requiredConfirmations: src.required_confirmations,
          sourceTxHash: src.initiate_tx_hash,
          destinationTxHash: dst.redeem_tx_hash,
          estimatedTimeRemaining,
        });

        // Stop polling on terminal states
        if (progressStatus === "complete" || progressStatus === "refunded") {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        // Silently retry on network errors
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [order?.orderId, network]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ========================================================================
  // Reset
  // ========================================================================

  const reset = useCallback(() => {
    setQuote(null);
    setOrder(null);
    setProgress(null);
    setError(null);
    setIsQuoting(false);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  return {
    available,
    quote,
    order,
    progress,
    isQuoting,
    error,
    fetchQuote,
    createBridgeOrder,
    reset,
  };
}
