"use client";

/**
 * Analytics Data Hook
 *
 * Provides:
 * - Real-time analytics data fetching
 * - Time-range based data filtering
 * - Aggregation and trend calculations
 * - Caching and optimistic updates
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  AnalyticsData,
  JobMetrics,
  ProofMetrics,
  NetworkMetrics,
  EarningsMetrics,
} from "@/components/analytics/AnalyticsDashboard";

// ============================================
// Types
// ============================================

type TimeRange = "1h" | "24h" | "7d" | "30d" | "all";

interface UseAnalyticsOptions {
  timeRange?: TimeRange;
  refreshInterval?: number;
  enabled?: boolean;
}

interface UseAnalyticsResult {
  data: AnalyticsData | null;
  isLoading: boolean;
  error: Error | null;
  timeRange: TimeRange;
  setTimeRange: (range: TimeRange) => void;
  refresh: () => Promise<void>;
  lastUpdated: number | null;
  /** True when API is unavailable and data is empty (not mock) */
  isDataUnavailable: boolean;
}

interface AnalyticsSnapshot {
  timestamp: number;
  jobs: {
    completed: number;
    failed: number;
    pending: number;
  };
  proofs: {
    generated: number;
    verified: number;
    failed: number;
  };
  earnings: number;
  utilization: number;
}

// ============================================
// Time Range Helpers
// ============================================

const TIME_RANGE_MS: Record<TimeRange, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  all: Infinity,
};

const TIME_RANGE_POINTS: Record<TimeRange, number> = {
  "1h": 12,
  "24h": 24,
  "7d": 7,
  "30d": 30,
  all: 60,
};

// ============================================
// Empty Data Structure (no mock data)
// ============================================

/**
 * Returns empty analytics data structure
 * Used when API is unavailable - NO FAKE DATA
 */
function getEmptyAnalyticsData(): AnalyticsData & { isDataUnavailable: boolean } {
  return {
    jobs: {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      pendingJobs: 0,
      avgCompletionTime: 0,
      successRate: 0,
      throughput: 0,
      jobsByType: {},
    },
    proofs: {
      totalProofs: 0,
      verifiedProofs: 0,
      failedProofs: 0,
      avgGenerationTime: 0,
      avgVerificationTime: 0,
      proofsByCircuit: {},
      teeProofs: 0,
      gpuProofs: 0,
      wasmProofs: 0,
    },
    network: {
      activeWorkers: 0,
      totalWorkers: 0,
      totalGPUs: 0,
      activeGPUs: 0,
      networkHashrate: 0,
      avgLatency: 0,
      peakTPS: 0,
      currentTPS: 0,
    },
    earnings: {
      totalEarned: 0,
      periodEarned: 0,
      pendingRewards: 0,
      claimedRewards: 0,
      projectedMonthly: 0,
      earningsBySource: { compute: 0, proofs: 0, staking: 0, governance: 0 },
      roi: 0,
    },
    historical: {
      timestamps: [],
      jobs: [],
      proofs: [],
      earnings: [],
      utilization: [],
    },
    isDataUnavailable: true,
  };
}

async function fetchAnalyticsData(timeRange: TimeRange): Promise<AnalyticsData & { isDataUnavailable?: boolean }> {
  // Try real API - no fallback to fake data
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
    const response = await fetch(`${apiUrl}/api/v1/analytics?range=${timeRange}`, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (response.ok) {
      const data = await response.json();
      return { ...data, isDataUnavailable: false };
    }

    console.warn("[Analytics] API returned non-OK status:", response.status);
  } catch (err) {
    console.warn("[Analytics] API unavailable:", err instanceof Error ? err.message : err);
  }

  // Return empty data with flag indicating data is unavailable
  // UI should show "Analytics unavailable" instead of fake numbers
  return getEmptyAnalyticsData();
}

// ============================================
// Main Hook
// ============================================

export function useAnalytics(options: UseAnalyticsOptions = {}): UseAnalyticsResult {
  const {
    timeRange: initialTimeRange = "24h",
    refreshInterval = 30000,
    enabled = true,
  } = options;

  const [timeRange, setTimeRange] = useState<TimeRange>(initialTimeRange);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isDataUnavailable, setIsDataUnavailable] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;

    try {
      setIsLoading(true);
      const result = await fetchAnalyticsData(timeRange);
      setData(result);
      setIsDataUnavailable(result.isDataUnavailable === true);
      setLastUpdated(Date.now());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch analytics"));
      setIsDataUnavailable(true);
    } finally {
      setIsLoading(false);
    }
  }, [timeRange, enabled]);

  // Fetch on mount and when timeRange changes
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh
  useEffect(() => {
    if (!enabled || refreshInterval <= 0) return;

    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval, enabled]);

  return {
    data,
    isLoading,
    error,
    timeRange,
    setTimeRange,
    refresh,
    lastUpdated,
    isDataUnavailable,
  };
}

// ============================================
// Specialized Hooks
// ============================================

export function useJobAnalytics(timeRange: TimeRange = "24h") {
  const { data, isLoading, error } = useAnalytics({ timeRange });

  return useMemo(
    () => ({
      metrics: data?.jobs ?? null,
      historical: data?.historical
        ? {
            timestamps: data.historical.timestamps,
            values: data.historical.jobs,
          }
        : null,
      isLoading,
      error,
    }),
    [data, isLoading, error]
  );
}

export function useProofAnalytics(timeRange: TimeRange = "24h") {
  const { data, isLoading, error } = useAnalytics({ timeRange });

  return useMemo(
    () => ({
      metrics: data?.proofs ?? null,
      historical: data?.historical
        ? {
            timestamps: data.historical.timestamps,
            values: data.historical.proofs,
          }
        : null,
      isLoading,
      error,
    }),
    [data, isLoading, error]
  );
}

export function useNetworkAnalytics() {
  const { data, isLoading, error, refresh } = useAnalytics({ refreshInterval: 10000 });

  return useMemo(
    () => ({
      metrics: data?.network ?? null,
      utilization: data?.historical?.utilization ?? [],
      isLoading,
      error,
      refresh,
    }),
    [data, isLoading, error, refresh]
  );
}

export function useEarningsAnalytics(timeRange: TimeRange = "30d") {
  const { data, isLoading, error } = useAnalytics({ timeRange });

  return useMemo(
    () => ({
      metrics: data?.earnings ?? null,
      historical: data?.historical
        ? {
            timestamps: data.historical.timestamps,
            values: data.historical.earnings,
          }
        : null,
      isLoading,
      error,
    }),
    [data, isLoading, error]
  );
}

export type { TimeRange, UseAnalyticsOptions, UseAnalyticsResult, AnalyticsSnapshot };
