"use client";

/**
 * STWO Proving Flow Card
 *
 * Shows real-time progress of STWO GPU proof generation.
 * Displays Circle STARK metrics, M31 field operations, and security bits.
 *
 * Features:
 * - Real-time progress tracking
 * - GPU vs CPU indicator
 * - Security bits display
 * - FRI layer progress
 * - Estimated time remaining
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  Cpu,
  Shield,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Lock,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProofProgress, ProofResult } from "@/lib/prover/stwoProver";

// ============================================================================
// TYPES
// ============================================================================

export type ProvingStage =
  | "idle"
  | "preparing"
  | "proving"
  | "verifying"
  | "submitting"
  | "confirming"
  | "confirmed"
  | "error";

export interface ProvingFlowCardProps {
  /** Current proving stage */
  stage: ProvingStage;
  /** Proof progress (from STWO prover) */
  progress?: ProofProgress | null;
  /** Proof result (after completion) */
  result?: ProofResult | null;
  /** Error message */
  error?: string | null;
  /** Type of proof being generated */
  proofType?: "range" | "balance" | "transfer" | "deposit" | "withdrawal";
  /** Custom title */
  title?: string;
  /** Callback when done */
  onComplete?: () => void;
  /** Callback to retry on error */
  onRetry?: () => void;
  /** Show compact version */
  compact?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STAGE_CONFIG: Record<ProvingStage, {
  label: string;
  icon: typeof Zap;
  color: string;
  bgColor: string;
}> = {
  idle: {
    label: "Ready",
    icon: Shield,
    color: "text-gray-400",
    bgColor: "bg-gray-500/10",
  },
  preparing: {
    label: "Preparing inputs...",
    icon: RefreshCw,
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
  },
  proving: {
    label: "Generating STARK proof...",
    icon: Zap,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
  },
  verifying: {
    label: "Verifying proof...",
    icon: Shield,
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
  },
  submitting: {
    label: "Submitting to network...",
    icon: Loader2,
    color: "text-violet-400",
    bgColor: "bg-violet-500/10",
  },
  confirming: {
    label: "Waiting for confirmation...",
    icon: Clock,
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
  },
  confirmed: {
    label: "Confirmed!",
    icon: CheckCircle2,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
  },
  error: {
    label: "Error",
    icon: XCircle,
    color: "text-red-400",
    bgColor: "bg-red-500/10",
  },
};

const PROOF_TYPE_LABELS: Record<string, string> = {
  range: "Range Proof",
  balance: "Balance Proof",
  transfer: "Transfer Proof",
  deposit: "Deposit Proof",
  withdrawal: "Withdrawal Proof",
};

// ============================================================================
// COMPONENT
// ============================================================================

export function ProvingFlowCard({
  stage,
  progress,
  result,
  error,
  proofType = "transfer",
  title,
  onComplete,
  onRetry,
  compact = false,
}: ProvingFlowCardProps) {
  const [elapsedTime, setElapsedTime] = useState(0);
  const config = STAGE_CONFIG[stage];
  const Icon = config.icon;

  // Track elapsed time during proving
  useEffect(() => {
    if (stage === "proving" || stage === "preparing" || stage === "submitting") {
      const interval = setInterval(() => {
        setElapsedTime((prev) => prev + 100);
      }, 100);
      return () => clearInterval(interval);
    } else if (stage === "idle") {
      setElapsedTime(0);
    }
  }, [stage]);

  // Determine prover type
  const usedGpu = result?.usedGpu ?? true;
  const securityBits = result?.securityBits ?? progress?.stage === "complete" ? 96 : 0;

  if (compact) {
    return (
      <div className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-xl border transition-all",
        config.bgColor,
        stage === "error" ? "border-red-500/30" : "border-white/10"
      )}>
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center",
          config.bgColor
        )}>
          <Icon className={cn(
            "w-4 h-4",
            config.color,
            stage === "proving" && "animate-pulse"
          )} />
        </div>

        <div className="flex-1 min-w-0">
          <p className={cn("text-sm font-medium", config.color)}>
            {config.label}
          </p>
          {progress && stage === "proving" && (
            <p className="text-xs text-gray-500">
              {progress.substage || `${progress.progress}%`}
            </p>
          )}
        </div>

        {stage === "proving" && (
          <div className="text-xs text-gray-500 font-mono">
            {(elapsedTime / 1000).toFixed(1)}s
          </div>
        )}

        {stage === "confirmed" && result && (
          <div className="text-xs text-emerald-400 font-mono">
            {result.proofTime}ms
          </div>
        )}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card overflow-hidden"
    >
      {/* Header */}
      <div className="p-4 border-b border-surface-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            config.bgColor
          )}>
            <Icon className={cn(
              "w-5 h-5",
              config.color,
              (stage === "proving" || stage === "submitting") && "animate-pulse"
            )} />
          </div>
          <div>
            <h3 className="text-white font-medium">
              {title || PROOF_TYPE_LABELS[proofType] || "Proof Generation"}
            </h3>
            <p className={cn("text-xs", config.color)}>{config.label}</p>
          </div>
        </div>

        {/* Prover Badge */}
        <div className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs",
          usedGpu
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
            : "bg-yellow-500/10 border-yellow-500/20 text-yellow-400"
        )}>
          {usedGpu ? <Zap className="w-3 h-3" /> : <Cpu className="w-3 h-3" />}
          {usedGpu ? "GPU" : "CPU"}
        </div>
      </div>

      {/* Progress */}
      <div className="p-4 space-y-4">
        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">
              {stage === "proving" ? "Circle STARK Generation" : config.label}
            </span>
            <span className={config.color}>
              {progress ? `${progress.progress}%` : stage === "confirmed" ? "100%" : "..."}
            </span>
          </div>

          <div className="h-2 bg-surface-elevated rounded-full overflow-hidden">
            <motion.div
              className={cn(
                "h-full rounded-full",
                stage === "error"
                  ? "bg-red-500"
                  : "bg-gradient-to-r from-emerald-500 to-cyan-500"
              )}
              initial={{ width: 0 }}
              animate={{
                width: progress
                  ? `${progress.progress}%`
                  : stage === "confirmed"
                  ? "100%"
                  : stage === "error"
                  ? "100%"
                  : "0%",
              }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>

        {/* Technical Details */}
        <div className="grid grid-cols-3 gap-2">
          <div className="p-3 rounded-lg bg-surface-elevated/50">
            <p className="text-[10px] text-gray-500 mb-0.5">Field</p>
            <p className="text-xs font-medium text-white">M31</p>
            <p className="text-[10px] text-gray-600">Mersenne Prime</p>
          </div>

          <div className="p-3 rounded-lg bg-surface-elevated/50">
            <p className="text-[10px] text-gray-500 mb-0.5">Protocol</p>
            <p className="text-xs font-medium text-white">Circle STARK</p>
            <p className="text-[10px] text-gray-600">STWO 2.0</p>
          </div>

          <div className="p-3 rounded-lg bg-surface-elevated/50">
            <p className="text-[10px] text-gray-500 mb-0.5">Security</p>
            <p className={cn(
              "text-xs font-medium",
              securityBits >= 96 ? "text-emerald-400" : "text-yellow-400"
            )}>
              {securityBits || "96"} bits
            </p>
            <p className="text-[10px] text-gray-600">Quantum-Safe</p>
          </div>
        </div>

        {/* Stage Details */}
        <AnimatePresence mode="wait">
          {stage === "proving" && progress?.substage && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-3 h-3 text-emerald-400 animate-spin" />
                  <span className="text-xs text-emerald-400">{progress.substage}</span>
                </div>
                <span className="text-xs text-gray-500 font-mono">
                  ~{Math.round((progress.estimatedTimeRemaining || 0) / 1000)}s
                </span>
              </div>
            </motion.div>
          )}

          {stage === "confirmed" && result && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400">Proof Time</span>
                <span className="text-sm font-bold text-emerald-400">
                  {result.proofTime}ms
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Fact Hash</span>
                <span className="text-xs font-mono text-gray-500 truncate max-w-[150px]">
                  {result.factHash.slice(0, 10)}...{result.factHash.slice(-6)}
                </span>
              </div>
            </motion.div>
          )}

          {stage === "error" && error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="p-3 rounded-lg bg-red-500/10 border border-red-500/20"
            >
              <p className="text-xs text-red-400">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Actions */}
        {(stage === "confirmed" || stage === "error") && (
          <div className="flex gap-2 pt-2">
            {stage === "confirmed" && onComplete && (
              <button
                onClick={onComplete}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                Done
              </button>
            )}

            {stage === "error" && onRetry && (
              <button
                onClick={onRetry}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
            )}
          </div>
        )}

        {/* Timing */}
        {(stage === "proving" || stage === "preparing" || stage === "submitting") && (
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
            <Clock className="w-3 h-3" />
            <span className="font-mono">{(elapsedTime / 1000).toFixed(1)}s elapsed</span>
          </div>
        )}
      </div>

      {/* Privacy Indicator */}
      <div className="px-4 py-2 border-t border-surface-border bg-surface-elevated/30">
        <div className="flex items-center justify-center gap-2 text-xs text-cyan-400">
          <Lock className="w-3 h-3" />
          <span>Zero-Knowledge • Client-Side Encryption • On-Chain Verification</span>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// PROVING STEPS COMPONENT
// ============================================================================

interface ProvingStep {
  key: string;
  label: string;
  description?: string;
}

const DEFAULT_PROVING_STEPS: ProvingStep[] = [
  { key: "prepare", label: "Prepare Inputs", description: "Encrypting data" },
  { key: "range", label: "Range Proof", description: "Amount validation" },
  { key: "balance", label: "Balance Proof", description: "Sufficient funds" },
  { key: "transfer", label: "Transfer Proof", description: "State transition" },
  { key: "verify", label: "Verify", description: "On-chain verification" },
  { key: "confirm", label: "Confirm", description: "Transaction confirmed" },
];

export function ProvingStepsCard({
  currentStep,
  steps = DEFAULT_PROVING_STEPS,
  proofTimes = {},
}: {
  currentStep: string;
  steps?: ProvingStep[];
  proofTimes?: Record<string, number>;
}) {
  const currentIndex = steps.findIndex((s) => s.key === currentStep);

  return (
    <div className="glass-card p-4">
      <div className="space-y-3">
        {steps.map((step, idx) => {
          const isCompleted = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          const proofTime = proofTimes[step.key];

          return (
            <div key={step.key} className="flex items-start gap-3">
              {/* Step Indicator */}
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all",
                    isCompleted
                      ? "bg-emerald-500 border-emerald-500"
                      : isCurrent
                      ? "border-emerald-500 bg-surface-elevated"
                      : "border-gray-600 bg-surface-elevated"
                  )}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-3 h-3 text-white" />
                  ) : isCurrent ? (
                    <Loader2 className="w-3 h-3 text-emerald-400 animate-spin" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-gray-600" />
                  )}
                </div>
                {idx < steps.length - 1 && (
                  <div
                    className={cn(
                      "w-0.5 h-6 my-1",
                      isCompleted ? "bg-emerald-500" : "bg-surface-border"
                    )}
                  />
                )}
              </div>

              {/* Step Content */}
              <div className="flex-1 pt-0.5">
                <div className="flex items-center justify-between">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      isCompleted || isCurrent ? "text-white" : "text-gray-500"
                    )}
                  >
                    {step.label}
                  </p>
                  {isCompleted && proofTime && (
                    <span className="text-xs text-emerald-400 font-mono">
                      {proofTime}ms
                    </span>
                  )}
                </div>
                {step.description && (
                  <p className="text-xs text-gray-500">{step.description}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
