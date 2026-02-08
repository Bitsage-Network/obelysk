"use client";

/**
 * Shielded Swap Panel — Premium Privacy Swap Interface
 *
 * A cinematic, privacy-first token swap experience built for the Obelysk Protocol.
 * Routes swaps through the ShieldedSwapRouter → Ekubo AMM while hiding
 * the user's identity on-chain.
 *
 * Design: Glassmorphic dark theme with animated gradient accents,
 * orbital privacy shield visualization, and buttery micro-interactions.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Lock,
  ArrowUpDown,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Zap,
  ChevronDown,
  Info,
  Eye,
  EyeOff,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccount, useConnect } from "@starknet-react/core";
import {
  useShieldedSwap,
  type SwapParams,
} from "@/lib/hooks/useShieldedSwap";
import {
  getSupportedSwapTokens,
  validateSwapPrerequisites,
  type SwapEstimate,
} from "@/lib/swap/shieldedSwap";
import { useNetwork } from "@/lib/contexts/NetworkContext";
import {
  NETWORK_CONFIG,
  TOKEN_METADATA,
  type NetworkType,
} from "@/lib/contracts/addresses";
import { ProvingFlowCard, type ProvingStage } from "@/components/privacy/ProvingFlowCard";

// ============================================================================
// TYPES
// ============================================================================

interface ShieldedSwapPanelProps {
  onSuccess?: (txHash: string) => void;
  onError?: (error: string) => void;
  className?: string;
}

interface TokenOption {
  symbol: string;
  address: string;
  hasPool: boolean;
}

// ============================================================================
// TOKEN ICON COMPONENT
// ============================================================================

const TOKEN_COLORS: Record<string, { from: string; to: string; text: string }> = {
  ETH: { from: "from-blue-500/30", to: "to-indigo-600/20", text: "text-blue-300" },
  STRK: { from: "from-orange-500/30", to: "to-amber-600/20", text: "text-orange-300" },
  SAGE: { from: "from-violet-500/30", to: "to-fuchsia-600/20", text: "text-violet-300" },
  USDC: { from: "from-sky-500/30", to: "to-blue-600/20", text: "text-sky-300" },
  wBTC: { from: "from-amber-500/30", to: "to-orange-600/20", text: "text-amber-300" },
};

function TokenIcon({ symbol, size = "md" }: { symbol: string; size?: "sm" | "md" | "lg" }) {
  const colors = TOKEN_COLORS[symbol] || TOKEN_COLORS.ETH;
  const dims = size === "sm" ? "w-6 h-6 text-[10px]" : size === "lg" ? "w-10 h-10 text-sm" : "w-8 h-8 text-xs";
  return (
    <div className={cn(
      dims,
      "rounded-full bg-gradient-to-br border border-white/10 flex items-center justify-center font-bold shrink-0",
      colors.from, colors.to, colors.text
    )}>
      {symbol.charAt(0)}
    </div>
  );
}

// ============================================================================
// SLIPPAGE OPTIONS
// ============================================================================

const SLIPPAGE_OPTIONS = [
  { label: "0.5%", value: 50 },
  { label: "1%", value: 100 },
  { label: "2%", value: 200 },
] as const;

// ============================================================================
// STAGE → PROVING STAGE MAP
// ============================================================================

function toProvingStage(stage: string): ProvingStage {
  switch (stage) {
    case "generating-proofs": return "proving";
    case "submitting": return "submitting";
    case "confirming": return "confirming";
    case "confirmed": return "confirmed";
    case "error": return "error";
    default: return "idle";
  }
}

// ============================================================================
// TOKEN SELECTOR DROPDOWN
// ============================================================================

function TokenSelector({
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

// ============================================================================
// PRIVACY SHIELD ORB — animated background element
// ============================================================================

function PrivacyOrb() {
  return (
    <div className="absolute -top-20 -right-20 w-56 h-56 pointer-events-none select-none opacity-40">
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-600/20 via-fuchsia-600/10 to-transparent blur-3xl animate-pulse-slow" />
      <div className="absolute inset-4 rounded-full bg-gradient-to-br from-violet-500/10 via-transparent to-transparent blur-2xl" style={{ animationDelay: "1s" }} />
    </div>
  );
}

// ============================================================================
// SWAP STAGE PROGRESS — cinematic multi-step indicator
// ============================================================================

const SWAP_STAGES = [
  { key: "generating-proofs", label: "Generating Proofs", icon: Shield },
  { key: "submitting", label: "Submitting", icon: Zap },
  { key: "confirming", label: "Confirming", icon: Loader2 },
  { key: "confirmed", label: "Complete", icon: CheckCircle2 },
] as const;

function SwapStageIndicator({ currentStage }: { currentStage: string }) {
  const stageIndex = SWAP_STAGES.findIndex((s) => s.key === currentStage);

  return (
    <div className="flex items-center gap-1 w-full">
      {SWAP_STAGES.map((stage, idx) => {
        const isComplete = idx < stageIndex;
        const isCurrent = idx === stageIndex;
        const Icon = stage.icon;

        return (
          <div key={stage.key} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <motion.div
                initial={false}
                animate={{
                  scale: isCurrent ? 1.1 : 1,
                  opacity: isComplete || isCurrent ? 1 : 0.3,
                }}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center border transition-colors",
                  isComplete
                    ? "bg-emerald-500/20 border-emerald-500/40"
                    : isCurrent
                    ? "bg-violet-500/20 border-violet-500/40 shadow-[0_0_16px_rgba(139,92,246,0.25)]"
                    : "bg-white/[0.03] border-white/[0.06]"
                )}
              >
                <Icon className={cn(
                  "w-3.5 h-3.5",
                  isComplete ? "text-emerald-400" : isCurrent ? "text-violet-400" : "text-gray-600",
                  isCurrent && stage.key !== "confirmed" && "animate-pulse"
                )} />
              </motion.div>
              <span className={cn(
                "text-[9px] mt-1.5 font-medium tracking-wide",
                isComplete ? "text-emerald-400/70" : isCurrent ? "text-violet-400" : "text-gray-600"
              )}>
                {stage.label}
              </span>
            </div>
            {idx < SWAP_STAGES.length - 1 && (
              <div className={cn(
                "h-px flex-1 -mt-4 mx-0.5",
                isComplete ? "bg-emerald-500/30" : "bg-white/[0.04]"
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ShieldedSwapPanel({
  onSuccess,
  onError,
  className,
}: ShieldedSwapPanelProps) {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { network } = useNetwork();
  const explorerUrl = NETWORK_CONFIG[network as keyof typeof NETWORK_CONFIG]?.explorerUrl || "";

  const {
    state,
    executeSwap,
    estimateOutput,
    reset,
    isRouterDeployed,
    getPrivacyPoolBalance,
  } = useShieldedSwap();

  // Token selection
  const supportedTokens = useMemo(
    () => getSupportedSwapTokens(network as NetworkType),
    [network]
  );
  const [inputToken, setInputToken] = useState<TokenOption | null>(null);
  const [outputToken, setOutputToken] = useState<TokenOption | null>(null);

  // Amount
  const [inputAmount, setInputAmount] = useState("");
  const [estimate, setEstimate] = useState<SwapEstimate | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);

  // Privacy pool balance
  const [privacyBalance, setPrivacyBalance] = useState<number | null>(null);

  // Pool validation
  const [poolValidationError, setPoolValidationError] = useState<string | null>(null);

  // Slippage
  const [slippageBps, setSlippageBps] = useState(100);
  const [customSlippage, setCustomSlippage] = useState("");
  const [showCustomSlippage, setShowCustomSlippage] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Privacy info
  const [showPrivacyInfo, setShowPrivacyInfo] = useState(false);

  // Auto-select defaults
  useEffect(() => {
    if (supportedTokens.length >= 2 && !inputToken) {
      const eth = supportedTokens.find((t) => t.symbol === "ETH");
      const strk = supportedTokens.find((t) => t.symbol === "STRK");
      if (eth) setInputToken(eth);
      if (strk) setOutputToken(strk);
    }
  }, [supportedTokens, inputToken]);

  // Fetch privacy pool balance
  useEffect(() => {
    if (!address || !inputToken) { setPrivacyBalance(null); return; }
    let cancelled = false;
    getPrivacyPoolBalance(inputToken.symbol).then((bal) => {
      if (!cancelled) setPrivacyBalance(bal);
    });
    return () => { cancelled = true; };
  }, [address, inputToken, getPrivacyPoolBalance, state.stage]);

  // Pool validation
  useEffect(() => {
    if (!inputToken || !outputToken || inputToken.symbol === outputToken.symbol) {
      setPoolValidationError(null);
      return;
    }
    const result = validateSwapPrerequisites(inputToken.symbol, outputToken.symbol, network);
    setPoolValidationError(result.valid ? null : (result.error || null));
  }, [inputToken, outputToken, network]);

  // Debounced estimation
  useEffect(() => {
    if (!inputToken || !outputToken || !inputAmount || parseFloat(inputAmount) <= 0) {
      setEstimate(null);
      return;
    }
    const decimals = TOKEN_METADATA[inputToken.symbol as keyof typeof TOKEN_METADATA]?.decimals ?? 18;
    const timer = setTimeout(async () => {
      setIsEstimating(true);
      const est = await estimateOutput(inputToken.address, outputToken.address, inputAmount, decimals);
      setEstimate(est);
      setIsEstimating(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [inputToken, outputToken, inputAmount, estimateOutput]);

  // Flip tokens
  const handleFlip = useCallback(() => {
    const prev = inputToken;
    setInputToken(outputToken);
    setOutputToken(prev);
    setInputAmount("");
    setEstimate(null);
  }, [inputToken, outputToken]);

  // Execute swap
  const handleSwap = useCallback(async () => {
    if (!inputToken || !outputToken || !inputAmount) return;
    const inputMeta = TOKEN_METADATA[inputToken.symbol as keyof typeof TOKEN_METADATA];
    const outputMeta = TOKEN_METADATA[outputToken.symbol as keyof typeof TOKEN_METADATA];
    const params: SwapParams = {
      inputToken: inputToken.address,
      outputToken: outputToken.address,
      inputAmount,
      inputDecimals: inputMeta?.decimals ?? 18,
      outputDecimals: outputMeta?.decimals ?? 18,
      slippageBps: showCustomSlippage ? parseInt(customSlippage) || 100 : slippageBps,
      inputSymbol: inputToken.symbol,
      outputSymbol: outputToken.symbol,
    };
    try {
      const txHash = await executeSwap(params);
      if (txHash) onSuccess?.(txHash);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Swap failed";
      onError?.(message);
    }
  }, [inputToken, outputToken, inputAmount, slippageBps, customSlippage, showCustomSlippage, executeSwap, onSuccess, onError]);

  // Computed state
  const isSwapping = state.stage !== "idle" && state.stage !== "confirmed" && state.stage !== "error";
  const isComplete = state.stage === "confirmed";
  const hasError = state.stage === "error";
  const isActive = isSwapping || isComplete || hasError;

  const outputDecimals = outputToken
    ? TOKEN_METADATA[outputToken.symbol as keyof typeof TOKEN_METADATA]?.decimals ?? 18
    : 18;
  const estimatedOutputDisplay = estimate
    ? (Number(estimate.expectedOutput) / 10 ** outputDecimals).toFixed(6)
    : "";

  const effectiveSlippage = showCustomSlippage ? parseInt(customSlippage) || 100 : slippageBps;
  const poolsValid = !poolValidationError;
  const canSwap =
    isConnected && inputToken && outputToken &&
    inputToken.symbol !== outputToken.symbol &&
    parseFloat(inputAmount) > 0 && !isSwapping && poolsValid;

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className={cn("relative", className)}>
      {/* Ambient orb */}
      <PrivacyOrb />

      <div className="relative z-10 space-y-5">

        {/* ─── Header ──────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-600/25 to-fuchsia-600/15 border border-violet-500/20 flex items-center justify-center shadow-[0_0_24px_rgba(139,92,246,0.15)]"
            >
              <Shield className="w-5 h-5 text-violet-400" />
            </motion.div>
            <div>
              <h3 className="text-white font-bold text-lg tracking-tight">Shielded Swap</h3>
              <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Powered by Ekubo AMM
              </p>
            </div>
          </div>

          {/* Privacy badge + Settings */}
          <div className="flex items-center gap-2">
            <motion.div
              whileHover={{ scale: 1.04 }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 border border-violet-500/15"
            >
              <Lock className="w-3 h-3 text-violet-400" />
              <span className="text-[10px] font-semibold text-violet-300 tracking-wide uppercase">Private</span>
            </motion.div>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={cn(
                "p-2 rounded-lg border transition-all",
                showSettings
                  ? "border-violet-500/30 bg-violet-500/10"
                  : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]"
              )}
            >
              <Info className="w-3.5 h-3.5 text-gray-400" />
            </button>
          </div>
        </div>

        {/* ─── Active Swap Flow ────────────────────────────── */}
        <AnimatePresence mode="wait">
          {isActive ? (
            <motion.div
              key="swap-active"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-4"
            >
              {/* Stage indicator */}
              <div className="p-4 rounded-2xl bg-surface-card/80 border border-surface-border/40 backdrop-blur-sm">
                <SwapStageIndicator currentStage={state.stage} />
              </div>

              {/* Swap summary card */}
              <div className="p-5 rounded-2xl bg-gradient-to-b from-surface-card/90 to-surface-elevated/60 border border-surface-border/40 backdrop-blur-sm">
                {/* Token flow visualization */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    {inputToken && <TokenIcon symbol={inputToken.symbol} size="lg" />}
                    <div>
                      <p className="text-xs text-gray-500">Sending</p>
                      <p className="text-lg font-bold text-white">
                        {state.inputAmount || inputAmount} <span className="text-gray-400">{inputToken?.symbol}</span>
                      </p>
                    </div>
                  </div>

                  <motion.div
                    animate={{ x: [0, 6, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <ArrowRight className={cn(
                      "w-5 h-5",
                      isComplete ? "text-emerald-400" : "text-violet-400"
                    )} />
                  </motion.div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Receiving</p>
                      <p className="text-lg font-bold text-white">
                        {state.outputAmount || estimatedOutputDisplay || "..."} <span className="text-gray-400">{outputToken?.symbol}</span>
                      </p>
                    </div>
                    {outputToken && <TokenIcon symbol={outputToken.symbol} size="lg" />}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                  <motion.div
                    className={cn(
                      "h-full rounded-full",
                      hasError ? "bg-red-500"
                        : isComplete ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                        : "bg-gradient-to-r from-violet-500 via-fuchsia-500 to-violet-500 bg-[length:200%_100%] animate-shimmer"
                    )}
                    initial={{ width: 0 }}
                    animate={{ width: `${state.progress}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                  />
                </div>

                {/* Status line */}
                <div className="flex items-center justify-between mt-3">
                  <span className={cn(
                    "text-xs font-medium",
                    isComplete ? "text-emerald-400" : hasError ? "text-red-400" : "text-violet-400"
                  )}>
                    {state.message}
                  </span>
                  <span className="text-[10px] text-gray-600 font-mono">{state.progress}%</span>
                </div>

                {/* Proof time + explorer */}
                {(state.provingTimeMs || state.txHash) && (
                  <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center justify-between">
                    {state.provingTimeMs && (
                      <div className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3 text-cyan-400" />
                        <span className="text-[10px] text-cyan-400 font-mono">{state.provingTimeMs}ms proof</span>
                      </div>
                    )}
                    {state.txHash && (
                      <a
                        href={`${explorerUrl}/tx/${state.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-[10px] text-violet-400 hover:text-violet-300 transition-colors"
                      >
                        View transaction <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Error detail */}
              {hasError && state.error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="p-4 rounded-xl bg-red-500/[0.06] border border-red-500/15"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-300/90 leading-relaxed">{state.error}</p>
                  </div>
                </motion.div>
              )}

              {/* Action button */}
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
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
               SWAP FORM — idle state
               ═══════════════════════════════════════════════════ */
            <motion.div
              key="swap-form"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-3"
            >
              {/* ── Settings Panel (collapsible) ──────────── */}
              <AnimatePresence>
                {showSettings && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 rounded-2xl bg-surface-card/60 border border-surface-border/30 mb-3 space-y-3">
                      {/* Slippage */}
                      <div>
                        <span className="text-[11px] text-gray-400 uppercase tracking-wider font-medium">Slippage Tolerance</span>
                        <div className="flex gap-1.5 mt-2">
                          {SLIPPAGE_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              onClick={() => { setSlippageBps(opt.value); setShowCustomSlippage(false); }}
                              className={cn(
                                "flex-1 py-2 rounded-xl text-xs font-semibold transition-all",
                                slippageBps === opt.value && !showCustomSlippage
                                  ? "bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/25"
                                  : "bg-white/[0.03] text-gray-500 hover:bg-white/[0.06]"
                              )}
                            >
                              {opt.label}
                            </button>
                          ))}
                          <button
                            onClick={() => setShowCustomSlippage(!showCustomSlippage)}
                            className={cn(
                              "flex-1 py-2 rounded-xl text-xs font-semibold transition-all",
                              showCustomSlippage
                                ? "bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/25"
                                : "bg-white/[0.03] text-gray-500 hover:bg-white/[0.06]"
                            )}
                          >
                            Custom
                          </button>
                        </div>
                        {showCustomSlippage && (
                          <div className="flex items-center gap-2 mt-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={customSlippage}
                              onChange={(e) => { if (/^\d*$/.test(e.target.value)) setCustomSlippage(e.target.value); }}
                              placeholder="150"
                              className="flex-1 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-sm text-white placeholder:text-gray-700 outline-none focus:border-violet-500/30 focus:ring-1 focus:ring-violet-500/10"
                            />
                            <span className="text-[10px] text-gray-500 font-medium">bps</span>
                          </div>
                        )}
                      </div>

                      {/* Privacy model */}
                      <div className="pt-3 border-t border-white/[0.04] space-y-2.5">
                        <span className="text-[11px] text-gray-400 uppercase tracking-wider font-medium">Privacy Model</span>
                        <div className="flex items-center gap-2.5">
                          <div className="w-6 h-6 rounded-full bg-emerald-500/15 flex items-center justify-center">
                            <EyeOff className="w-3 h-3 text-emerald-400" />
                          </div>
                          <div>
                            <p className="text-[11px] font-medium text-emerald-300">Identity Hidden</p>
                            <p className="text-[10px] text-gray-600">Router contract is the on-chain actor</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <div className="w-6 h-6 rounded-full bg-amber-500/15 flex items-center justify-center">
                            <Eye className="w-3 h-3 text-amber-400" />
                          </div>
                          <div>
                            <p className="text-[11px] font-medium text-amber-300">Amounts Visible</p>
                            <p className="text-[10px] text-gray-600">Required for AMM constant-product math</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── FROM TOKEN INPUT ─────────────────────── */}
              <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.03] to-white/[0.01] p-4 transition-all focus-within:border-violet-500/20 focus-within:shadow-[0_0_30px_rgba(139,92,246,0.05)]">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">From</span>
                  {inputToken && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-600">
                        Pool: {privacyBalance !== null ? `${privacyBalance.toFixed(4)}` : "—"}
                      </span>
                      {privacyBalance !== null && privacyBalance > 0 && (
                        <button
                          onClick={() => setInputAmount(privacyBalance.toString())}
                          disabled={isSwapping}
                          className="text-[10px] font-bold text-violet-400 hover:text-violet-300 transition-colors px-1.5 py-0.5 rounded-md bg-violet-500/10 hover:bg-violet-500/15 disabled:opacity-50"
                        >
                          MAX
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <TokenSelector
                    selected={inputToken}
                    tokens={supportedTokens}
                    onSelect={setInputToken}
                    label="Select token"
                    disabled={isSwapping}
                    exclude={outputToken?.symbol}
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={inputAmount}
                    onChange={(e) => { if (/^\d*\.?\d*$/.test(e.target.value)) setInputAmount(e.target.value); }}
                    placeholder="0.0"
                    disabled={isSwapping}
                    className="flex-1 bg-transparent text-right text-2xl font-bold text-white placeholder:text-gray-700/60 outline-none min-w-0 tabular-nums"
                  />
                </div>
              </div>

              {/* ── FLIP BUTTON ──────────────────────────── */}
              <div className="flex justify-center -my-1.5 relative z-10">
                <motion.button
                  onClick={handleFlip}
                  whileHover={{ scale: 1.15, rotate: 180 }}
                  whileTap={{ scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 400, damping: 15 }}
                  className="w-10 h-10 rounded-2xl bg-gradient-to-b from-[#15171e] to-[#0f1117] border border-white/[0.08] flex items-center justify-center hover:border-violet-500/25 transition-colors shadow-xl shadow-black/40 hover:shadow-violet-500/10"
                >
                  <ArrowUpDown className="w-4 h-4 text-gray-400" />
                </motion.button>
              </div>

              {/* ── TO TOKEN OUTPUT ──────────────────────── */}
              <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-white/[0.005] p-4">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">To</span>
                  {estimate && (
                    <span className={cn(
                      "text-[10px] font-medium px-2 py-0.5 rounded-md",
                      estimate.priceImpact > 3
                        ? "bg-orange-500/10 text-orange-400"
                        : estimate.priceImpact > 1
                        ? "bg-yellow-500/10 text-yellow-400"
                        : "bg-emerald-500/10 text-emerald-400"
                    )}>
                      {estimate.priceImpact < 0.01 ? "<0.01" : estimate.priceImpact.toFixed(2)}% impact
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <TokenSelector
                    selected={outputToken}
                    tokens={supportedTokens}
                    onSelect={setOutputToken}
                    label="Select token"
                    disabled={isSwapping}
                    exclude={inputToken?.symbol}
                  />
                  <div className="flex-1 text-right min-w-0">
                    {isEstimating ? (
                      <div className="flex items-center justify-end gap-2">
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        >
                          <Loader2 className="w-5 h-5 text-gray-600" />
                        </motion.div>
                      </div>
                    ) : estimatedOutputDisplay ? (
                      <p className="text-2xl font-bold text-white tabular-nums truncate">
                        {estimatedOutputDisplay}
                      </p>
                    ) : (
                      <p className="text-2xl font-bold text-gray-700/50">0.0</p>
                    )}
                  </div>
                </div>
              </div>

              {/* ── DETAILS ROW ──────────────────────────── */}
              <AnimatePresence>
                {estimate && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-3.5 rounded-xl bg-white/[0.015] border border-white/[0.04] space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-gray-500">Route</span>
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                          {inputToken && <TokenIcon symbol={inputToken.symbol} size="sm" />}
                          <ArrowRight className="w-3 h-3 text-gray-600" />
                          <span className="text-violet-400 font-medium">Ekubo</span>
                          <ArrowRight className="w-3 h-3 text-gray-600" />
                          {outputToken && <TokenIcon symbol={outputToken.symbol} size="sm" />}
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-gray-500">Min. received</span>
                        <span className="text-[11px] text-gray-400 tabular-nums">
                          {(Number(estimate.expectedOutput) * (10000 - effectiveSlippage) / (10000 * 10 ** outputDecimals)).toFixed(6)} {outputToken?.symbol}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-gray-500">Slippage</span>
                        <span className="text-[11px] text-gray-400">{(effectiveSlippage / 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── POOL VALIDATION WARNING ───────────────── */}
              {poolValidationError && (
                <div className="p-3 rounded-xl bg-amber-500/[0.06] border border-amber-500/10 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span className="text-xs text-amber-300/80">{poolValidationError}</span>
                </div>
              )}

              {/* ── ACTION BUTTON ─────────────────────────── */}
              {!isConnected ? (
                <motion.button
                  onClick={() => connectors[0] && connect({ connector: connectors[0] })}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="w-full py-4 rounded-2xl font-semibold text-sm bg-white/[0.06] border border-white/[0.08] text-gray-300 hover:bg-white/[0.1] hover:text-white transition-all"
                >
                  Connect Wallet
                </motion.button>
              ) : !isRouterDeployed ? (
                <div className="w-full py-4 rounded-2xl font-medium text-sm bg-amber-500/[0.05] border border-amber-500/10 text-amber-400/70 text-center flex items-center justify-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Router not deployed on this network
                </div>
              ) : !inputAmount || parseFloat(inputAmount) <= 0 ? (
                <button
                  disabled
                  className="w-full py-4 rounded-2xl font-semibold text-sm bg-white/[0.02] text-gray-600 cursor-not-allowed"
                >
                  Enter an amount
                </button>
              ) : inputToken?.symbol === outputToken?.symbol ? (
                <button
                  disabled
                  className="w-full py-4 rounded-2xl font-semibold text-sm bg-white/[0.02] text-gray-600 cursor-not-allowed"
                >
                  Select different tokens
                </button>
              ) : (
                <motion.button
                  onClick={handleSwap}
                  disabled={!canSwap}
                  whileHover={{ scale: 1.005 }}
                  whileTap={{ scale: 0.995 }}
                  className={cn(
                    "w-full py-4 rounded-2xl font-bold text-sm text-white transition-all relative overflow-hidden group",
                    "bg-gradient-to-r from-violet-600 via-fuchsia-600 to-violet-600 bg-[length:200%_100%]",
                    "hover:shadow-xl hover:shadow-violet-500/20",
                    "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none"
                  )}
                >
                  {/* Shimmer overlay on hover */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out" />
                  <span className="flex items-center justify-center gap-2 relative z-10">
                    <Shield className="w-4 h-4" />
                    Swap {inputToken?.symbol} → {outputToken?.symbol}
                  </span>
                </motion.button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default ShieldedSwapPanel;
