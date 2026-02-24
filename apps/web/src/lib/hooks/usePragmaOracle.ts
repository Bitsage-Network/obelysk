/**
 * Pragma Oracle Integration - Production Price Feeds
 *
 * Direct integration with the ORACLE_WRAPPER contract which connects
 * to Pragma Oracle for real-time, on-chain price data.
 *
 * Supported pairs: SAGE/USD, ETH/USD, STRK/USD, BTC/USD, USDC/USD
 */

import { useMemo } from 'react';
import { useReadContract } from '@starknet-react/core';
import { getContractAddresses, NetworkType } from '../contracts';
import OracleWrapperABI from '../contracts/abis/OracleWrapper.json';
import { Abi, CairoCustomEnum } from 'starknet';

// Price pairs as Cairo enum variants using CairoCustomEnum
// Matches: enum PricePair { SAGE_USD, USDC_USD, ETH_USD, STRK_USD, BTC_USD }
// NOTE: starknet.js v6 requires CairoCustomEnum instances (not plain objects)
// for proper serialization via CallData.compile. Plain { variant: {...} } objects
// fail validation and produce empty calldata, causing RPC calls to hang.
export const PRICE_PAIR_VARIANTS: Record<string, CairoCustomEnum> = {
  SAGE_USD: new CairoCustomEnum({ SAGE_USD: {}, USDC_USD: undefined, ETH_USD: undefined, STRK_USD: undefined, BTC_USD: undefined }),
  USDC_USD: new CairoCustomEnum({ SAGE_USD: undefined, USDC_USD: {}, ETH_USD: undefined, STRK_USD: undefined, BTC_USD: undefined }),
  ETH_USD: new CairoCustomEnum({ SAGE_USD: undefined, USDC_USD: undefined, ETH_USD: {}, STRK_USD: undefined, BTC_USD: undefined }),
  STRK_USD: new CairoCustomEnum({ SAGE_USD: undefined, USDC_USD: undefined, ETH_USD: undefined, STRK_USD: {}, BTC_USD: undefined }),
  BTC_USD: new CairoCustomEnum({ SAGE_USD: undefined, USDC_USD: undefined, ETH_USD: undefined, STRK_USD: undefined, BTC_USD: {} }),
};

export type PricePairKey = keyof typeof PRICE_PAIR_VARIANTS;

export interface PragmaPriceData {
  price: number;
  priceRaw: bigint;
  decimals: number;
  lastUpdated: Date;
  numSources: number;
  isStale: boolean;
  isCircuitBreakerTripped: boolean;
  source: 'pragma';
}

export interface PragmaOracleResult {
  data: PragmaPriceData | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook for fetching price from Pragma Oracle via ORACLE_WRAPPER contract
 */
export function usePragmaPrice(
  pair: PricePairKey,
  network: NetworkType = 'sepolia'
): PragmaOracleResult {
  const addresses = getContractAddresses(network);
  const oracleAddress = addresses?.ORACLE_WRAPPER || '0x0';

  // Query get_price function which returns PragmaPrice struct
  const { data, isLoading, isError, error, refetch } = useReadContract({
    address: oracleAddress as `0x${string}`,
    abi: OracleWrapperABI as Abi,
    functionName: 'get_price',
    args: [PRICE_PAIR_VARIANTS[pair]],
    watch: true,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Check circuit breaker status
  const { data: cbData } = useReadContract({
    address: oracleAddress as `0x${string}`,
    abi: OracleWrapperABI as Abi,
    functionName: 'is_circuit_breaker_tripped',
    args: [],
    watch: true,
  });

  const priceData = useMemo((): PragmaPriceData | null => {
    if (!data) {
      return null;
    }

    // starknet-react's useReadContract returns the parsed struct from starknet.js Contract.call()
    // For PragmaPrice struct, this is an object: { price, decimals, last_updated, num_sources }
    // Handle both struct (object) and legacy array formats for robustness
    let priceRaw: unknown;
    let decimalsRaw: unknown;
    let lastUpdatedRaw: unknown;
    let numSourcesRaw: unknown;

    if (Array.isArray(data) && data.length >= 4) {
      [priceRaw, decimalsRaw, lastUpdatedRaw, numSourcesRaw] = data;
    } else if (typeof data === 'object' && data !== null && 'price' in data) {
      const d = data as { price: unknown; decimals: unknown; last_updated: unknown; num_sources: unknown };
      priceRaw = d.price;
      decimalsRaw = d.decimals;
      lastUpdatedRaw = d.last_updated;
      numSourcesRaw = d.num_sources;
    } else {
      return null;
    }

    // Parse values (H1: guard against NaN/Infinity from malformed contract responses)
    const price = Number(priceRaw);
    const decimals = Number(decimalsRaw);
    const lastUpdatedTimestamp = Number(lastUpdatedRaw);
    const numSources = Number(numSourcesRaw);

    if (!Number.isFinite(price) || !Number.isFinite(decimals)) return null;
    if (decimals < 0 || decimals > 30) return null; // Guard against absurd decimals causing Infinity
    if (!Number.isFinite(lastUpdatedTimestamp) || !Number.isFinite(numSources)) return null;

    // Convert price to human-readable (typically 8 decimals from Pragma)
    const priceHuman = price / Math.pow(10, decimals);

    if (!Number.isFinite(priceHuman)) return null;

    // Check if price is stale (older than 1 hour)
    const now = Math.floor(Date.now() / 1000);
    const isStale = (now - lastUpdatedTimestamp) > 3600;

    const isCircuitBreakerTripped = cbData === true;

    return {
      price: priceHuman,
      priceRaw: BigInt(price),
      decimals,
      lastUpdated: new Date(lastUpdatedTimestamp * 1000),
      numSources,
      isStale,
      isCircuitBreakerTripped,
      source: 'pragma',
    };
  }, [data, cbData]);

  return {
    data: priceData,
    isLoading,
    isError,
    error: error as Error | null,
    refetch,
  };
}

/**
 * Hook for fetching SAGE price in USD from Pragma Oracle
 * Uses the dedicated get_sage_price function for optimized access
 */
export function usePragmaSagePrice(network: NetworkType = 'sepolia'): PragmaOracleResult {
  const addresses = getContractAddresses(network);
  const oracleAddress = addresses?.ORACLE_WRAPPER || '0x0';

  // Use dedicated get_sage_price function
  const { data, isLoading, isError, error, refetch } = useReadContract({
    address: oracleAddress as `0x${string}`,
    abi: OracleWrapperABI as Abi,
    functionName: 'get_sage_price',
    args: [],
    watch: true,
    refetchInterval: 30000,
  });

  // Also get full price data for metadata
  const fullPriceQuery = usePragmaPrice('SAGE_USD', network);

  const priceData = useMemo((): PragmaPriceData | null => {
    if (!data) {
      return null;
    }

    // get_sage_price returns u256 in 18 decimals (USD_DECIMALS)
    const priceU256 = BigInt(data.toString());
    const priceHuman = Number(priceU256) / 1e18;

    // Use metadata from full price query if available
    if (fullPriceQuery.data) {
      return {
        ...fullPriceQuery.data,
        price: priceHuman,
        priceRaw: priceU256,
        decimals: 18,
      };
    }

    return {
      price: priceHuman,
      priceRaw: priceU256,
      decimals: 18,
      lastUpdated: new Date(),
      numSources: 0,
      isStale: false,
      isCircuitBreakerTripped: false,
      source: 'pragma',
    };
  }, [data, fullPriceQuery.data]);

  return {
    data: priceData,
    isLoading: isLoading || fullPriceQuery.isLoading,
    isError,
    error: error as Error | null,
    refetch,
  };
}

/**
 * Hook for fetching multiple prices at once
 */
export function usePragmaPrices(
  pairs: PricePairKey[],
  network: NetworkType = 'sepolia'
): Record<PricePairKey, PragmaOracleResult> {
  // Individual hooks for each pair
  const sageResult = usePragmaPrice('SAGE_USD', network);
  const ethResult = usePragmaPrice('ETH_USD', network);
  const strkResult = usePragmaPrice('STRK_USD', network);
  const btcResult = usePragmaPrice('BTC_USD', network);
  const usdcResult = usePragmaPrice('USDC_USD', network);

  return useMemo(() => ({
    SAGE_USD: sageResult,
    ETH_USD: ethResult,
    STRK_USD: strkResult,
    BTC_USD: btcResult,
    USDC_USD: usdcResult,
  }), [sageResult, ethResult, strkResult, btcResult, usdcResult]);
}

/**
 * Hook for Oracle configuration and health status
 */
export function usePragmaOracleHealth(network: NetworkType = 'sepolia') {
  const addresses = getContractAddresses(network);
  const oracleAddress = addresses?.ORACLE_WRAPPER || '0x0';

  const { data: configData, isLoading: configLoading } = useReadContract({
    address: oracleAddress as `0x${string}`,
    abi: OracleWrapperABI as Abi,
    functionName: 'get_config',
    args: [],
  });

  const { data: cbConfigData, isLoading: cbLoading } = useReadContract({
    address: oracleAddress as `0x${string}`,
    abi: OracleWrapperABI as Abi,
    functionName: 'get_circuit_breaker_config',
    args: [],
  });

  const { data: cbTripped } = useReadContract({
    address: oracleAddress as `0x${string}`,
    abi: OracleWrapperABI as Abi,
    functionName: 'is_circuit_breaker_tripped',
    args: [],
  });

  return useMemo(() => {
    const config = configData && Array.isArray(configData) ? {
      pragmaAddress: configData[0]?.toString() || '',
      maxPriceAge: Number(configData[1] || 0),
      minSources: Number(configData[2] || 0),
      useFallback: configData[3] === true,
    } : null;

    const circuitBreaker = cbConfigData && Array.isArray(cbConfigData) ? {
      maxDeviationBps: Number(cbConfigData[0] || 0),
      deviationWindow: Number(cbConfigData[1] || 0),
      enabled: cbConfigData[2] === true,
      tripped: cbConfigData[3] === true,
      trippedAt: Number(cbConfigData[4] || 0),
    } : null;

    return {
      config,
      circuitBreaker,
      isTripped: cbTripped === true,
      isLoading: configLoading || cbLoading,
      isHealthy: config !== null && !cbTripped,
    };
  }, [configData, cbConfigData, cbTripped, configLoading, cbLoading]);
}

/**
 * Utility: Convert price pair key to display name
 */
export function getPairDisplayName(pair: PricePairKey): string {
  const names: Record<PricePairKey, string> = {
    SAGE_USD: 'SAGE/USD',
    ETH_USD: 'ETH/USD',
    STRK_USD: 'STRK/USD',
    BTC_USD: 'BTC/USD',
    USDC_USD: 'USDC/USD',
  };
  return names[pair];
}

/**
 * Utility: Format price with appropriate decimals
 */
export function formatPragmaPrice(price: number, pair: PricePairKey): string {
  if (pair === 'BTC_USD' || pair === 'ETH_USD') {
    return price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return price.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}
