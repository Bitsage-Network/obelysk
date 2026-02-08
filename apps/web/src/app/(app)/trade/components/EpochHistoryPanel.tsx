"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Clock,
  ChevronDown,
  ChevronRight,
  Loader2,
  BarChart3,
} from "lucide-react";
import { useEpochHistory, type EpochHistoryEntry } from "@/lib/hooks/useEpochHistory";

function EpochRow({ entry }: { entry: EpochHistoryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasPairs = entry.pairs.length > 0;

  return (
    <>
      <tr
        onClick={() => hasPairs && setExpanded(!expanded)}
        className={cn(
          "border-b border-white/[0.03] transition-colors",
          hasPairs ? "cursor-pointer hover:bg-white/[0.02]" : "",
        )}
      >
        <td className="px-4 py-3 text-xs">
          <div className="flex items-center gap-1.5">
            {hasPairs && (
              expanded ? (
                <ChevronDown className="w-3 h-3 text-gray-500" />
              ) : (
                <ChevronRight className="w-3 h-3 text-gray-500" />
              )
            )}
            <span className="font-mono text-gray-400">#{entry.epochId}</span>
          </div>
        </td>
        <td className="px-3 py-3 text-xs text-white font-mono">{entry.clearingPriceFormatted}</td>
        <td className="px-3 py-3 text-xs text-emerald-400 font-mono">{entry.totalBuyFilledFormatted}</td>
        <td className="px-3 py-3 text-xs text-red-400 font-mono">{entry.totalSellFilledFormatted}</td>
        <td className="px-3 py-3 text-xs text-center text-white font-mono">{entry.totalFills}</td>
        <td className="px-4 py-3 text-xs text-gray-500 font-mono">
          {entry.pairs.length > 0 ? `${entry.pairs.length} pair${entry.pairs.length > 1 ? "s" : ""}` : "-"}
        </td>
      </tr>

      {/* Expanded per-pair breakdown */}
      <AnimatePresence>
        {expanded && entry.pairs.length > 0 && (
          <motion.tr
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <td colSpan={6} className="px-4 py-0">
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: "auto" }}
                exit={{ height: 0 }}
                className="overflow-hidden"
              >
                <div className="py-2 pl-6 space-y-1.5">
                  {entry.pairs.map((pair) => (
                    <div
                      key={pair.pairLabel}
                      className="flex items-center gap-4 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                    >
                      <span className="text-[10px] text-cyan-400 font-semibold w-20 flex-shrink-0">
                        {pair.pairLabel}
                      </span>
                      <div className="flex items-center gap-3 text-[10px] font-mono">
                        <span className="text-gray-500">CP:</span>
                        <span className="text-white">{pair.clearingPriceFormatted}</span>
                        <span className="text-gray-600">|</span>
                        <span className="text-gray-500">Buy:</span>
                        <span className="text-emerald-400">{pair.totalBuyFilledFormatted}</span>
                        <span className="text-gray-600">|</span>
                        <span className="text-gray-500">Sell:</span>
                        <span className="text-red-400">{pair.totalSellFilledFormatted}</span>
                        <span className="text-gray-600">|</span>
                        <span className="text-gray-500">Fills:</span>
                        <span className="text-white">{pair.numFills}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </td>
          </motion.tr>
        )}
      </AnimatePresence>
    </>
  );
}

export function EpochHistoryPanel() {
  const { epochs, isLoading, refresh } = useEpochHistory(10);

  if (isLoading && epochs.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="flex items-center gap-2 text-gray-500 text-xs">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading epoch history...
        </div>
      </div>
    );
  }

  if (epochs.length === 0) return null;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-violet-400" />
          Epoch History
          <span className="text-[10px] text-gray-500 font-normal px-2 py-0.5 rounded-full bg-white/5">
            {epochs.length} settled
          </span>
        </h3>
        <button
          onClick={refresh}
          className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors"
          title="Refresh history"
        >
          <Clock className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] text-gray-500 border-b border-white/[0.04] uppercase tracking-wider">
              <th className="px-4 py-2.5 text-left font-medium">Epoch</th>
              <th className="px-3 py-2.5 text-left font-medium">Clearing Price</th>
              <th className="px-3 py-2.5 text-left font-medium">Buy Vol</th>
              <th className="px-3 py-2.5 text-left font-medium">Sell Vol</th>
              <th className="px-3 py-2.5 text-center font-medium">Fills</th>
              <th className="px-4 py-2.5 text-left font-medium">Pairs</th>
            </tr>
          </thead>
          <tbody>
            {epochs.map((entry) => (
              <EpochRow key={entry.epochId} entry={entry} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
