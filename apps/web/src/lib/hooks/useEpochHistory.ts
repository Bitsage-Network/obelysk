"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useNetwork } from "@/lib/contexts/NetworkContext";
import type { NetworkType } from "@/lib/contracts/addresses";
import {
  readEpochFromContract,
  readEpochResult,
  readEpochPairResult,
  DARK_POOL_PAIRS,
  formatPrice,
  formatAmount,
  type ContractEpochResult,
} from "@/lib/darkpool/darkPoolOrder";

// ============================================================================
// Types
// ============================================================================

export interface EpochPairResult {
  giveAsset: string;
  wantAsset: string;
  pairLabel: string;
  clearingPrice: bigint;
  clearingPriceFormatted: string;
  totalBuyFilled: bigint;
  totalBuyFilledFormatted: string;
  totalSellFilled: bigint;
  totalSellFilledFormatted: string;
  numFills: number;
}

export interface EpochHistoryEntry {
  epochId: number;
  settledAt: number;
  pairs: EpochPairResult[];
  totalFills: number;
  clearingPriceFormatted: string;
  totalBuyFilledFormatted: string;
  totalSellFilledFormatted: string;
}

// ============================================================================
// Hook
// ============================================================================

export function useEpochHistory(limit: number = 10): {
  epochs: EpochHistoryEntry[];
  isLoading: boolean;
  isError: boolean;
  refresh: () => Promise<void>;
} {
  const { network } = useNetwork();
  const [epochs, setEpochs] = useState<EpochHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // D10: Track fetch errors so UI can show failure state + retry
  const [isError, setIsError] = useState(false);

  // Cache settled results — they never change
  const cacheRef = useRef<Map<number, EpochHistoryEntry>>(new Map());

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    setIsError(false);
    try {
      const epochInfo = await readEpochFromContract(network as NetworkType);
      if (!epochInfo || epochInfo.epoch <= 0) {
        setEpochs([]);
        return;
      }

      const currentEpoch = epochInfo.epoch;
      const results: EpochHistoryEntry[] = [];

      // Iterate backwards from most recent settled epoch
      for (let eid = currentEpoch - 1; eid >= Math.max(0, currentEpoch - limit); eid--) {
        // Check cache first
        const cached = cacheRef.current.get(eid);
        if (cached) {
          results.push(cached);
          continue;
        }

        const result = await readEpochResult(network as NetworkType, eid);
        if (!result || result.settledAt === 0) continue;

        // Fetch per-pair results for each known trading pair
        const pairResults: EpochPairResult[] = [];
        for (const pair of DARK_POOL_PAIRS) {
          const pairResult = await readEpochPairResult(
            network as NetworkType,
            eid,
            pair.giveAssetId,
            pair.wantAssetId,
          );
          if (pairResult && pairResult.numFills > 0) {
            pairResults.push({
              giveAsset: pair.giveAssetId,
              wantAsset: pair.wantAssetId,
              pairLabel: pair.label,
              clearingPrice: pairResult.clearingPrice,
              clearingPriceFormatted: formatPrice(pairResult.clearingPrice),
              totalBuyFilled: pairResult.totalBuyFilled,
              totalBuyFilledFormatted: formatAmount(pairResult.totalBuyFilled),
              totalSellFilled: pairResult.totalSellFilled,
              totalSellFilledFormatted: formatAmount(pairResult.totalSellFilled),
              numFills: pairResult.numFills,
            });
          }
        }

        const entry: EpochHistoryEntry = {
          epochId: eid,
          settledAt: result.settledAt,
          pairs: pairResults,
          totalFills: result.numFills,
          clearingPriceFormatted: formatPrice(result.clearingPrice),
          totalBuyFilledFormatted: formatAmount(result.totalBuyFilled),
          totalSellFilledFormatted: formatAmount(result.totalSellFilled),
        };

        cacheRef.current.set(eid, entry);
        results.push(entry);
      }

      setEpochs(results);
    } catch (err) {
      console.warn("[EpochHistory] Failed to fetch:", err);
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  }, [network, limit]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return { epochs, isLoading, isError, refresh: fetchHistory };
}
