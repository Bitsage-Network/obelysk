"use client";

import { useState, useCallback } from "react";
import {
  BookOpen,
  Info,
  Coins,
  Shield,
  Lock,
  ArrowUpDown,
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
import { TRADING_PAIRS } from "./config";
import {
  ResponsiveTradingGrid,
} from "@/components/ui/ResponsiveTradingLayout";

type TradeMode = "orderbook" | "private";

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
            {mode === "orderbook"
              ? "Trade tokens peer-to-peer via the OTC orderbook"
              : "Encrypted batch auction — zero front-running, zero MEV"}
          </p>
        </div>

        {/* Mode Toggle */}
        <div className="flex items-center bg-surface-elevated rounded-xl p-1 border border-surface-border">
          <button
            onClick={() => setMode("orderbook")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              mode === "orderbook"
                ? "bg-white/10 text-white shadow-sm"
                : "text-gray-400 hover:text-white"
            )}
          >
            <BookOpen className="w-4 h-4" />
            Orderbook
          </button>
          <button
            onClick={() => setMode("private")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              mode === "private"
                ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-sm"
                : "text-gray-400 hover:text-white"
            )}
          >
            <Shield className="w-4 h-4" />
            Private Auction
          </button>
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
        ) : (
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
