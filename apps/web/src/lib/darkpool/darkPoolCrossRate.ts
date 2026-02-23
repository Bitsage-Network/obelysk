/**
 * Dark Pool Cross-Rate Utilities
 *
 * Computes token/token cross rates from Pragma Oracle USD feeds.
 * Dark pool pairs are token/token (ETH/STRK, wBTC/ETH, etc.)
 * but Pragma feeds are token/USD, so we derive:
 *   ETH/STRK = ETH_USD / STRK_USD
 *   wBTC/ETH = BTC_USD / ETH_USD
 *
 * All functions are pure (no React) for easy unit testing.
 */

import type { PricePairKey, PragmaPriceData } from '../hooks/usePragmaOracle';
import type { TradingPairInfo } from './darkPoolOrder';
import type { TokenSymbol } from '../contracts/addresses';

// ============================================================================
// Types
// ============================================================================

export interface CrossRateResult {
  rate: number;
  rateBigInt: bigint;        // 18-decimal fixed point
  baseFeed: PricePairKey;
  quoteFeed: PricePairKey;
  isStale: boolean;          // true if either feed is stale
  isCircuitBreakerTripped: boolean; // true if either feed CB is tripped
  basePrice: number;         // USD price of base token
  quotePrice: number;        // USD price of quote token
  lastUpdated: Date;         // oldest of the two feeds
}

export type DeviationSeverity = 'none' | 'info' | 'warning' | 'danger';

// ============================================================================
// Token → Pragma Feed Mapping
// ============================================================================

const TOKEN_TO_PRAGMA: Record<string, PricePairKey> = {
  ETH: 'ETH_USD',
  STRK: 'STRK_USD',
  wBTC: 'BTC_USD',
  USDC: 'USDC_USD',
  SAGE: 'SAGE_USD',
};

/**
 * Map a dark pool token symbol to its Pragma price feed key.
 * Returns null for unsupported tokens.
 */
export function tokenToPragmaPair(symbol: TokenSymbol | string): PricePairKey | null {
  return TOKEN_TO_PRAGMA[symbol] ?? null;
}

/**
 * For a dark pool trading pair, return the two Pragma feeds needed
 * to compute the cross rate.
 */
export function getPragmaPairsForDarkPoolPair(
  pair: TradingPairInfo,
): { baseFeed: PricePairKey; quoteFeed: PricePairKey } | null {
  const baseFeed = tokenToPragmaPair(pair.giveSymbol);
  const quoteFeed = tokenToPragmaPair(pair.wantSymbol);
  if (!baseFeed || !quoteFeed) return null;
  return { baseFeed, quoteFeed };
}

// ============================================================================
// Cross-Rate Computation
// ============================================================================

/**
 * Compute a cross rate from two USD-denominated prices.
 *
 *   cross_rate = base_usd / quote_usd
 *
 * For ETH/STRK with ETH=$2800 and STRK=$0.50 → 5600 STRK per ETH.
 *
 * BigInt conversion uses two-step scaling to stay within MAX_SAFE_INTEGER:
 *   1. scale to 1e9 in Number
 *   2. multiply by 1e9n in BigInt → total 1e18
 */
export function computeCrossRate(
  baseUsd: number,
  quoteUsd: number,
  baseFeed: PricePairKey,
  quoteFeed: PricePairKey,
  baseData?: PragmaPriceData | null,
  quoteData?: PragmaPriceData | null,
): CrossRateResult | null {
  if (!Number.isFinite(baseUsd) || !Number.isFinite(quoteUsd) || baseUsd <= 0 || quoteUsd <= 0) return null;

  const rate = baseUsd / quoteUsd;

  // Two-step BigInt conversion: Number → 1e9 → BigInt × 1e9n = 1e18 precision
  const scaled9 = Math.round(rate * 1e9);
  const rateBigInt = BigInt(scaled9) * 1_000_000_000n;

  // Union staleness and circuit breaker from both feeds
  const isStale = (baseData?.isStale ?? false) || (quoteData?.isStale ?? false);
  const isCircuitBreakerTripped =
    (baseData?.isCircuitBreakerTripped ?? false) ||
    (quoteData?.isCircuitBreakerTripped ?? false);

  // Use the oldest update timestamp
  const baseTime = baseData?.lastUpdated ?? new Date();
  const quoteTime = quoteData?.lastUpdated ?? new Date();
  const lastUpdated = baseTime < quoteTime ? baseTime : quoteTime;

  return {
    rate,
    rateBigInt,
    baseFeed,
    quoteFeed,
    isStale,
    isCircuitBreakerTripped,
    basePrice: baseUsd,
    quotePrice: quoteUsd,
    lastUpdated,
  };
}

// ============================================================================
// Deviation Analysis
// ============================================================================

/**
 * Compute signed percentage deviation of user price from oracle rate.
 * Positive = user price is above oracle, negative = below.
 *
 *   deviation = ((userPrice - oracleRate) / oracleRate) * 100
 */
export function computeDeviation(userPrice: number, oracleRate: number): number {
  if (!Number.isFinite(userPrice)) return 0;
  if (!oracleRate || oracleRate === 0 || !Number.isFinite(oracleRate)) return 0;
  return ((userPrice - oracleRate) / oracleRate) * 100;
}

/**
 * Classify deviation magnitude into severity level.
 *
 *   <2%   → none  (normal)
 *   2-5%  → info  (notable)
 *   5-10% → warning
 *   >10%  → danger
 */
export function deviationSeverity(percent: number): DeviationSeverity {
  const abs = Math.abs(percent);
  if (abs < 2) return 'none';
  if (abs < 5) return 'info';
  if (abs < 10) return 'warning';
  return 'danger';
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format a cross rate with adaptive precision based on magnitude.
 *
 * - Rates involving USDC (≈1:1 with USD): 2 decimal places
 * - High-value ratios (>100, e.g. wBTC/STRK): 2 decimal places
 * - Medium ratios (1-100, e.g. ETH/STRK): 4 decimal places
 * - Low ratios (<1, e.g. SAGE/STRK): 6 decimal places
 */
export function formatCrossRate(rate: number, pair: TradingPairInfo): string {
  // USDC pairs — price is effectively in USD, use 2dp
  if (pair.wantSymbol === 'USDC' || pair.giveSymbol === 'USDC') {
    return rate.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  if (rate >= 100) {
    return rate.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  if (rate >= 1) {
    return rate.toLocaleString(undefined, {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });
  }

  return rate.toLocaleString(undefined, {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  });
}
