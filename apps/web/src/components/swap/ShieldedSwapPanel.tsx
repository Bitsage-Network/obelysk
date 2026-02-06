"use client";

/**
 * Shielded Swap Panel
 *
 * Privacy-preserving token swap interface for Ekubo AMM integration.
 * Routes swaps through the ShieldedSwapRouter — the user's identity
 * never appears on-chain as the swap participant.
 *
 * Flow: Privacy Pool (withdraw) → Ekubo AMM (swap) → Privacy Pool (deposit)
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
}: {
  selected: TokenOption | null;
  tokens: TokenOption[];
  onSelect: (token: TokenOption) => void;
  disabled?: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={cn(
          "flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all min-w-[130px]",
          open
            ? "border-violet-500/50 bg-violet-500/10"
            : "border-white/10 bg-white/5 hover:border-white/20",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        {selected ? (
          <>
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-white/10 to-white/5 border border-white/10 flex items-center justify-center text-[10px] font-bold text-white/80">
              {selected.symbol.charAt(0)}
            </div>
            <span className="text-sm font-semibold text-white">{selected.symbol}</span>
          </>
        ) : (
          <span className="text-sm text-gray-500">{label}</span>
        )}
        <ChevronDown className={cn(
          "w-3.5 h-3.5 text-gray-500 ml-auto transition-transform",
          open && "rotate-180"
        )} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 top-full mt-1.5 left-0 right-0 rounded-xl border border-white/10 bg-[#0d0f14]/95 backdrop-blur-xl shadow-2xl shadow-black/40 overflow-hidden"
          >
            {tokens.map((token) => {
              const meta = TOKEN_METADATA[token.symbol as keyof typeof TOKEN_METADATA];
              return (
                <button
                  key={token.symbol}
                  onClick={() => { onSelect(token); setOpen(false); }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors",
                    selected?.symbol === token.symbol
                      ? "bg-violet-500/10"
                      : "hover:bg-white/5",
                    !token.hasPool && "opacity-40 cursor-not-allowed"
                  )}
                  disabled={!token.hasPool}
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-white/10 to-white/5 border border-white/10 flex items-center justify-center text-[11px] font-bold text-white/80 shrink-0">
                    {token.symbol.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{token.symbol}</p>
                    <p className="text-[10px] text-gray-500 truncate">{meta?.name || token.symbol}</p>
                  </div>
                  {!token.hasPool && (
                    <span className="text-[9px] text-gray-600 bg-gray-800/50 px-1.5 py-0.5 rounded">
                      No Pool
                    </span>
                  )}
                  {selected?.symbol === token.symbol && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// COMPONENT
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

  // Privacy pool balance for input token
  const [privacyBalance, setPrivacyBalance] = useState<number | null>(null);

  // Pool validation
  const [poolValidationError, setPoolValidationError] = useState<string | null>(null);

  // Slippage
  const [slippageBps, setSlippageBps] = useState(100); // 1% default
  const [customSlippage, setCustomSlippage] = useState("");
  const [showCustomSlippage, setShowCustomSlippage] = useState(false);

  // Privacy info expanded
  const [showPrivacyInfo, setShowPrivacyInfo] = useState(false);

  // Auto-select defaults
  useEffect(() => {
    if (supportedTokens.length >= 2 && !inputToken) {
      const sage = supportedTokens.find((t) => t.symbol === "SAGE");
      const eth = supportedTokens.find((t) => t.symbol === "ETH");
      if (sage) setInputToken(sage);
      if (eth) setOutputToken(eth);
    }
  }, [supportedTokens, inputToken]);

  // Fetch privacy pool balance when input token changes
  useEffect(() => {
    if (!address || !inputToken) {
      setPrivacyBalance(null);
      return;
    }
    let cancelled = false;
    getPrivacyPoolBalance(inputToken.symbol).then((bal) => {
      if (!cancelled) setPrivacyBalance(bal);
    });
    return () => { cancelled = true; };
  }, [address, inputToken, getPrivacyPoolBalance, state.stage]);

  // Validate pool prerequisites when tokens change
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
      const est = await estimateOutput(
        inputToken.address,
        outputToken.address,
        inputAmount,
        decimals
      );
      setEstimate(est);
      setIsEstimating(false);
    }, 400);

    return () => clearTimeout(timer);
  }, [inputToken, outputToken, inputAmount, estimateOutput]);

  // Flip tokens
  const handleFlip = useCallback(() => {
    const prevInput = inputToken;
    const prevOutput = outputToken;
    setInputToken(prevOutput);
    setOutputToken(prevInput);
    setInputAmount("");
    setEstimate(null);
  }, [inputToken, outputToken]);

  // Handle swap execution
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

  const poolsValid = !poolValidationError;
  const canSwap =
    isConnected &&
    inputToken &&
    outputToken &&
    inputToken.symbol !== outputToken.symbol &&
    parseFloat(inputAmount) > 0 &&
    !isSwapping &&
    poolsValid;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600/30 to-fuchsia-600/20 border border-violet-500/20 flex items-center justify-center">
            <Shield className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h3 className="text-white font-semibold text-base">Shielded Swap</h3>
            <p className="text-[11px] text-gray-500">Private swaps via Ekubo AMM</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-500/10 border border-violet-500/20">
          <Lock className="w-3 h-3 text-violet-400" />
          <span className="text-[10px] font-medium text-violet-400">Identity Hidden</span>
        </div>
      </div>

      {/* Active swap flow — proving / submitting / confirming / result */}
      <AnimatePresence mode="wait">
        {isActive ? (
          <motion.div
            key="swap-active"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="space-y-4"
          >
            {/* Progress flow card */}
            <ProvingFlowCard
              stage={toProvingStage(state.stage)}
              proofType="withdrawal"
              title="Shielded Swap"
              result={state.provingTimeMs ? {
                factHash: state.txHash || "0x0",
                proofTime: state.provingTimeMs,
                securityBits: 96,
                usedGpu: true,
                proverId: "bitsage-stwo-01",
              } : null}
              error={state.error}
              onRetry={reset}
            />

            {/* Swap summary */}
            {(isComplete || isSwapping) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-gray-500 uppercase tracking-wider">Swap Details</span>
                  <span className="text-xs text-gray-600">
                    {state.progress}%
                  </span>
                </div>

                {/* Progress bar */}
                <div className="h-1 bg-white/5 rounded-full overflow-hidden mb-4">
                  <motion.div
                    className={cn(
                      "h-full rounded-full",
                      hasError
                        ? "bg-red-500"
                        : isComplete
                        ? "bg-emerald-500"
                        : "bg-gradient-to-r from-violet-500 to-fuchsia-500"
                    )}
                    initial={{ width: 0 }}
                    animate={{ width: `${state.progress}%` }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  />
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Input</span>
                    <span className="text-sm font-medium text-white">
                      {state.inputAmount || inputAmount} {inputToken?.symbol}
                    </span>
                  </div>
                  {state.outputAmount && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Output</span>
                      <span className="text-sm font-medium text-emerald-400">
                        {state.outputAmount}
                      </span>
                    </div>
                  )}
                  {state.provingTimeMs && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Proof Time</span>
                      <span className="text-sm font-medium text-cyan-400">
                        {state.provingTimeMs}ms
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Status</span>
                    <span className={cn(
                      "text-xs font-medium",
                      isComplete ? "text-emerald-400" : hasError ? "text-red-400" : "text-violet-400"
                    )}>
                      {state.message}
                    </span>
                  </div>
                </div>

                {/* Explorer link */}
                {state.txHash && (
                  <div className="mt-3 pt-3 border-t border-white/[0.06]">
                    <a
                      href={`${explorerUrl}/tx/${state.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                    >
                      View on Starkscan
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </motion.div>
            )}

            {/* Action button */}
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={isComplete || hasError ? reset : undefined}
              disabled={isSwapping}
              className={cn(
                "w-full py-4 rounded-xl font-semibold transition-all text-sm",
                isComplete
                  ? "bg-gradient-to-r from-emerald-600 to-violet-600 text-white hover:shadow-lg hover:shadow-emerald-500/20"
                  : hasError
                  ? "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                  : "bg-white/5 text-gray-500 cursor-not-allowed"
              )}
            >
              {isComplete ? (
                <span className="flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4" />
                  Swap Again
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
          /* ================================================================
             SWAP FORM — idle state
             ================================================================ */
          <motion.div
            key="swap-form"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="space-y-3"
          >
            {/* ── Input Token ─────────────────────────────── */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500">From (Privacy Pool)</span>
                {inputToken && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-600">
                      Balance: {privacyBalance !== null ? `${privacyBalance.toFixed(4)} ${inputToken.symbol}` : "--"}
                    </span>
                    {privacyBalance !== null && privacyBalance > 0 && (
                      <button
                        onClick={() => setInputAmount(privacyBalance.toString())}
                        disabled={isSwapping}
                        className="text-[10px] font-semibold text-violet-400 hover:text-violet-300 transition-colors disabled:opacity-50"
                      >
                        Max
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
                  label="Select"
                  disabled={isSwapping}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  value={inputAmount}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (/^\d*\.?\d*$/.test(val)) setInputAmount(val);
                  }}
                  placeholder="0.0"
                  disabled={isSwapping}
                  className="flex-1 bg-transparent text-right text-xl font-semibold text-white placeholder:text-gray-700 outline-none min-w-0"
                />
              </div>
            </div>

            {/* ── Flip Button ─────────────────────────────── */}
            <div className="flex justify-center -my-1.5 relative z-10">
              <motion.button
                onClick={handleFlip}
                whileHover={{ rotate: 180, scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                transition={{ type: "spring", stiffness: 300, damping: 15 }}
                className="w-9 h-9 rounded-xl bg-[#111318] border border-white/[0.08] flex items-center justify-center hover:border-violet-500/30 transition-colors shadow-lg shadow-black/30"
              >
                <ArrowUpDown className="w-4 h-4 text-gray-400" />
              </motion.button>
            </div>

            {/* ── Output Token ─────────────────────────────── */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500">To (Privacy Pool)</span>
                {estimate && (
                  <span className={cn(
                    "text-[10px]",
                    estimate.priceImpact > 3 ? "text-orange-400" : "text-gray-600"
                  )}>
                    Impact: {estimate.priceImpact.toFixed(2)}%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <TokenSelector
                  selected={outputToken}
                  tokens={supportedTokens}
                  onSelect={setOutputToken}
                  label="Select"
                  disabled={isSwapping}
                />
                <div className="flex-1 text-right min-w-0">
                  {isEstimating ? (
                    <div className="flex items-center justify-end gap-2">
                      <Loader2 className="w-4 h-4 text-gray-600 animate-spin" />
                      <span className="text-sm text-gray-600">Estimating...</span>
                    </div>
                  ) : estimatedOutputDisplay ? (
                    <p className="text-xl font-semibold text-white truncate">
                      {estimatedOutputDisplay}
                    </p>
                  ) : (
                    <p className="text-xl font-semibold text-gray-700">0.0</p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Swap Details ─────────────────────────────── */}
            {estimate && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500">Route</span>
                  <span className="text-[11px] text-gray-400 font-mono truncate max-w-[200px]">
                    {inputToken?.symbol} → Ekubo → {outputToken?.symbol}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500">Min. Received</span>
                  <span className="text-[11px] text-gray-400">
                    {(Number(estimate.expectedOutput) * (10000 - slippageBps) / (10000 * 10 ** outputDecimals)).toFixed(6)} {outputToken?.symbol}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500">Network Fee</span>
                  <span className="text-[11px] text-gray-400">
                    {(Number(estimate.fee) / 10 ** 18).toFixed(8)}
                  </span>
                </div>
              </motion.div>
            )}

            {/* ── Slippage Selector ─────────────────────────── */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 shrink-0">Slippage</span>
              <div className="flex gap-1 flex-1">
                {SLIPPAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setSlippageBps(opt.value); setShowCustomSlippage(false); }}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-all",
                      slippageBps === opt.value && !showCustomSlippage
                        ? "bg-violet-500/15 text-violet-400 border border-violet-500/25"
                        : "bg-white/[0.03] text-gray-500 border border-transparent hover:bg-white/[0.06]"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
                <button
                  onClick={() => setShowCustomSlippage(!showCustomSlippage)}
                  className={cn(
                    "flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-all",
                    showCustomSlippage
                      ? "bg-violet-500/15 text-violet-400 border border-violet-500/25"
                      : "bg-white/[0.03] text-gray-500 border border-transparent hover:bg-white/[0.06]"
                  )}
                >
                  Custom
                </button>
              </div>
            </div>

            {showCustomSlippage && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={customSlippage}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/^\d*\.?\d*$/.test(v)) setCustomSlippage(v);
                  }}
                  placeholder="e.g. 150"
                  className="flex-1 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-sm text-white placeholder:text-gray-700 outline-none focus:border-violet-500/30"
                />
                <span className="text-xs text-gray-500">bps</span>
              </motion.div>
            )}

            {/* ── Pool Validation Warning ─────────────────── */}
            {poolValidationError && (
              <div className="p-3 rounded-xl bg-yellow-500/[0.06] border border-yellow-500/15 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                <span className="text-xs text-yellow-400/90">{poolValidationError}</span>
              </div>
            )}

            {/* ── Privacy Info Banner ──────────────────────── */}
            <button
              onClick={() => setShowPrivacyInfo(!showPrivacyInfo)}
              className="w-full p-3 rounded-xl bg-violet-500/[0.06] border border-violet-500/10 text-left transition-colors hover:bg-violet-500/[0.09]"
            >
              <div className="flex items-center gap-2.5">
                <Shield className="w-4 h-4 text-violet-400 shrink-0" />
                <span className="text-xs font-medium text-violet-300 flex-1">
                  Privacy Model
                </span>
                <ChevronDown className={cn(
                  "w-3.5 h-3.5 text-violet-500 transition-transform",
                  showPrivacyInfo && "rotate-180"
                )} />
              </div>

              <AnimatePresence>
                {showPrivacyInfo && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-3 space-y-2 overflow-hidden"
                  >
                    <div className="flex items-start gap-2">
                      <div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center mt-0.5 shrink-0">
                        <Lock className="w-2.5 h-2.5 text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-[11px] font-medium text-emerald-400">Identity Hidden</p>
                        <p className="text-[10px] text-gray-500">Only the router contract appears on-chain as the swap participant.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-4 h-4 rounded-full bg-yellow-500/20 flex items-center justify-center mt-0.5 shrink-0">
                        <Eye className="w-2.5 h-2.5 text-yellow-400" />
                      </div>
                      <div>
                        <p className="text-[11px] font-medium text-yellow-400">Amounts Visible</p>
                        <p className="text-[10px] text-gray-500">Ekubo AMM requires plaintext amounts for constant-product math.</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </button>

            {/* ── Action Button ─────────────────────────────── */}
            {!isConnected ? (
              <button
                onClick={() => connectors[0] && connect({ connector: connectors[0] })}
                className="w-full py-4 rounded-xl font-semibold text-sm bg-white/[0.06] border border-white/[0.08] text-gray-400 hover:bg-white/[0.1] hover:text-white transition-all"
              >
                Connect Wallet
              </button>
            ) : !isRouterDeployed ? (
              <div className="w-full py-4 rounded-xl font-medium text-sm bg-yellow-500/[0.06] border border-yellow-500/10 text-yellow-500/80 text-center">
                <div className="flex items-center justify-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Router not deployed on this network
                </div>
              </div>
            ) : !inputAmount || parseFloat(inputAmount) <= 0 ? (
              <button
                disabled
                className="w-full py-4 rounded-xl font-semibold text-sm bg-white/[0.03] text-gray-600 cursor-not-allowed"
              >
                Enter an amount
              </button>
            ) : inputToken?.symbol === outputToken?.symbol ? (
              <button
                disabled
                className="w-full py-4 rounded-xl font-semibold text-sm bg-white/[0.03] text-gray-600 cursor-not-allowed"
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
                  "w-full py-4 rounded-xl font-semibold text-sm text-white transition-all relative overflow-hidden",
                  "bg-gradient-to-r from-violet-600 to-fuchsia-600",
                  "hover:shadow-lg hover:shadow-violet-500/20",
                  "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
                )}
              >
                <span className="flex items-center justify-center gap-2 relative z-10">
                  <Shield className="w-4 h-4" />
                  Swap {inputAmount} {inputToken?.symbol} → {outputToken?.symbol}
                </span>
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ShieldedSwapPanel;
