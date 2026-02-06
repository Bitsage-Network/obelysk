"use client";

import { useMemo } from "react";
import {
  Shield,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
  Send,
  UserPlus,
  DollarSign,
  RefreshCw,
  Settings,
  Loader2,
  ExternalLink,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  usePrivacyEvents,
  type UsePrivacyEventsOptions,
} from "@/lib/hooks/usePrivacyEvents";
import {
  getEventLabel,
  getEventExplorerUrl,
  truncateHash,
  type PrivacyEvent,
  type PrivacyEventType,
} from "@/lib/events/privacyEvents";

// ============================================================================
// Event Icon Mapping
// ============================================================================

function getEventIcon(type: PrivacyEventType) {
  switch (type) {
    case "deposit":
    case "funded":
      return { icon: ArrowDownLeft, color: "text-emerald-400", bg: "bg-emerald-400/10" };
    case "withdrawal":
      return { icon: ArrowUpRight, color: "text-amber-400", bg: "bg-amber-400/10" };
    case "shielded_swap":
      return { icon: ArrowLeftRight, color: "text-brand-400", bg: "bg-brand-400/10" };
    case "confidential_transfer":
      return { icon: Send, color: "text-accent-fuchsia", bg: "bg-accent-fuchsia/10" };
    case "account_registered":
      return { icon: UserPlus, color: "text-blue-400", bg: "bg-blue-400/10" };
    case "pool_registered":
      return { icon: Shield, color: "text-cyan-400", bg: "bg-cyan-400/10" };
    case "rollover":
      return { icon: RefreshCw, color: "text-violet-400", bg: "bg-violet-400/10" };
    case "upgrade_scheduled":
    case "upgrade_executed":
      return { icon: Settings, color: "text-orange-400", bg: "bg-orange-400/10" };
    default:
      return { icon: Shield, color: "text-white/40", bg: "bg-white/5" };
  }
}

function getEventDescription(event: PrivacyEvent): string {
  const d = event.data;
  switch (event.type) {
    case "deposit":
      return d.commitment ? `Commitment ${truncateHash(d.commitment, 4)}` : "New deposit";
    case "withdrawal":
      return d.key1 ? `Nullifier ${truncateHash(d.key1, 4)}` : "Withdrawal executed";
    case "shielded_swap":
      return d.swap_id ? `Swap #${parseInt(d.swap_id, 16)}` : "Shielded swap";
    case "confidential_transfer":
      return d.from && d.to
        ? `${truncateHash(d.from, 4)} → ${truncateHash(d.to, 4)}`
        : "Private transfer";
    case "account_registered":
      return d.account ? `${truncateHash(d.account, 4)}` : "New account";
    case "funded":
      return d.account ? `${truncateHash(d.account, 4)}` : "Account funded";
    case "pool_registered":
      return d.token ? `Token ${truncateHash(d.token, 4)}` : "Pool linked";
    case "rollover":
      return d.account ? `${truncateHash(d.account, 4)}` : "Balance rollover";
    case "upgrade_scheduled":
      return "Contract upgrade queued";
    case "upgrade_executed":
      return "Contract upgraded";
    default:
      return "Privacy event";
  }
}

// ============================================================================
// Loading Skeleton
// ============================================================================

function EventSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 animate-pulse">
      <div className="w-8 h-8 rounded-lg bg-white/5" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-24 rounded bg-white/10" />
        <div className="h-2.5 w-40 rounded bg-white/5" />
      </div>
      <div className="h-3 w-16 rounded bg-white/5" />
    </div>
  );
}

// ============================================================================
// Event Row
// ============================================================================

function EventRow({
  event,
  network = "sepolia",
}: {
  event: PrivacyEvent;
  network?: string;
}) {
  const { icon: Icon, color, bg } = getEventIcon(event.type);
  const label = getEventLabel(event.type);
  const description = getEventDescription(event);
  const explorerUrl = getEventExplorerUrl(event.transactionHash, network as "sepolia" | "mainnet");

  return (
    <motion.a
      href={explorerUrl}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="group flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors cursor-pointer border-b border-white/[0.04] last:border-b-0"
    >
      {/* Icon */}
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", bg)}>
        <Icon className={cn("w-4 h-4", color)} />
      </div>

      {/* Label + Description */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white/90">{label}</div>
        <div className="text-xs text-white/40 truncate">{description}</div>
      </div>

      {/* Tx hash + external link */}
      <div className="flex items-center gap-1.5 text-xs text-white/30 group-hover:text-white/50 transition-colors">
        <span className="font-mono">{truncateHash(event.transactionHash, 4)}</span>
        <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </motion.a>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export interface PrivacyActivityFeedProps {
  /** Options passed to usePrivacyEvents */
  options?: UsePrivacyEventsOptions;
  /** Max events to display (default: all) */
  maxItems?: number;
  /** Title shown at top */
  title?: string;
  /** Compact mode (no title/header) */
  compact?: boolean;
  /** Additional className */
  className?: string;
}

export function PrivacyActivityFeed({
  options = {},
  maxItems,
  title = "Privacy Activity",
  compact = false,
  className,
}: PrivacyActivityFeedProps) {
  const { events, isLoading, error, hasMore, loadMore, totalFetched } =
    usePrivacyEvents(options);

  const displayEvents = useMemo(() => {
    return maxItems ? events.slice(0, maxItems) : events;
  }, [events, maxItems]);

  return (
    <div
      className={cn(
        "rounded-xl border border-white/10 bg-white/5 backdrop-blur overflow-hidden",
        className,
      )}
    >
      {/* Header */}
      {!compact && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-brand-400" />
            <span className="text-sm font-medium text-white/80">{title}</span>
          </div>
          {totalFetched > 0 && (
            <span className="text-xs text-white/30">
              {totalFetched} event{totalFetched !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Event List */}
      <div className="max-h-[400px] overflow-y-auto">
        {isLoading && displayEvents.length === 0 ? (
          <div className="divide-y divide-white/[0.04]">
            {Array.from({ length: 5 }).map((_, i) => (
              <EventSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="px-4 py-8 text-center text-sm text-white/30">
            Failed to load events
          </div>
        ) : displayEvents.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Shield className="w-8 h-8 text-white/10 mx-auto mb-2" />
            <p className="text-sm text-white/30">No privacy events yet</p>
            <p className="text-xs text-white/20 mt-1">
              Events will appear here as privacy operations are executed
            </p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {displayEvents.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                network={options.network || "sepolia"}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Load More */}
      {hasMore && !maxItems && (
        <button
          onClick={loadMore}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs text-white/40 hover:text-white/60 border-t border-white/[0.06] transition-colors disabled:opacity-50"
        >
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          Load More
        </button>
      )}
    </div>
  );
}

export default PrivacyActivityFeed;
