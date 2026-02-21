"use client";

import { useState, useCallback } from "react";
import {
  BookOpen,
  Info,
  Shield,
  ArrowUpDown,
  Repeat,
  ArrowLeftRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { OrderBook } from "./components/OrderBook";
import { PlaceOrder } from "./components/PlaceOrder";
import { TradeHistory } from "./components/TradeHistory";
import { MyOrders } from "./components/MyOrders";
import { PairSelector } from "./components/PairSelector";
import { MarketStats } from "./components/MarketStats";
import { PrivateAuction } from "./components/PrivateAuction";
import { ShieldedSwapPanel, AvnuSwapPanel } from "@/components/swap";
import { TRADING_PAIRS } from "./config";
import {
  ResponsiveTradingGrid,
} from "@/components/ui/ResponsiveTradingLayout";

type TradeMode = "orderbook" | "swap" | "avnu" | "private";

const TRADE_MODES = [
  {
    id: "orderbook" as const,
    label: "Orderbook",
    icon: BookOpen,
    description: "Peer-to-peer OTC limit orders",
    activeClass: "bg-white/10 text-white shadow-sm",
  },
  {
    id: "avnu" as const,
    label: "Swap",
    icon: ArrowLeftRight,
    description: "Best-price DEX aggregated swaps via AVNU",
    activeClass: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm shadow-emerald-500/10",
  },
  {
    id: "swap" as const,
    label: "Shielded Swap",
    icon: Repeat,
    description: "Privacy-preserving AMM swaps",
    activeClass: "bg-violet-500/15 text-violet-300 border border-violet-500/20 shadow-sm shadow-violet-500/10",
  },
  {
    id: "private" as const,
    label: "Dark Pool",
    icon: Shield,
    description: "Encrypted batch auction — zero MEV",
    activeClass: "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-sm",
  },
] as const;

export default function TradePage() {
  const [mode, setMode] = useState<TradeMode>("orderbook");
  const [selectedPair, setSelectedPair] = useState(TRADING_PAIRS[0]);

  // State for orderbook click -> place order form population
  const [orderFormData, setOrderFormData] = useState<{
    price: string;
    amount: string;
    side: "buy" | "sell";
    timestamp: number;
  } | null>(null);

  const handleOrderClick = useCallback((price: string, amount: string, side: "buy" | "sell") => {
    setOrderFormData({ price, amount, side, timestamp: Date.now() });
  }, []);

  const activeMode = TRADE_MODES.find((m) => m.id === mode)!;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
            <ArrowUpDown className="w-6 h-6 text-brand-400" />
            Trade
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {activeMode.description}
          </p>
        </div>

        {/* Mode Toggle — 3 tabs */}
        <div className="flex items-center bg-surface-elevated rounded-xl p-1 border border-surface-border">
          {TRADE_MODES.map((m) => {
            const Icon = m.icon;
            const isActive = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all",
                  isActive ? m.activeClass : "text-gray-400 hover:text-white"
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden xs:inline">{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content by Mode */}
      <AnimatePresence mode="wait">
        {mode === "orderbook" ? (
          <motion.div
            key="orderbook"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
            {/* Quick Info Banner */}
            <div className="glass-card p-4 bg-gradient-to-r from-brand-600/10 to-emerald-600/10 border-brand-500/30">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-brand-600/20">
                  <BookOpen className="w-5 h-5 text-brand-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-white mb-1">OTC Orderbook</h3>
                  <p className="text-sm text-gray-400">
                    Buy and sell SAGE tokens peer-to-peer. Place limit orders at your desired price
                    or fill existing orders instantly. All trades settle directly to your wallet.
                  </p>
                </div>
              </div>
            </div>

            {/* Pair Selector & Market Stats */}
            <div className="flex flex-col lg:flex-row gap-4">
              <PairSelector
                pairs={TRADING_PAIRS}
                selectedPair={selectedPair}
                onSelectPair={setSelectedPair}
              />
              <MarketStats pairId={selectedPair.id} />
            </div>

            {/* Main Trading Interface - Responsive */}
            <ResponsiveTradingGrid
              orderBook={
                <OrderBook
                  pairId={selectedPair.id}
                  pair={selectedPair}
                  onOrderClick={handleOrderClick}
                />
              }
              placeOrder={
                <PlaceOrder
                  key={orderFormData?.timestamp || 0}
                  pairId={selectedPair.id}
                  pair={selectedPair}
                  initialPrice={orderFormData?.price}
                  initialAmount={orderFormData?.amount}
                  initialSide={orderFormData?.side}
                />
              }
              tradeHistory={<TradeHistory pairId={selectedPair.id} pair={selectedPair} />}
              myOrders={<MyOrders pairId={selectedPair.id} pair={selectedPair} />}
            />

            {/* My Orders - Desktop Only */}
            <div className="hidden lg:block">
              <MyOrders pairId={selectedPair.id} pair={selectedPair} />
            </div>

            {/* How It Works */}
            <div className="glass-card p-4">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-brand-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-300">
                    <strong className="text-white">How it works:</strong> Place a buy order for SAGE at your preferred price,
                    or fill an existing sell order instantly. Orders are matched on-chain and tokens settle directly to your wallet.
                    This is the easiest way to acquire SAGE before exchange listings.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

        ) : mode === "avnu" ? (
          /* ═══════════════════════════════════════════════════════
             AVNU SWAP — DEX aggregated swaps
             ═══════════════════════════════════════════════════════ */
          <motion.div
            key="avnu"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center"
          >
            <div className="w-full max-w-[480px] relative">
              <div className="absolute -inset-8 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-emerald-600/[0.06] rounded-full blur-[100px]" />
                <div className="absolute top-1/3 left-1/4 w-40 h-40 bg-teal-600/[0.04] rounded-full blur-[80px]" />
              </div>

              <div className="relative rounded-3xl border border-white/[0.06] bg-gradient-to-b from-surface-card/95 to-[#0c0e14]/95 backdrop-blur-xl p-6 shadow-2xl shadow-black/40">
                <AvnuSwapPanel />
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="mt-6 max-w-[480px] w-full"
            >
              <div className="glass-card p-4 bg-gradient-to-r from-emerald-600/[0.06] to-teal-600/[0.04]">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-emerald-600/15">
                    <ArrowLeftRight className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-300">
                      <strong className="text-emerald-300">AVNU DEX Aggregator:</strong>{" "}
                      Routes your swap across Ekubo, JediSwap, MySwap, 10kSwap, and market makers
                      with split routing for the best price. Standard swap — your wallet address is visible on-chain.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>

        ) : mode === "swap" ? (
          /* ═══════════════════════════════════════════════════════
             SHIELDED SWAP — centered card layout
             ═══════════════════════════════════════════════════════ */
          <motion.div
            key="swap"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center"
          >
            {/* Centered swap card with ambient glow */}
            <div className="w-full max-w-[480px] relative">
              {/* Background ambient glow */}
              <div className="absolute -inset-8 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-violet-600/[0.06] rounded-full blur-[100px]" />
                <div className="absolute top-1/3 left-1/4 w-40 h-40 bg-fuchsia-600/[0.04] rounded-full blur-[80px]" />
              </div>

              {/* Main card */}
              <div className="relative rounded-3xl border border-white/[0.06] bg-gradient-to-b from-surface-card/95 to-[#0c0e14]/95 backdrop-blur-xl p-6 shadow-2xl shadow-black/40">
                <ShieldedSwapPanel />
              </div>
            </div>

            {/* Info footer */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="mt-6 max-w-[480px] w-full"
            >
              <div className="glass-card p-4 bg-gradient-to-r from-violet-600/[0.06] to-fuchsia-600/[0.04]">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-violet-600/15">
                    <Shield className="w-4 h-4 text-violet-400" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-300">
                      <strong className="text-violet-300">How shielded swaps work:</strong>{" "}
                      Your tokens are withdrawn from a privacy pool, swapped through Ekubo AMM,
                      and deposited into the destination privacy pool — all in one atomic transaction.
                      Only the router contract appears on-chain, keeping your identity hidden.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>

        ) : (
          /* ═══════════════════════════════════════════════════════
             PRIVATE AUCTION (Dark Pool)
             ═══════════════════════════════════════════════════════ */
          <motion.div
            key="private"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            <PrivateAuction />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
