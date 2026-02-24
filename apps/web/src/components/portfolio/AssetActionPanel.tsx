"use client";

import { useRouter } from "next/navigation";
import { motion, AnimatePresence, PanInfo } from "framer-motion";
import {
  ArrowLeftRight,
  Shield,
  Send,
  ArrowUpDown,
  X,
} from "lucide-react";

const TOKEN_LOGOS: Record<string, string> = {
  ETH: "/tokens/eth.svg",
  STRK: "/tokens/strk.svg",
  USDC: "/tokens/usdc.svg",
  wBTC: "/tokens/btc.svg",
  SAGE: "/tokens/sage.svg",
};

interface AssetActionPanelProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  name: string;
  balance: string;
  usdValue: string;
}

const actions = [
  { label: "Swap", icon: ArrowLeftRight, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", route: (s: string) => `/trade/swap?token=${s}` },
  { label: "Shield", icon: Shield, color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20", route: (s: string) => s === "wBTC" ? "/vault/btc-vault" : `/vault/privacy-pool?asset=${s}` },
  { label: "Send", icon: Send, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", route: (s: string) => `/send?asset=${s}` },
  { label: "Bridge", icon: ArrowUpDown, color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20", route: (s: string) => `/bridge?token=${s}` },
  { label: "Dark Pool", icon: Shield, color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20", route: (s: string) => `/trade/darkpool?pair=${s}_USDC` },
];

export function AssetActionPanel({
  isOpen,
  onClose,
  symbol,
  name,
  balance,
  usdValue,
}: AssetActionPanelProps) {
  const router = useRouter();
  const logo = TOKEN_LOGOS[symbol];

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 100) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          {/* Panel */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
            className="fixed bottom-0 left-0 right-0 rounded-t-3xl bg-surface-card border-t border-surface-border max-h-[80vh] z-50 overflow-hidden"
          >
            {/* Drag Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-gray-600" />
            </div>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Token Info */}
            <div className="px-6 pb-4 flex items-center gap-4">
              {logo ? (
                <img src={logo} alt={symbol} className="w-12 h-12 rounded-full" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-lg font-bold text-white">
                  {symbol.slice(0, 2)}
                </div>
              )}
              <div>
                <div className="text-lg font-bold text-white">{name}</div>
                <div className="flex items-center gap-3">
                  <span className="text-white font-mono">{balance} {symbol}</span>
                  <span className="text-gray-400">${usdValue}</span>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="mx-6 border-t border-surface-border" />

            {/* Action Buttons */}
            <div className="p-6 grid grid-cols-3 gap-3">
              {actions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => {
                    onClose();
                    router.push(action.route(symbol));
                  }}
                  className={`flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all hover:scale-[1.03] active:scale-[0.97] ${action.bg}`}
                >
                  <action.icon className={`w-5 h-5 ${action.color}`} />
                  <span className={`text-xs font-medium ${action.color}`}>{action.label}</span>
                </button>
              ))}
            </div>

            {/* Bottom safe area for mobile */}
            <div className="h-6" />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
