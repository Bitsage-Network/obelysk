/**
 * usePrivacyEvents Hook
 *
 * Fetches and polls on-chain privacy events from Obelysk contracts.
 * Wraps the privacyEvents service with React state management and polling.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchPrivacyEvents,
  type PrivacyEvent,
  type PrivacyEventType,
  type FetchEventsResult,
} from "../events/privacyEvents";
import { type NetworkType } from "../contracts/addresses";

// ============================================================================
// Types
// ============================================================================

export interface UsePrivacyEventsOptions {
  network?: NetworkType;
  contractFilter?: string[];
  eventTypes?: PrivacyEventType[];
  userAddress?: string;
  pollInterval?: number; // ms, default 30000
  enabled?: boolean;
  pageSize?: number;
}

export interface UsePrivacyEventsResult {
  events: PrivacyEvent[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  totalFetched: number;
}

// ============================================================================
// Hook
// ============================================================================

export function usePrivacyEvents(
  options: UsePrivacyEventsOptions = {},
): UsePrivacyEventsResult {
  const {
    network = "sepolia",
    contractFilter,
    eventTypes,
    userAddress,
    pollInterval = 30000,
    enabled = true,
    pageSize = 50,
  } = options;

  const [events, setEvents] = useState<PrivacyEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [continuationToken, setContinuationToken] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const fetchEvents = useCallback(
    async (append: boolean = false) => {
      if (!enabled) return;

      setIsLoading(true);
      setError(null);

      try {
        const result: FetchEventsResult = await fetchPrivacyEvents({
          network,
          contractFilter,
          eventTypes,
          chunkSize: pageSize,
          continuationToken: append ? continuationToken : undefined,
        });

        let filteredEvents = result.events;

        // Client-side filter by user address if specified
        if (userAddress) {
          const normalizedUser = userAddress.toLowerCase();
          filteredEvents = filteredEvents.filter((event) => {
            const values = Object.values(event.data);
            return values.some(
              (v) => v && v.toLowerCase() === normalizedUser,
            );
          });
        }

        if (append) {
          setEvents((prev) => [...prev, ...filteredEvents]);
        } else {
          setEvents(filteredEvents);
        }

        setContinuationToken(result.continuationToken);
        setHasMore(result.hasMore);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch privacy events";
        setError(message);
        console.error("[usePrivacyEvents]", message);
      } finally {
        setIsLoading(false);
      }
    },
    [network, contractFilter, eventTypes, userAddress, pageSize, continuationToken, enabled],
  );

  const refetch = useCallback(async () => {
    setContinuationToken(undefined);
    await fetchEvents(false);
  }, [fetchEvents]);

  const loadMore = useCallback(async () => {
    if (hasMore && !isLoading) {
      await fetchEvents(true);
    }
  }, [hasMore, isLoading, fetchEvents]);

  // Initial fetch
  useEffect(() => {
    if (enabled) {
      fetchEvents(false);
    }
  }, [network, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling
  useEffect(() => {
    if (!enabled || pollInterval <= 0) return;

    pollRef.current = setInterval(() => {
      fetchEvents(false);
    }, pollInterval);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [enabled, pollInterval]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    events,
    isLoading,
    error,
    refetch,
    hasMore,
    loadMore,
    totalFetched: events.length,
  };
}
