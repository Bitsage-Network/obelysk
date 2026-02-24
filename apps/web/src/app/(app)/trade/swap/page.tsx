"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeftRight, Shield, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ShieldedSwapPanel, AvnuSwapPanel } from "@/components/swap";

type SwapMode = "standard" | "shielded";

export default function SwapPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-gray-500 animate-spin" /></div>}>
      <SwapPageInner />
    </Suspense>
  );
}

function SwapPageInner() {
  const searchParams = useSearchParams();
  const initialMode = searchParams.get("mode") === "shielded" ? "shielded" : "standard";
  const initialToken = searchParams.get("token") || undefined;
  const [mode, setMode] = useState<SwapMode>(initialMode);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center justify-center gap-2">
          <ArrowLeftRight className="w-6 h-6 text-emerald-400" />
          Swap
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {mode === "standard"
            ? "Best-price DEX aggregated swaps via AVNU"
            : "Privacy-preserving swaps — only the router appears on-chain"}
        </p>
      </div>

      {/* Mode Toggle */}
      <div className="flex justify-center">
        <div className="flex items-center bg-surface-elevated rounded-xl p-1 border border-surface-border">
          <button
            onClick={() => setMode("standard")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              mode === "standard"
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm"
                : "text-gray-400 hover:text-white"
            )}
          >
            <ArrowLeftRight className="w-4 h-4" />
            Standard
          </button>
          <button
            onClick={() => setMode("shielded")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              mode === "shielded"
                ? "bg-violet-500/15 text-violet-300 border border-violet-500/20 shadow-sm"
                : "text-gray-400 hover:text-white"
            )}
          >
            <Shield className="w-4 h-4" />
            Shielded
          </button>
        </div>
      </div>

      {/* Swap Panel */}
      <motion.div
        key={mode}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex flex-col items-center"
      >
        <div className="w-full max-w-[480px] relative">
          <div className="absolute -inset-8 pointer-events-none">
            <div className={cn(
              "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full blur-[100px]",
              mode === "standard" ? "bg-emerald-600/[0.06]" : "bg-violet-600/[0.06]"
            )} />
          </div>
          <div className="relative rounded-3xl border border-white/[0.06] bg-gradient-to-b from-surface-card/95 to-[#0c0e14]/95 backdrop-blur-xl p-6 shadow-2xl shadow-black/40">
            {mode === "standard" ? <AvnuSwapPanel initialSellToken={initialToken} /> : <ShieldedSwapPanel initialInputToken={initialToken} />}
          </div>
        </div>

        {/* Info Footer */}
        <div className="mt-6 max-w-[480px] w-full">
          <div className={cn(
            "glass-card p-4 bg-gradient-to-r",
            mode === "standard"
              ? "from-emerald-600/[0.06] to-teal-600/[0.04]"
              : "from-violet-600/[0.06] to-fuchsia-600/[0.04]"
          )}>
            <div className="flex items-start gap-3">
              <div className={cn(
                "p-2 rounded-lg",
                mode === "standard" ? "bg-emerald-600/15" : "bg-violet-600/15"
              )}>
                {mode === "standard" ? (
                  <ArrowLeftRight className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Shield className="w-4 h-4 text-violet-400" />
                )}
              </div>
              <p className="text-sm text-gray-300">
                {mode === "standard" ? (
                  <>
                    <strong className="text-emerald-300">AVNU DEX Aggregator:</strong>{" "}
                    Routes your swap across Ekubo, JediSwap, MySwap, 10kSwap, and market makers
                    with split routing for the best price.
                  </>
                ) : (
                  <>
                    <strong className="text-violet-300">Shielded Swap:</strong>{" "}
                    Your tokens are withdrawn from a privacy pool, swapped through Ekubo AMM,
                    and deposited into the destination privacy pool — all in one atomic transaction.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
