/**
 * CoinGecko Price Fallback
 *
 * Used when ORACLE_WRAPPER contract is not deployed (address = "0x0").
 * Fetches USD prices from CoinGecko's free /simple/price endpoint.
 *
 * Rate limit: 10-30 req/min on the free tier — we cache for 60s.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price';

// Map our token symbols to CoinGecko IDs
const COINGECKO_IDS: Record<string, string> = {
  ETH: 'ethereum',
  STRK: 'starknet',
  USDC: 'usd-coin',
  wBTC: 'bitcoin',      // wBTC tracks BTC price
  SAGE: '',              // No CoinGecko listing — will return 0
};

const CACHE_TTL_MS = 60_000; // 60 seconds
const FETCH_TIMEOUT_MS = 8_000;

interface PriceCache {
  prices: Record<string, number>;
  fetchedAt: number;
}

let globalCache: PriceCache | null = null;

async function fetchPricesFromCoinGecko(): Promise<Record<string, number>> {
  // Filter out empty IDs (unlisted tokens like SAGE)
  const ids = Object.entries(COINGECKO_IDS)
    .filter(([, id]) => id)
    .map(([, id]) => id);

  const uniqueIds = [...new Set(ids)].join(',');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${COINGECKO_API}?ids=${uniqueIds}&vs_currencies=usd`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();

    // Map CoinGecko response back to our token symbols
    const prices: Record<string, number> = {};
    for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
      if (!geckoId) {
        prices[symbol] = 0;
        continue;
      }
      prices[symbol] = data[geckoId]?.usd ?? 0;
    }

    // USDC is always ~$1 but use CoinGecko value if available
    if (!prices.USDC || prices.USDC === 0) {
      prices.USDC = 1;
    }

    return prices;
  } catch (err) {
    clearTimeout(timeout);
    // On error, return cached values if available, otherwise zeros with USDC=1
    if (globalCache) return globalCache.prices;
    return { ETH: 0, STRK: 0, USDC: 1, wBTC: 0, SAGE: 0 };
  }
}

/**
 * Hook that returns USD prices for portfolio tokens via CoinGecko.
 * Automatically refreshes every 60 seconds.
 */
export function useCoinGeckoPrices(): {
  prices: Record<string, number>;
  isLoading: boolean;
  lastUpdated: Date | null;
} {
  const [prices, setPrices] = useState<Record<string, number>>(
    globalCache?.prices ?? { ETH: 0, STRK: 0, USDC: 1, wBTC: 0, SAGE: 0 }
  );
  const [isLoading, setIsLoading] = useState(!globalCache);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    globalCache ? new Date(globalCache.fetchedAt) : null
  );
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const refresh = useCallback(async () => {
    // Use cache if still fresh
    if (globalCache && Date.now() - globalCache.fetchedAt < CACHE_TTL_MS) {
      setPrices(globalCache.prices);
      setLastUpdated(new Date(globalCache.fetchedAt));
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const result = await fetchPricesFromCoinGecko();
    globalCache = { prices: result, fetchedAt: Date.now() };
    setPrices(result);
    setLastUpdated(new Date());
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(refresh, CACHE_TTL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh]);

  return { prices, isLoading, lastUpdated };
}
