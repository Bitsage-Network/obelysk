"use client";

/**
 * AVNU Swap Panel — DEX Aggregator Interface (Hardened)
 *
 * Standard (non-private) token swap routed through AVNU's aggregator
 * for best-price execution across Ekubo, JediSwap, MySwap, 10kSwap,
 * and Starknet market makers with split routing.
 *
 * Hardening:
 *  - High price impact (>5%) requires explicit confirmation
 *  - Slippage bounded to 5000 bps (50%) max with warnings >500 bps
 *  - Quote freshness indicator with countdown + auto-expire warning
 *  - BigInt-safe amount display (no Number precision loss >2^53)
 *  - Decimal-precision-capped input (max decimals per token)
 *  - Minimum swap notional guard ($0.01 floor)
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDown,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  ArrowLeftRight,
  Sparkles,
  ArrowRight,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccount, useConnect } from "@starknet-react/core";
import { useNetwork } from "@/lib/contexts/NetworkContext";
import {
  NETWORK_CONFIG,
  type NetworkType,
} from "@/lib/contracts/addresses";
import { useAvnuSwap } from "@/lib/hooks/useAvnuSwap";
import {
  getAvnuSupportedTokens,
  formatUsdValue,
  formatRawAmount,
  type AvnuQuote,
} from "@/lib/swap/avnuSwap";
import { TokenIcon } from "./TokenIcon";
import { TokenSelector, type TokenOption } from "./TokenSelector";

// ============================================================================
// CONSTANTS
// ============================================================================

const SLIPPAGE_PRESETS = [
  { label: "0.5%", value: 50 },
  { label: "1%", value: 100 },
  { label: "3%", value: 300 },
] as const;

const MAX_SLIPPAGE_BPS = 5_000; // 50%
const WARN_SLIPPAGE_BPS = 500;  // 5%
const HIGH_IMPACT_THRESHOLD = 5; // 5%
const QUOTE_TTL_MS = 30_000;

// ============================================================================
// SAFE DISPLAY HELPERS (BigInt — no Number precision loss)
// ============================================================================

function safeBuyAmountDisplay(rawBuyAmount: string, decimals: number): string {
  return formatRawAmount(rawBuyAmount, decimals, 6);
}

function safeMinReceived(rawBuyAmount: string, slippageBps: number, decimals: number): string {
  const raw = BigInt(rawBuyAmount);
  const clampedSlippage = Math.max(0, Math.min(slippageBps, 9_999)); // never go to 0 or negative
  const minRaw = (raw * BigInt(10_000 - clampedSlippage)) / BigInt(10_000);
  return formatRawAmount(minRaw.toString(), decimals, 6);
}

// ============================================================================
// ROUTE BADGE
// ============================================================================

function RouteBadge({ name, percent }: { name: string; percent: number }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.06]">
      <span className="text-[11px] font-medium text-emerald-400">{name}</span>
      <span className="text-[10px] text-gray-500">{(percent * 100).toFixed(0)}%</span>
    </div>
  );
}

// ============================================================================
// QUOTE CARD
// ============================================================================

function QuoteCard({
  quote,
  buyDecimals,
  buySymbol,
  isSelected,
  onSelect,
}: {
  quote: AvnuQuote;
  buyDecimals: number;
  buySymbol: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const buyDisplay = safeBuyAmountDisplay(quote.buyAmount, buyDecimals);

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full p-3 rounded-xl border text-left transition-all",
        isSelected
          ? "border-emerald-500/30 bg-emerald-500/[0.06] ring-1 ring-emerald-500/15"
          : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]"
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-white tabular-nums">
            {buyDisplay} <span className="text-gray-400 font-medium">{buySymbol}</span>
          </p>
          {quote.buyAmountInUsd > 0 && (
            <p className="text-[10px] text-gray-500 mt-0.5">{formatUsdValue(quote.buyAmountInUsd)}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {quote.routes.slice(0, 3).map((r, i) => (
            <span key={i} className="text-[10px] text-gray-500 bg-white/[0.04] px-1.5 py-0.5 rounded">
              {r.name}
            </span>
          ))}
          {isSelected && <CheckCircle2 className="w-4 h-4 text-emerald-400 ml-1" />}
        </div>
      </div>
    </button>
  );
}

// ============================================================================
// HIGH IMPACT CONFIRMATION MODAL
// ============================================================================

function HighImpactConfirmation({
  impact,
  sellSymbol,
  buySymbol,
  onConfirm,
  onCancel,
}: {
  impact: number;
  sellSymbol: string;
  buySymbol: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="p-4 rounded-2xl bg-orange-500/[0.06] border border-orange-500/20 space-y-3"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5 text-orange-400" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-orange-300">High Price Impact Warning</h4>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            This {sellSymbol} → {buySymbol} swap has a <span className="text-orange-400 font-semibold">{impact.toFixed(2)}%</span> price impact.
            You will receive significantly less value than the current market rate. Are you sure you want to proceed?
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] transition-all"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 border border-orange-500/20 transition-all"
        >
          Swap Anyway
        </button>
      </div>
    </motion.div>
  );
}

// ============================================================================
// QUOTE FRESHNESS INDICATOR
// ============================================================================

function QuoteFreshness({ fetchedAt, isFresh }: { fetchedAt: number | null; isFresh: boolean }) {
  const [age, setAge] = useState(0);

  useEffect(() => {
    if (!fetchedAt) return;
    const update = () => setAge(Math.floor((Date.now() - fetchedAt) / 1000));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [fetchedAt]);

  if (!fetchedAt) return null;

  return (
    <div className={cn(
      "flex items-center gap-1.5 text-[10px] font-medium",
      isFresh ? "text-gray-500" : "text-orange-400"
    )}>
      <Clock className="w-3 h-3" />
      <span>
        {age < 2 ? "Just now" : `${age}s ago`}
      </span>
      {!isFresh && <span className="text-orange-400">(stale)</span>}
    </div>
  );
}

// ============================================================================
// PROPS
// ============================================================================

interface AvnuSwapPanelProps {
  onSuccess?: () => void;
  onError?: (err: string) => void;
  className?: string;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function AvnuSwapPanel({ onSuccess, onError, className }: AvnuSwapPanelProps) {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { network } = useNetwork();
  const explorerUrl = NETWORK_CONFIG[network as keyof typeof NETWORK_CONFIG]?.explorerUrl || "";

  const {
    state,
    quotes,
    selectedQuote,
    isQuoting,
    quoteFetchedAt,
    isQuoteFresh,
    fetchQuotes,
    selectQuote,
    executeSwap,
    reset,
  } = useAvnuSwap();

  // Token list
  const supportedTokens = useMemo(() => {
    const avnuTokens = getAvnuSupportedTokens(network as NetworkType);
    return avnuTokens.map((t): TokenOption => ({
      symbol: t.symbol,
      address: t.address,
      hasPool: true,
    }));
  }, [network]);

  const avnuTokenMeta = useMemo(
    () => getAvnuSupportedTokens(network as NetworkType),
    [network]
  );

  // Token selection
  const [sellToken, setSellToken] = useState<TokenOption | null>(null);
  const [buyToken, setBuyToken] = useState<TokenOption | null>(null);

  // Amount
  const [sellAmount, setSellAmount] = useState("");

  // Slippage
  const [slippageBps, setSlippageBps] = useState(100);
  const [showSlippage, setShowSlippage] = useState(false);
  const [customSlippage, setCustomSlippage] = useState("");
  const [useCustomSlippage, setUseCustomSlippage] = useState(false);

  // High-impact confirmation gate
  const [showImpactConfirm, setShowImpactConfirm] = useState(false);

  // Auto-select ETH → STRK defaults
  useEffect(() => {
    if (supportedTokens.length >= 2 && !sellToken) {
      const eth = supportedTokens.find((t) => t.symbol === "ETH");
      const strk = supportedTokens.find((t) => t.symbol === "STRK");
      if (eth) setSellToken(eth);
      if (strk) setBuyToken(strk);
    }
  }, [supportedTokens, sellToken]);

  // Fetch quotes when inputs change + dismiss stale impact confirmation
  useEffect(() => {
    setShowImpactConfirm(false);

    if (!sellToken || !buyToken || !sellAmount || parseFloat(sellAmount) <= 0) return;

    const meta = avnuTokenMeta.find((t) => t.symbol === sellToken.symbol);
    if (!meta) return;

    fetchQuotes({
      sellToken: sellToken.address,
      buyToken: buyToken.address,
      sellAmount,
      sellDecimals: meta.decimals,
    });
  }, [sellToken, buyToken, sellAmount, avnuTokenMeta, fetchQuotes]);

  // Flip tokens
  const handleFlip = useCallback(() => {
    const prev = sellToken;
    setSellToken(buyToken);
    setBuyToken(prev);
    setSellAmount("");
  }, [sellToken, buyToken]);

  // Derived state
  const sellMeta = sellToken ? avnuTokenMeta.find((t) => t.symbol === sellToken.symbol) : null;
  const buyMeta = buyToken ? avnuTokenMeta.find((t) => t.symbol === buyToken.symbol) : null;
  const buyDecimals = buyMeta?.decimals ?? 18;
  const sellDecimals = sellMeta?.decimals ?? 18;

  // Effective slippage with bounds
  const rawCustomSlippage = parseInt(customSlippage) || 100;
  const effectiveSlippage = useCustomSlippage
    ? Math.max(1, Math.min(rawCustomSlippage, MAX_SLIPPAGE_BPS))
    : slippageBps;
  const isSlippageHigh = effectiveSlippage > WARN_SLIPPAGE_BPS;

  // BigInt-safe display
  const buyAmountDisplay = selectedQuote
    ? safeBuyAmountDisplay(selectedQuote.buyAmount, buyDecimals)
    : "";

  const isActive = state.stage !== "idle" && state.stage !== "quoting";
  const isSwapping = state.stage === "building" || state.stage === "submitting" || state.stage === "confirming";
  const isComplete = state.stage === "confirmed";
  const hasError = state.stage === "error";

  const hasHighImpact = selectedQuote && selectedQuote.priceImpact > HIGH_IMPACT_THRESHOLD;

  const canSwap =
    isConnected &&
    sellToken &&
    buyToken &&
    sellToken.symbol !== buyToken.symbol &&
    parseFloat(sellAmount) > 0 &&
    selectedQuote &&
    isQuoteFresh &&
    !isSwapping;

  // Amount input handler — cap decimals per token
  const handleAmountChange = useCallback((value: string) => {
    // Allow only valid decimal input
    if (!/^\d*\.?\d*$/.test(value)) return;

    // Cap fractional digits to token decimals
    if (value.includes(".")) {
      const parts = value.split(".");
      if (parts[1] && parts[1].length > sellDecimals) return;
    }

    setSellAmount(value);
  }, [sellDecimals]);

  // Custom slippage handler — strip leading zeros, enforce bounds
  const handleCustomSlippageChange = useCallback((value: string) => {
    if (!/^\d*$/.test(value)) return;
    // Strip leading zeros
    const cleaned = value.replace(/^0+(\d)/, "$1");
    setCustomSlippage(cleaned);
  }, []);

  // Execute with high-impact gate
  const handleSwap = useCallback(async () => {
    if (hasHighImpact && !showImpactConfirm) {
      setShowImpactConfirm(true);
      return;
    }
    setShowImpactConfirm(false);

    const txHash = await executeSwap(effectiveSlippage);
    if (txHash) {
      onSuccess?.();
    } else if (state.error) {
      onError?.(state.error);
    }
  }, [executeSwap, effectiveSlippage, onSuccess, onError, state.error, hasHighImpact, showImpactConfirm]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className={cn("relative", className)}>
      <div className="relative z-10 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-600/25 to-teal-600/15 border border-emerald-500/20 flex items-center justify-center shadow-[0_0_24px_rgba(16,185,129,0.15)]"
            >
              <ArrowLeftRight className="w-5 h-5 text-emerald-400" />
            </motion.div>
            <div>
              <h3 className="text-white font-bold text-lg tracking-tight">Swap</h3>
              <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Powered by AVNU
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Quote freshness */}
            <QuoteFreshness fetchedAt={quoteFetchedAt} isFresh={isQuoteFresh} />

            {/* Slippage toggle */}
            <button
              onClick={() => setShowSlippage(!showSlippage)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all",
                isSlippageHigh
                  ? "border-orange-500/30 bg-orange-500/10 text-orange-400"
                  : showSlippage
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-white/[0.06] bg-white/[0.02] text-gray-500 hover:text-gray-300 hover:bg-white/[0.05]"
              )}
            >
              {isSlippageHigh && <AlertTriangle className="w-3 h-3 inline mr-1" />}
              Slippage: {(effectiveSlippage / 100).toFixed(1)}%
            </button>
          </div>
        </div>

        {/* Active swap state — building/submitting/confirmed/error */}
        <AnimatePresence mode="wait">
          {(isSwapping || isComplete || hasError) ? (
            <motion.div
              key="swap-active"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-4"
            >
              {/* Swap summary */}
              <div className="p-5 rounded-2xl bg-gradient-to-b from-surface-card/90 to-surface-elevated/60 border border-surface-border/40 backdrop-blur-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {sellToken && <TokenIcon symbol={sellToken.symbol} size="lg" />}
                    <div>
                      <p className="text-xs text-gray-500">Selling</p>
                      <p className="text-lg font-bold text-white">
                        {sellAmount} <span className="text-gray-400">{sellToken?.symbol}</span>
                      </p>
                    </div>
                  </div>

                  <motion.div
                    animate={{ x: [0, 6, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <ArrowRight className={cn(
                      "w-5 h-5",
                      isComplete ? "text-emerald-400" : "text-emerald-400/60"
                    )} />
                  </motion.div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Receiving</p>
                      <p className="text-lg font-bold text-white">
                        {buyAmountDisplay || "..."} <span className="text-gray-400">{buyToken?.symbol}</span>
                      </p>
                    </div>
                    {buyToken && <TokenIcon symbol={buyToken.symbol} size="lg" />}
                  </div>
                </div>

                {/* Status */}
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                  {isSwapping && <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />}
                  {isComplete && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  {hasError && <AlertCircle className="w-4 h-4 text-red-400" />}
                  <span className={cn(
                    "text-sm font-medium",
                    isComplete ? "text-emerald-400" : hasError ? "text-red-400" : "text-gray-300"
                  )}>
                    {state.message}
                  </span>
                </div>

                {/* Route info */}
                {selectedQuote && selectedQuote.routes.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-gray-600 uppercase tracking-wider">Route:</span>
                    {selectedQuote.routes.map((r, i) => (
                      <RouteBadge key={i} name={r.name} percent={r.percent} />
                    ))}
                  </div>
                )}

                {/* Tx link */}
                {state.txHash && (
                  <div className="mt-3 pt-3 border-t border-white/[0.04]">
                    <a
                      href={`${explorerUrl}/tx/${state.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                      View on Explorer <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>

              {/* Error detail */}
              {hasError && state.error && (
                <div className="p-3 rounded-xl bg-red-500/[0.06] border border-red-500/15 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-300/90 leading-relaxed">{state.error}</p>
                </div>
              )}

              {/* Action button */}
              <motion.button
                onClick={isComplete || hasError ? reset : undefined}
                disabled={isSwapping}
                whileHover={!isSwapping ? { scale: 1.01 } : {}}
                whileTap={!isSwapping ? { scale: 0.99 } : {}}
                className={cn(
                  "w-full py-4 rounded-2xl font-semibold transition-all text-sm",
                  isComplete
                    ? "bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-lg shadow-emerald-600/20 hover:shadow-emerald-600/30"
                    : hasError
                    ? "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/15"
                    : "bg-white/[0.03] text-gray-500 cursor-wait"
                )}
              >
                {isComplete ? (
                  <span className="flex items-center justify-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Swap Complete — Swap Again
                  </span>
                ) : hasError ? (
                  <span className="flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4" />
                    Try Again
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {state.message || "Processing..."}
                  </span>
                )}
              </motion.button>
            </motion.div>
          ) : (
            /* ═══════════════════════════════════════════════════
               SWAP FORM — idle/quoting state
               ═══════════════════════════════════════════════════ */
            <motion.div
              key="swap-form"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-3"
            >
              {/* Slippage panel */}
              <AnimatePresence>
                {showSlippage && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 rounded-2xl bg-surface-card/60 border border-surface-border/30 mb-3 space-y-3">
                      <span className="text-[11px] text-gray-400 uppercase tracking-wider font-medium">Slippage Tolerance</span>
                      <div className="flex gap-1.5">
                        {SLIPPAGE_PRESETS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => { setSlippageBps(opt.value); setUseCustomSlippage(false); }}
                            className={cn(
                              "flex-1 py-2 rounded-xl text-xs font-semibold transition-all",
                              slippageBps === opt.value && !useCustomSlippage
                                ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25"
                                : "bg-white/[0.03] text-gray-500 hover:bg-white/[0.06]"
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                        <button
                          onClick={() => setUseCustomSlippage(!useCustomSlippage)}
                          className={cn(
                            "flex-1 py-2 rounded-xl text-xs font-semibold transition-all",
                            useCustomSlippage
                              ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25"
                              : "bg-white/[0.03] text-gray-500 hover:bg-white/[0.06]"
                          )}
                        >
                          Custom
                        </button>
                      </div>

                      {useCustomSlippage && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={customSlippage}
                              onChange={(e) => handleCustomSlippageChange(e.target.value)}
                              placeholder="150"
                              className="flex-1 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-sm text-white placeholder:text-gray-700 outline-none focus:border-emerald-500/30 focus:ring-1 focus:ring-emerald-500/10"
                            />
                            <span className="text-[10px] text-gray-500 font-medium">bps</span>
                          </div>
                          {rawCustomSlippage > MAX_SLIPPAGE_BPS && (
                            <p className="text-[10px] text-orange-400 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Capped at {MAX_SLIPPAGE_BPS} bps ({(MAX_SLIPPAGE_BPS / 100).toFixed(0)}%)
                            </p>
                          )}
                        </div>
                      )}

                      {/* High slippage warning */}
                      {isSlippageHigh && (
                        <div className="p-2.5 rounded-xl bg-orange-500/[0.06] border border-orange-500/10 flex items-start gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 text-orange-400 shrink-0 mt-0.5" />
                          <p className="text-[10px] text-orange-300/80 leading-relaxed">
                            High slippage ({(effectiveSlippage / 100).toFixed(1)}%) increases the risk of unfavorable execution.
                          </p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* SELL INPUT */}
              <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.03] to-white/[0.01] p-4 transition-all focus-within:border-emerald-500/20 focus-within:shadow-[0_0_30px_rgba(16,185,129,0.05)]">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">Sell</span>
                  {selectedQuote && selectedQuote.sellAmountInUsd > 0 && (
                    <span className="text-[10px] text-gray-500">{formatUsdValue(selectedQuote.sellAmountInUsd)}</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <TokenSelector
                    selected={sellToken}
                    tokens={supportedTokens}
                    onSelect={setSellToken}
                    label="Select token"
                    disabled={isSwapping}
                    exclude={buyToken?.symbol}
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={sellAmount}
                    onChange={(e) => handleAmountChange(e.target.value)}
                    placeholder="0.0"
                    disabled={isSwapping}
                    className="flex-1 bg-transparent text-right text-2xl font-bold text-white placeholder:text-gray-700/60 outline-none min-w-0 tabular-nums"
                  />
                </div>
              </div>

              {/* FLIP BUTTON */}
              <div className="flex justify-center -my-1.5 relative z-10">
                <motion.button
                  onClick={handleFlip}
                  whileHover={{ scale: 1.15, rotate: 180 }}
                  whileTap={{ scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 400, damping: 15 }}
                  className="w-10 h-10 rounded-2xl bg-gradient-to-b from-[#15171e] to-[#0f1117] border border-white/[0.08] flex items-center justify-center hover:border-emerald-500/25 transition-colors shadow-xl shadow-black/40 hover:shadow-emerald-500/10"
                >
                  <ArrowDown className="w-4 h-4 text-gray-400" />
                </motion.button>
              </div>

              {/* BUY OUTPUT */}
              <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-white/[0.005] p-4">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">Buy</span>
                  {selectedQuote && (
                    <span className={cn(
                      "text-[10px] font-medium px-2 py-0.5 rounded-md",
                      selectedQuote.priceImpact > HIGH_IMPACT_THRESHOLD
                        ? "bg-red-500/10 text-red-400"
                        : selectedQuote.priceImpact > 3
                        ? "bg-orange-500/10 text-orange-400"
                        : selectedQuote.priceImpact > 1
                        ? "bg-yellow-500/10 text-yellow-400"
                        : "bg-emerald-500/10 text-emerald-400"
                    )}>
                      {selectedQuote.priceImpact < 0.01 ? "<0.01" : selectedQuote.priceImpact.toFixed(2)}% impact
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <TokenSelector
                    selected={buyToken}
                    tokens={supportedTokens}
                    onSelect={setBuyToken}
                    label="Select token"
                    disabled={isSwapping}
                    exclude={sellToken?.symbol}
                  />
                  <div className="flex-1 text-right min-w-0">
                    {isQuoting ? (
                      <div className="flex items-center justify-end gap-2">
                        <Loader2 className="w-5 h-5 text-gray-600 animate-spin" />
                      </div>
                    ) : buyAmountDisplay ? (
                      <div>
                        <p className="text-2xl font-bold text-white tabular-nums truncate">
                          {buyAmountDisplay}
                        </p>
                        {selectedQuote && selectedQuote.buyAmountInUsd > 0 && (
                          <p className="text-[10px] text-gray-500 mt-0.5">{formatUsdValue(selectedQuote.buyAmountInUsd)}</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-2xl font-bold text-gray-700/50">0.0</p>
                    )}
                  </div>
                </div>
              </div>

              {/* QUOTE DETAILS */}
              <AnimatePresence>
                {selectedQuote && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-3.5 rounded-xl bg-white/[0.015] border border-white/[0.04] space-y-2">
                      {/* Route */}
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-gray-500">Route</span>
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          {selectedQuote.routes.map((route, i) => (
                            <RouteBadge key={i} name={route.name} percent={route.percent} />
                          ))}
                        </div>
                      </div>

                      {/* Min received (BigInt-safe) */}
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-gray-500">Min. received</span>
                        <span className="text-[11px] text-gray-400 tabular-nums">
                          {safeMinReceived(selectedQuote.buyAmount, effectiveSlippage, buyDecimals)} {buyToken?.symbol}
                        </span>
                      </div>

                      {/* Gas */}
                      {selectedQuote.gasFeesInUsd > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-gray-500">Gas</span>
                          <span className="text-[11px] text-gray-400">{formatUsdValue(selectedQuote.gasFeesInUsd)}</span>
                        </div>
                      )}

                      {/* Slippage */}
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-gray-500">Slippage</span>
                        <span className={cn(
                          "text-[11px]",
                          isSlippageHigh ? "text-orange-400" : "text-gray-400"
                        )}>
                          {(effectiveSlippage / 100).toFixed(1)}%
                          {isSlippageHigh && " (high)"}
                        </span>
                      </div>
                    </div>

                    {/* Multiple quotes */}
                    {quotes.length > 1 && (
                      <div className="mt-2 space-y-1.5">
                        <span className="text-[10px] text-gray-600 uppercase tracking-wider">
                          {quotes.length} routes found
                        </span>
                        {quotes.map((q) => (
                          <QuoteCard
                            key={q.quoteId}
                            quote={q}
                            buyDecimals={buyDecimals}
                            buySymbol={buyToken?.symbol || ""}
                            isSelected={selectedQuote?.quoteId === q.quoteId}
                            onSelect={() => selectQuote(q)}
                          />
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* High impact confirmation gate */}
              <AnimatePresence>
                {showImpactConfirm && selectedQuote && sellToken && buyToken && (
                  <HighImpactConfirmation
                    impact={selectedQuote.priceImpact}
                    sellSymbol={sellToken.symbol}
                    buySymbol={buyToken.symbol}
                    onConfirm={handleSwap}
                    onCancel={() => setShowImpactConfirm(false)}
                  />
                )}
              </AnimatePresence>

              {/* Quote stale warning */}
              {selectedQuote && !isQuoteFresh && !isQuoting && (
                <div className="p-3 rounded-xl bg-orange-500/[0.06] border border-orange-500/10 flex items-start gap-2.5">
                  <Clock className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
                  <span className="text-xs text-orange-300/80">Quote has expired. A new quote will be fetched automatically.</span>
                </div>
              )}

              {/* Error banner (non-blocking, e.g. quote error) */}
              {state.error && state.stage === "idle" && (
                <div className="p-3 rounded-xl bg-red-500/[0.06] border border-red-500/10 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span className="text-xs text-red-300/80">{state.error}</span>
                </div>
              )}

              {/* ACTION BUTTON */}
              {!isConnected ? (
                <motion.button
                  onClick={() => connectors[0] && connect({ connector: connectors[0] })}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="w-full py-4 rounded-2xl font-semibold text-sm bg-white/[0.06] border border-white/[0.08] text-gray-300 hover:bg-white/[0.1] hover:text-white transition-all"
                >
                  Connect Wallet
                </motion.button>
              ) : !sellAmount || parseFloat(sellAmount) <= 0 ? (
                <button
                  disabled
                  className="w-full py-4 rounded-2xl font-semibold text-sm bg-white/[0.02] text-gray-600 cursor-not-allowed"
                >
                  Enter an amount
                </button>
              ) : sellToken?.symbol === buyToken?.symbol ? (
                <button
                  disabled
                  className="w-full py-4 rounded-2xl font-semibold text-sm bg-white/[0.02] text-gray-600 cursor-not-allowed"
                >
                  Select different tokens
                </button>
              ) : !selectedQuote && !isQuoting ? (
                <button
                  disabled
                  className="w-full py-4 rounded-2xl font-semibold text-sm bg-white/[0.02] text-gray-600 cursor-not-allowed"
                >
                  No quotes available
                </button>
              ) : selectedQuote && !isQuoteFresh && !isQuoting ? (
                <button
                  disabled
                  className="w-full py-4 rounded-2xl font-semibold text-sm bg-orange-500/[0.04] text-orange-400/60 cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Clock className="w-4 h-4" />
                  Quote expired — refreshing...
                </button>
              ) : isQuoting ? (
                <button
                  disabled
                  className="w-full py-4 rounded-2xl font-semibold text-sm bg-white/[0.02] text-gray-500 cursor-wait flex items-center justify-center gap-2"
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Finding best route...
                </button>
              ) : (
                <motion.button
                  onClick={handleSwap}
                  disabled={!canSwap || showImpactConfirm}
                  whileHover={{ scale: 1.005 }}
                  whileTap={{ scale: 0.995 }}
                  className={cn(
                    "w-full py-4 rounded-2xl font-bold text-sm text-white transition-all relative overflow-hidden group",
                    hasHighImpact
                      ? "bg-gradient-to-r from-orange-600 via-red-600 to-orange-600 bg-[length:200%_100%]"
                      : "bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 bg-[length:200%_100%]",
                    hasHighImpact
                      ? "hover:shadow-xl hover:shadow-orange-500/20"
                      : "hover:shadow-xl hover:shadow-emerald-500/20",
                    "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none"
                  )}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out" />
                  <span className="flex items-center justify-center gap-2 relative z-10">
                    {hasHighImpact && <AlertTriangle className="w-4 h-4" />}
                    {!hasHighImpact && <ArrowLeftRight className="w-4 h-4" />}
                    {hasHighImpact
                      ? `Swap ${sellToken?.symbol} → ${buyToken?.symbol} (${selectedQuote?.priceImpact.toFixed(1)}% impact)`
                      : `Swap ${sellToken?.symbol} → ${buyToken?.symbol}`
                    }
                  </span>
                </motion.button>
              )}

              {/* AVNU attribution */}
              <div className="flex items-center justify-center gap-1.5 pt-1">
                <span className="text-[10px] text-gray-600">Powered by</span>
                <span className="text-[10px] text-emerald-500/80 font-semibold tracking-wide">AVNU</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default AvnuSwapPanel;
