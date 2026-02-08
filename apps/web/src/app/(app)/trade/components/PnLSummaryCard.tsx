"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  Trophy,
  Target,
  BarChart2,
} from "lucide-react";
import type { OrderView } from "@/lib/hooks/useDarkPool";

interface PnLSummaryCardProps {
  orders: OrderView[];
}

interface PnLEntry {
  orderId: bigint;
  side: "buy" | "sell";
  pair: string;
  entryPrice: number;
  clearingPrice: number;
  fillAmount: number;
  pnl: number;
  pnlPercent: number;
}

function parseFormattedNumber(s: string): number {
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

export function PnLSummaryCard({ orders }: PnLSummaryCardProps) {
  const pnlData = useMemo(() => {
    // Only compute P&L for claimed/filled orders with clearing price and fill data
    const entries: PnLEntry[] = [];

    for (const order of orders) {
      if (
        (order.status !== "claimed" && order.status !== "filled") ||
        !order.clearingPrice ||
        !order.fillAmount
      ) {
        continue;
      }

      const entryPrice = parseFormattedNumber(order.price);
      const clearingPrice = parseFormattedNumber(order.clearingPrice);
      const fillAmount = parseFormattedNumber(order.fillAmount);

      if (entryPrice === 0 || clearingPrice === 0 || fillAmount === 0) continue;

      // P&L calculation
      let pnl: number;
      if (order.side === "buy") {
        // Buy: profit when clearing price < entry price (got it cheaper)
        pnl = (entryPrice - clearingPrice) * fillAmount;
      } else {
        // Sell: profit when clearing price > entry price (sold higher)
        pnl = (clearingPrice - entryPrice) * fillAmount;
      }

      const pnlPercent = entryPrice > 0 ? ((pnl / (entryPrice * fillAmount)) * 100) : 0;

      entries.push({
        orderId: order.orderId,
        side: order.side,
        pair: order.pair,
        entryPrice,
        clearingPrice,
        fillAmount,
        pnl,
        pnlPercent,
      });
    }

    return entries;
  }, [orders]);

  const stats = useMemo(() => {
    if (pnlData.length === 0) return null;

    const totalPnl = pnlData.reduce((sum, e) => sum + e.pnl, 0);
    const wins = pnlData.filter((e) => e.pnl > 0).length;
    const losses = pnlData.filter((e) => e.pnl < 0).length;
    const winRate = pnlData.length > 0 ? (wins / pnlData.length) * 100 : 0;
    const avgFillSize = pnlData.reduce((sum, e) => sum + e.fillAmount, 0) / pnlData.length;
    const bestTrade = pnlData.reduce((best, e) => (e.pnl > best.pnl ? e : best), pnlData[0]);
    const worstTrade = pnlData.reduce((worst, e) => (e.pnl < worst.pnl ? e : worst), pnlData[0]);

    return { totalPnl, wins, losses, winRate, avgFillSize, bestTrade, worstTrade };
  }, [pnlData]);

  if (!stats || pnlData.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
          <BarChart2 className="w-3.5 h-3.5 text-violet-400" />
          P&L Summary
        </h4>
        <p className="text-xs text-gray-600 text-center py-4">
          No filled trades yet
        </p>
      </div>
    );
  }

  const isProfitable = stats.totalPnl >= 0;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
          <BarChart2 className="w-3.5 h-3.5 text-violet-400" />
          P&L Summary
          <span className="text-[10px] text-gray-500 font-normal px-2 py-0.5 rounded-full bg-white/5">
            {pnlData.length} trades
          </span>
        </h4>
      </div>

      {/* Total P&L */}
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Total Realized P&L</div>
        <motion.div
          className={cn(
            "text-xl font-bold font-mono",
            isProfitable ? "text-emerald-400" : "text-red-400",
          )}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {isProfitable ? "+" : ""}{stats.totalPnl.toFixed(6)}
          <span className="text-xs text-gray-500 ml-1">tokens</span>
        </motion.div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 divide-x divide-white/[0.04]">
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Target className="w-3 h-3 text-cyan-400" />
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Win Rate</span>
          </div>
          <div className="text-sm font-bold font-mono text-white">
            {stats.winRate.toFixed(0)}%
            <span className="text-[10px] text-gray-500 ml-1">
              ({stats.wins}W / {stats.losses}L)
            </span>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1">
            <BarChart2 className="w-3 h-3 text-amber-400" />
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Avg Fill</span>
          </div>
          <div className="text-sm font-bold font-mono text-white">
            {stats.avgFillSize.toFixed(4)}
          </div>
        </div>
      </div>

      {/* Best / Worst */}
      <div className="border-t border-white/[0.04] divide-y divide-white/[0.03]">
        {stats.bestTrade && stats.bestTrade.pnl > 0 && (
          <div className="px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] text-gray-500">Best</span>
              <span className="text-[10px] text-gray-400 font-mono">{stats.bestTrade.pair}</span>
            </div>
            <span className="text-[10px] font-mono text-emerald-400">
              +{stats.bestTrade.pnl.toFixed(6)}
            </span>
          </div>
        )}
        {stats.worstTrade && stats.worstTrade.pnl < 0 && (
          <div className="px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-3 h-3 text-red-400" />
              <span className="text-[10px] text-gray-500">Worst</span>
              <span className="text-[10px] text-gray-400 font-mono">{stats.worstTrade.pair}</span>
            </div>
            <span className="text-[10px] font-mono text-red-400">
              {stats.worstTrade.pnl.toFixed(6)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
