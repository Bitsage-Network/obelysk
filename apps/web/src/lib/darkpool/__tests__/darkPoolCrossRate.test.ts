/**
 * Dark Pool Cross-Rate Utilities — Unit Tests
 *
 * Tests cross-rate computation, deviation analysis, severity classification,
 * formatting, and token-to-Pragma feed mapping.
 */

import { describe, it, expect } from 'vitest';
import {
  tokenToPragmaPair,
  getPragmaPairsForDarkPoolPair,
  computeCrossRate,
  computeDeviation,
  deviationSeverity,
  formatCrossRate,
} from '../darkPoolCrossRate';
import type { TradingPairInfo } from '../darkPoolOrder';

// ============================================================================
// Helpers
// ============================================================================

function makePair(give: string, want: string): TradingPairInfo {
  return {
    giveSymbol: give as TradingPairInfo['giveSymbol'],
    wantSymbol: want as TradingPairInfo['wantSymbol'],
    giveAssetId: '0x0',
    wantAssetId: '0x0',
    label: `${give}/${want}`,
  };
}

// ============================================================================
// tokenToPragmaPair
// ============================================================================

describe('tokenToPragmaPair', () => {
  it('maps ETH → ETH_USD', () => {
    expect(tokenToPragmaPair('ETH')).toBe('ETH_USD');
  });

  it('maps STRK → STRK_USD', () => {
    expect(tokenToPragmaPair('STRK')).toBe('STRK_USD');
  });

  it('maps wBTC → BTC_USD', () => {
    expect(tokenToPragmaPair('wBTC')).toBe('BTC_USD');
  });

  it('maps USDC → USDC_USD', () => {
    expect(tokenToPragmaPair('USDC')).toBe('USDC_USD');
  });

  it('maps SAGE → SAGE_USD', () => {
    expect(tokenToPragmaPair('SAGE')).toBe('SAGE_USD');
  });

  it('returns null for unknown token', () => {
    expect(tokenToPragmaPair('FOO' as any)).toBeNull();
  });
});

// ============================================================================
// getPragmaPairsForDarkPoolPair
// ============================================================================

describe('getPragmaPairsForDarkPoolPair', () => {
  it('returns correct feeds for ETH/STRK', () => {
    const result = getPragmaPairsForDarkPoolPair(makePair('ETH', 'STRK'));
    expect(result).toEqual({ baseFeed: 'ETH_USD', quoteFeed: 'STRK_USD' });
  });

  it('returns correct feeds for wBTC/ETH', () => {
    const result = getPragmaPairsForDarkPoolPair(makePair('wBTC', 'ETH'));
    expect(result).toEqual({ baseFeed: 'BTC_USD', quoteFeed: 'ETH_USD' });
  });

  it('returns null when token is unsupported', () => {
    const result = getPragmaPairsForDarkPoolPair(makePair('FOO' as any, 'ETH'));
    expect(result).toBeNull();
  });
});

// ============================================================================
// computeCrossRate
// ============================================================================

describe('computeCrossRate', () => {
  it('computes ETH/STRK correctly: $2800 / $0.50 = 5600', () => {
    const result = computeCrossRate(2800, 0.5, 'ETH_USD', 'STRK_USD');
    expect(result).not.toBeNull();
    expect(result!.rate).toBeCloseTo(5600, 6);
  });

  it('computes wBTC/ETH correctly: $95000 / $2800 ≈ 33.93', () => {
    const result = computeCrossRate(95000, 2800, 'BTC_USD', 'ETH_USD');
    expect(result).not.toBeNull();
    expect(result!.rate).toBeCloseTo(33.9286, 3);
  });

  it('computes SAGE/STRK for very small rates: $0.001 / $0.50 = 0.002', () => {
    const result = computeCrossRate(0.001, 0.5, 'SAGE_USD', 'STRK_USD');
    expect(result).not.toBeNull();
    expect(result!.rate).toBeCloseTo(0.002, 6);
  });

  it('computes wBTC/STRK for large rates: $95000 / $0.50 = 190000', () => {
    const result = computeCrossRate(95000, 0.5, 'BTC_USD', 'STRK_USD');
    expect(result).not.toBeNull();
    expect(result!.rate).toBeCloseTo(190000, 0);
  });

  it('returns null when base price is zero', () => {
    expect(computeCrossRate(0, 0.5, 'ETH_USD', 'STRK_USD')).toBeNull();
  });

  it('returns null when quote price is zero', () => {
    expect(computeCrossRate(2800, 0, 'ETH_USD', 'STRK_USD')).toBeNull();
  });

  it('returns null for negative prices', () => {
    expect(computeCrossRate(-1, 0.5, 'ETH_USD', 'STRK_USD')).toBeNull();
    expect(computeCrossRate(2800, -1, 'ETH_USD', 'STRK_USD')).toBeNull();
  });

  it('rateBigInt has 18-decimal precision for ETH/STRK', () => {
    const result = computeCrossRate(2800, 0.5, 'ETH_USD', 'STRK_USD');
    expect(result).not.toBeNull();
    // 5600 * 1e18 = 5600000000000000000000
    expect(result!.rateBigInt).toBe(5600_000_000_000_000_000_000n);
  });

  it('rateBigInt has 18-decimal precision for wBTC/STRK ~190000', () => {
    const result = computeCrossRate(95000, 0.5, 'BTC_USD', 'STRK_USD');
    expect(result).not.toBeNull();
    // 190000 * 1e18
    expect(result!.rateBigInt).toBe(190_000_000_000_000_000_000_000n);
  });

  it('rateBigInt has 18-decimal precision for SAGE/STRK ~0.002', () => {
    const result = computeCrossRate(0.001, 0.5, 'SAGE_USD', 'STRK_USD');
    expect(result).not.toBeNull();
    // 0.002 * 1e18 = 2000000000000000
    expect(result!.rateBigInt).toBe(2_000_000_000_000_000n);
  });

  it('unions staleness from both feeds', () => {
    const staleData = {
      price: 2800, priceRaw: 280000000000n, decimals: 8,
      lastUpdated: new Date('2020-01-01'), numSources: 3,
      isStale: true, isCircuitBreakerTripped: false, source: 'pragma' as const,
    };
    const freshData = {
      price: 0.5, priceRaw: 50000000n, decimals: 8,
      lastUpdated: new Date(), numSources: 3,
      isStale: false, isCircuitBreakerTripped: false, source: 'pragma' as const,
    };

    const result = computeCrossRate(2800, 0.5, 'ETH_USD', 'STRK_USD', staleData, freshData);
    expect(result!.isStale).toBe(true);
  });

  it('unions circuit breaker from both feeds', () => {
    const normalData = {
      price: 2800, priceRaw: 280000000000n, decimals: 8,
      lastUpdated: new Date(), numSources: 3,
      isStale: false, isCircuitBreakerTripped: false, source: 'pragma' as const,
    };
    const trippedData = {
      price: 0.5, priceRaw: 50000000n, decimals: 8,
      lastUpdated: new Date(), numSources: 3,
      isStale: false, isCircuitBreakerTripped: true, source: 'pragma' as const,
    };

    const result = computeCrossRate(2800, 0.5, 'ETH_USD', 'STRK_USD', normalData, trippedData);
    expect(result!.isCircuitBreakerTripped).toBe(true);
  });

  it('uses oldest timestamp from both feeds', () => {
    const oldDate = new Date('2024-01-01');
    const newDate = new Date('2026-02-01');
    const oldData = {
      price: 2800, priceRaw: 280000000000n, decimals: 8,
      lastUpdated: oldDate, numSources: 3,
      isStale: false, isCircuitBreakerTripped: false, source: 'pragma' as const,
    };
    const newData = {
      price: 0.5, priceRaw: 50000000n, decimals: 8,
      lastUpdated: newDate, numSources: 3,
      isStale: false, isCircuitBreakerTripped: false, source: 'pragma' as const,
    };

    const result = computeCrossRate(2800, 0.5, 'ETH_USD', 'STRK_USD', oldData, newData);
    expect(result!.lastUpdated).toEqual(oldDate);
  });
});

// ============================================================================
// computeDeviation
// ============================================================================

describe('computeDeviation', () => {
  it('+1% deviation', () => {
    expect(computeDeviation(101, 100)).toBeCloseTo(1, 6);
  });

  it('-1% deviation', () => {
    expect(computeDeviation(99, 100)).toBeCloseTo(-1, 6);
  });

  it('+5% deviation', () => {
    expect(computeDeviation(105, 100)).toBeCloseTo(5, 6);
  });

  it('-5% deviation', () => {
    expect(computeDeviation(95, 100)).toBeCloseTo(-5, 6);
  });

  it('+15% deviation', () => {
    expect(computeDeviation(115, 100)).toBeCloseTo(15, 6);
  });

  it('0% when prices are equal', () => {
    expect(computeDeviation(100, 100)).toBe(0);
  });

  it('returns 0 when oracle rate is 0', () => {
    expect(computeDeviation(100, 0)).toBe(0);
  });

  // H2: NaN/Infinity edge cases
  it('returns 0 when userPrice is NaN', () => {
    expect(computeDeviation(NaN, 100)).toBe(0);
  });

  it('returns 0 when userPrice is Infinity', () => {
    expect(computeDeviation(Infinity, 100)).toBe(0);
  });

  it('returns 0 when userPrice is -Infinity', () => {
    expect(computeDeviation(-Infinity, 100)).toBe(0);
  });

  it('returns 0 when oracleRate is NaN', () => {
    expect(computeDeviation(100, NaN)).toBe(0);
  });

  it('returns 0 when oracleRate is Infinity', () => {
    expect(computeDeviation(100, Infinity)).toBe(0);
  });

  it('returns 0 when both are NaN', () => {
    expect(computeDeviation(NaN, NaN)).toBe(0);
  });
});

// ============================================================================
// computeCrossRate — NaN/Infinity edge cases
// ============================================================================

describe('computeCrossRate — NaN/Infinity', () => {
  it('returns null when base is NaN', () => {
    expect(computeCrossRate(NaN, 0.5, 'ETH_USD', 'STRK_USD')).toBeNull();
  });

  it('returns null when quote is NaN', () => {
    expect(computeCrossRate(2800, NaN, 'ETH_USD', 'STRK_USD')).toBeNull();
  });

  it('returns null when base is Infinity', () => {
    expect(computeCrossRate(Infinity, 0.5, 'ETH_USD', 'STRK_USD')).toBeNull();
  });

  it('returns null when quote is Infinity', () => {
    expect(computeCrossRate(2800, Infinity, 'ETH_USD', 'STRK_USD')).toBeNull();
  });
});

// ============================================================================
// deviationSeverity
// ============================================================================

describe('deviationSeverity', () => {
  it('0% → none', () => {
    expect(deviationSeverity(0)).toBe('none');
  });

  it('1.9% → none', () => {
    expect(deviationSeverity(1.9)).toBe('none');
  });

  it('2.0% → info', () => {
    expect(deviationSeverity(2.0)).toBe('info');
  });

  it('2.1% → info', () => {
    expect(deviationSeverity(2.1)).toBe('info');
  });

  it('4.9% → info', () => {
    expect(deviationSeverity(4.9)).toBe('info');
  });

  it('5.0% → warning', () => {
    expect(deviationSeverity(5.0)).toBe('warning');
  });

  it('9.9% → warning', () => {
    expect(deviationSeverity(9.9)).toBe('warning');
  });

  it('10.0% → danger', () => {
    expect(deviationSeverity(10.0)).toBe('danger');
  });

  it('10.1% → danger', () => {
    expect(deviationSeverity(10.1)).toBe('danger');
  });

  it('50% → danger', () => {
    expect(deviationSeverity(50)).toBe('danger');
  });

  it('negative -1.9% → none', () => {
    expect(deviationSeverity(-1.9)).toBe('none');
  });

  it('negative -5.5% → warning', () => {
    expect(deviationSeverity(-5.5)).toBe('warning');
  });

  it('negative -15% → danger', () => {
    expect(deviationSeverity(-15)).toBe('danger');
  });
});

// ============================================================================
// formatCrossRate
// ============================================================================

describe('formatCrossRate', () => {
  it('USDC pair uses 2dp', () => {
    const result = formatCrossRate(2800.123456, makePair('ETH', 'USDC'));
    // Should contain 2 decimal places — "2,800.12" or "2800.12"
    expect(result).toMatch(/2,?800\.12/);
  });

  it('high value ratio (>100) uses 2dp', () => {
    const result = formatCrossRate(5600.5678, makePair('ETH', 'STRK'));
    expect(result).toMatch(/5,?600\.57/);
  });

  it('medium ratio (1-100) uses 4dp', () => {
    const result = formatCrossRate(33.9286, makePair('wBTC', 'ETH'));
    expect(result).toMatch(/33\.9286/);
  });

  it('low ratio (<1) uses 6dp', () => {
    const result = formatCrossRate(0.002345, makePair('SAGE', 'STRK'));
    expect(result).toMatch(/0\.002345/);
  });
});
