/**
 * Dark Pool Oracle Price Hook
 *
 * Wraps Pragma Oracle USD feeds to compute token/token cross rates
 * for dark pool trading pairs. Uses usePragmaPrices() to fetch all
 * feeds, then derives the pair-specific cross rate.
 *
 * Usage:
 *   const { crossRate, isLoading, isError } = useDarkPoolOraclePrice(pair, network);
 */

import { useMemo } from 'react';
import { usePragmaPrices, type PricePairKey } from './usePragmaOracle';
import type { NetworkType } from '../contracts/addresses';
import type { TradingPairInfo } from '../darkpool/darkPoolOrder';
import {
  getPragmaPairsForDarkPoolPair,
  computeCrossRate,
  type CrossRateResult,
} from '../darkpool/darkPoolCrossRate';

export interface DarkPoolOraclePriceResult {
  crossRate: CrossRateResult | null;
  isLoading: boolean;
  isError: boolean;
  feeds: ReturnType<typeof usePragmaPrices>;
}

const ALL_PAIRS: PricePairKey[] = ['ETH_USD', 'STRK_USD', 'BTC_USD', 'USDC_USD', 'SAGE_USD'];

export function useDarkPoolOraclePrice(
  pair: TradingPairInfo,
  network: NetworkType,
): DarkPoolOraclePriceResult {
  const feeds = usePragmaPrices(ALL_PAIRS, network);

  const crossRate = useMemo((): CrossRateResult | null => {
    const pairFeeds = getPragmaPairsForDarkPoolPair(pair);
    if (!pairFeeds) return null;

    const { baseFeed, quoteFeed } = pairFeeds;
    const baseResult = feeds[baseFeed];
    const quoteResult = feeds[quoteFeed];

    if (!baseResult?.data?.price || !quoteResult?.data?.price) return null;

    return computeCrossRate(
      baseResult.data.price,
      quoteResult.data.price,
      baseFeed,
      quoteFeed,
      baseResult.data,
      quoteResult.data,
    );
  }, [pair, feeds]);

  const isLoading = useMemo(() => {
    const pairFeeds = getPragmaPairsForDarkPoolPair(pair);
    if (!pairFeeds) return false;
    return feeds[pairFeeds.baseFeed]?.isLoading || feeds[pairFeeds.quoteFeed]?.isLoading;
  }, [pair, feeds]);

  const isError = useMemo(() => {
    const pairFeeds = getPragmaPairsForDarkPoolPair(pair);
    if (!pairFeeds) return false;
    return feeds[pairFeeds.baseFeed]?.isError || feeds[pairFeeds.quoteFeed]?.isError;
  }, [pair, feeds]);

  return { crossRate, isLoading, isError, feeds };
}
