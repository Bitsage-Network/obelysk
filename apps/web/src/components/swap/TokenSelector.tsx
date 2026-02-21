"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOKEN_METADATA } from "@/lib/contracts/addresses";
import { TokenIcon } from "./TokenIcon";

export interface TokenOption {
  symbol: string;
  address: string;
  hasPool: boolean;
}

export function TokenSelector({
  selected,
  tokens,
  onSelect,
  disabled,
  label,
  exclude,
}: {
  selected: TokenOption | null;
  tokens: TokenOption[];
  onSelect: (token: TokenOption) => void;
  disabled?: boolean;
  label: string;
  exclude?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filteredTokens = tokens.filter((t) => t.symbol !== exclude);

  return (
    <div ref={ref} className="relative">
      <motion.button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        whileTap={{ scale: 0.97 }}
        className={cn(
          "flex items-center gap-2.5 pl-2 pr-3 py-2 rounded-xl border transition-all min-w-[140px]",
          open
            ? "border-violet-500/40 bg-violet-500/10 shadow-[0_0_20px_rgba(139,92,246,0.1)]"
            : "border-white/[0.08] bg-white/[0.04] hover:border-white/[0.15] hover:bg-white/[0.06]",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        {selected ? (
          <>
            <TokenIcon symbol={selected.symbol} size="sm" />
            <span className="text-sm font-semibold text-white tracking-wide">{selected.symbol}</span>
          </>
        ) : (
          <span className="text-sm text-gray-500 pl-1">{label}</span>
        )}
        <ChevronDown className={cn(
          "w-3.5 h-3.5 text-gray-500 ml-auto transition-transform duration-200",
          open && "rotate-180"
        )} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute z-50 top-full mt-2 left-0 w-52 rounded-xl border border-white/[0.08] bg-[#0c0e14]/98 backdrop-blur-2xl shadow-2xl shadow-black/60 overflow-hidden"
          >
            <div className="p-1.5 space-y-0.5">
              {filteredTokens.map((token) => {
                const meta = TOKEN_METADATA[token.symbol as keyof typeof TOKEN_METADATA];
                const isSelected = selected?.symbol === token.symbol;
                return (
                  <button
                    key={token.symbol}
                    onClick={() => { if (token.hasPool) { onSelect(token); setOpen(false); } }}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all",
                      isSelected
                        ? "bg-violet-500/10 ring-1 ring-violet-500/20"
                        : token.hasPool
                        ? "hover:bg-white/[0.04]"
                        : "opacity-30 cursor-not-allowed"
                    )}
                    disabled={!token.hasPool}
                  >
                    <TokenIcon symbol={token.symbol} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">{token.symbol}</p>
                      <p className="text-[10px] text-gray-500 truncate">{meta?.name || token.symbol}</p>
                    </div>
                    {!token.hasPool && (
                      <span className="text-[9px] text-gray-600 bg-white/[0.04] px-1.5 py-0.5 rounded-md">
                        No Pool
                      </span>
                    )}
                    {isSelected && (
                      <CheckCircle2 className="w-4 h-4 text-violet-400 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
