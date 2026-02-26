/**
 * useGardenWithdraw Hook
 *
 * Manages the Starknet → BTC withdrawal flow via Garden Finance:
 * 1. Fetch quote (wBTC → BTC)
 * 2. Create order → approval_transaction + initiate_transaction + typed_data
 * 3. Execute on-chain txs OR sign typed_data for gasless (SNIP-12)
 * 4. Poll until destination_swap.redeem_tx_hash → BTC sent to user
 *
 * The caller must first complete VM31 withdrawal (shielded note → wBTC on Starknet)
 * before invoking this hook's executeWithdraw.
 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAccount } from "@starknet-react/core";
import {
  getQuote,
  createStarknetToBtcOrder,
  getOrderStatus,
  initiateGasless,
  GARDEN_ASSETS,
  isGardenAvailable,
  type GardenNetwork,
  type GardenQuoteResponse,
} from "../btc/gardenApi";
import type { GardenOrderProgress } from "../btc/types";
import {
  deriveStealthAddressForBridge,
} from "../crypto/stealthBridge";
import type { ECPoint } from "../crypto/constants";

const POLL_INTERVAL_MS = 5_000;
const QUOTE_DEBOUNCE_MS = 600;

export function useGardenWithdraw(network: GardenNetwork) {
  const { account } = useAccount();

  const [quote, setQuote] = useState<GardenQuoteResponse | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [progress, setProgress] = useState<GardenOrderProgress | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const available = isGardenAvailable();
  const assets = GARDEN_ASSETS[network];

  // ========================================================================
  // Fetch withdrawal quote (wBTC → BTC)
  // ========================================================================

  const fetchWithdrawQuote = useCallback(
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
            assets.wbtc,
            assets.btc,
            satoshis.toString(),
            network,
          );
          if (quotes && quotes.length > 0) {
            setQuote(quotes[0]);
          } else {
            setQuote(null);
            setError("No withdrawal quotes available");
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
  // Execute withdrawal: create order → approve → initiate (or gasless)
  // ========================================================================

  /**
   * Execute withdrawal. When `spendPK` and `viewPK` are provided,
   * derives a fresh stealth address as the source owner for the
   * Garden order, making the withdrawal unlinkable to the user's
   * main wallet (privacy gap #3).
   */
  const executeWithdraw = useCallback(
    async (
      starknetAddress: string,
      btcAddress: string,
      amount: bigint,
      receiveAmount: string,
      useGaslessMode: boolean,
      spendPK?: ECPoint,
      viewPK?: ECPoint,
    ): Promise<string | null> => {
      if (!account) {
        setError("Wallet not connected");
        return null;
      }

      setIsExecuting(true);
      setError(null);

      try {
        // Derive stealth source address if keys are provided (privacy gap #3)
        let sourceOwner = starknetAddress;
        if (spendPK && viewPK) {
          const stealthData = deriveStealthAddressForBridge(spendPK, viewPK);
          sourceOwner = `0x${stealthData.stealthPublicKey.x.toString(16)}`;
        }

        const order = await createStarknetToBtcOrder(
          {
            asset: assets.wbtc,
            owner: sourceOwner,
            amount: amount.toString(),
          },
          {
            asset: assets.btc,
            owner: btcAddress,
            amount: receiveAmount,
          },
          network,
        );

        if (useGaslessMode && order.typed_data) {
          // Sign SNIP-12 typed data for gasless execution
          const signature = await account.signMessage(order.typed_data as any);
          const sigArray = Array.isArray(signature)
            ? signature.map(String)
            : [String(signature)];
          await initiateGasless(order.order_id, sigArray, network);
        } else {
          // Execute approval + initiate transactions on-chain
          const calls = [];

          if (order.approval_transaction) {
            calls.push({
              contractAddress: order.approval_transaction.to,
              entrypoint: order.approval_transaction.selector,
              calldata: order.approval_transaction.calldata,
            });
          }

          if (order.initiate_transaction) {
            calls.push({
              contractAddress: order.initiate_transaction.to,
              entrypoint: order.initiate_transaction.selector,
              calldata: order.initiate_transaction.calldata,
            });
          }

          if (calls.length > 0) {
            await account.execute(calls);
          }
        }

        setOrderId(order.order_id);
        setProgress({
          status: "swapping",
          confirmations: 0,
          requiredConfirmations: 0,
        });

        return order.order_id;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Withdrawal failed";
        setError(msg);
        return null;
      } finally {
        setIsExecuting(false);
      }
    },
    [account, network, assets],
  );

  // ========================================================================
  // Poll order status
  // ========================================================================

  useEffect(() => {
    if (!orderId) return;

    pollRef.current = setInterval(async () => {
      try {
        const status = await getOrderStatus(orderId, network);

        const src = status.source_swap;
        const dst = status.destination_swap;

        let progressStatus: GardenOrderProgress["status"] = "swapping";

        if (dst.refund_tx_hash) {
          progressStatus = "refunded";
        } else if (dst.redeem_tx_hash) {
          progressStatus = "complete";
        } else if (dst.current_confirmations > 0) {
          progressStatus = "confirming";
        }

        setProgress({
          status: progressStatus,
          confirmations: dst.current_confirmations,
          requiredConfirmations: dst.required_confirmations,
          sourceTxHash: src.initiate_tx_hash,
          destinationTxHash: dst.redeem_tx_hash,
        });

        if (progressStatus === "complete" || progressStatus === "refunded") {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        // Silently retry
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [orderId, network]);

  // Cleanup
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
    setOrderId(null);
    setProgress(null);
    setError(null);
    setIsQuoting(false);
    setIsExecuting(false);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  return {
    available,
    quote,
    orderId,
    progress,
    isQuoting,
    isExecuting,
    error,
    fetchWithdrawQuote,
    executeWithdraw,
    reset,
  };
}
