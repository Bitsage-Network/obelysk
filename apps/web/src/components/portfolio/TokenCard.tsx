"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

// Token logo mapping (emoji fallback since the Asset.icon field is empty string)
const TOKEN_LOGOS: Record<string, string> = {
  ETH: "/tokens/eth.svg",
  STRK: "/tokens/strk.svg",
  USDC: "/tokens/usdc.svg",
  wBTC: "/tokens/btc.svg",
  SAGE: "/tokens/sage.svg",
};

const TOKEN_COLORS: Record<string, string> = {
  ETH: "from-blue-500/20 to-indigo-500/20 border-blue-500/20",
  STRK: "from-orange-500/20 to-red-500/20 border-orange-500/20",
  USDC: "from-blue-400/20 to-sky-500/20 border-blue-400/20",
  wBTC: "from-orange-500/20 to-amber-500/20 border-orange-500/20",
  SAGE: "from-violet-500/20 to-purple-500/20 border-violet-500/20",
};

interface TokenCardProps {
  symbol: string;
  name: string;
  balance: string;
  usdValue: string;
  priceChange?: number;
  onTap: () => void;
  index?: number;
}

export function TokenCard({
  symbol,
  name,
  balance,
  usdValue,
  priceChange,
  onTap,
  index = 0,
}: TokenCardProps) {
  const colors = TOKEN_COLORS[symbol] || "from-gray-500/20 to-gray-600/20 border-gray-500/20";
  const logo = TOKEN_LOGOS[symbol];

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      onClick={onTap}
      className={cn(
        "w-full text-left p-4 rounded-2xl border bg-gradient-to-br transition-all duration-200",
        "hover:scale-[1.02] hover:shadow-lg hover:shadow-black/20 active:scale-[0.98]",
        colors
      )}
    >
      <div className="flex items-center gap-3 mb-3">
        {logo ? (
          <Image src={logo} alt={symbol} width={32} height={32} className="rounded-full" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white">
            {symbol.slice(0, 2)}
          </div>
        )}
        <div>
          <div className="font-semibold text-white text-sm">{symbol}</div>
          <div className="text-[11px] text-gray-500">{name}</div>
        </div>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-lg font-bold text-white font-mono">{balance}</div>
          <div className="text-xs text-gray-400">${usdValue}</div>
        </div>
        {priceChange !== undefined && priceChange !== 0 && (
          <div className={cn(
            "text-xs font-medium px-2 py-0.5 rounded-lg",
            priceChange > 0
              ? "text-emerald-400 bg-emerald-500/10"
              : "text-red-400 bg-red-500/10"
          )}>
            {priceChange > 0 ? "+" : ""}{priceChange.toFixed(1)}%
          </div>
        )}
      </div>
    </motion.button>
  );
}
