"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeftRight,
  Shield,
  BookOpen,
  TrendingUp,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

const tradeTabs = [
  {
    title: "Swap",
    href: "/trade/swap",
    icon: ArrowLeftRight,
    color: "emerald",
    description: "Instant token swaps via DEX aggregator",
  },
  {
    title: "Dark Pool",
    href: "/trade/darkpool",
    icon: Shield,
    color: "cyan",
    description: "Encrypted batch auctions, zero MEV",
  },
  {
    title: "Orderbook",
    href: "/trade/orderbook",
    icon: BookOpen,
    color: "violet",
    description: "Peer-to-peer limit orders",
  },
] as const;

export default function TradeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const activeIndex = tradeTabs.findIndex(
    (tab) => pathname === tab.href || pathname.startsWith(tab.href + "/")
  );

  return (
    <div className="space-y-6">
      {/* Trade Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 border border-cyan-500/20 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              Trade
            </h1>
            <p className="text-xs text-gray-500">
              Swap, auction, or place limit orders
            </p>
          </div>
        </div>
        <Link
          href="/home"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Portfolio
        </Link>
      </div>

      {/* Sub-Tab Navigation */}
      <div className="relative">
        <div className="flex gap-1 p-1 rounded-xl bg-surface-card/60 border border-surface-border backdrop-blur-sm">
          {tradeTabs.map((tab, index) => {
            const isActive = index === activeIndex;

            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "relative flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                  isActive
                    ? "text-white"
                    : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]"
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="trade-tab-bg"
                    className="absolute inset-0 rounded-lg bg-white/[0.08] border border-white/[0.08]"
                    transition={{
                      type: "spring",
                      stiffness: 400,
                      damping: 30,
                    }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  <tab.icon
                    className={cn(
                      "w-4 h-4 transition-colors",
                      isActive ? `text-${tab.color}-400` : ""
                    )}
                  />
                  <span className="hidden sm:inline">{tab.title}</span>
                  <span className="sm:hidden">
                    {tab.title === "Dark Pool" ? "Pool" : tab.title}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>

        {/* Active tab description */}
        {activeIndex >= 0 && (
          <motion.p
            key={activeIndex}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs text-gray-600 mt-2 text-center"
          >
            {tradeTabs[activeIndex].description}
          </motion.p>
        )}
      </div>

      {/* Page Content */}
      {children}
    </div>
  );
}
