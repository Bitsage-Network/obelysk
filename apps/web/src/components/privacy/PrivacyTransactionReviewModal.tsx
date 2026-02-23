"use client";

/**
 * Privacy Transaction Review Modal
 *
 * Tongo-style "Review & Sign" interstitial that intercepts all privacy
 * operations with a clear breakdown of what's on-chain vs. hidden.
 *
 * Phases: review -> signing -> executing -> confirmed | error
 */

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Lock,
  Eye,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ExternalLink,
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowUpDown,
  Gavel,
  Send,
  Fingerprint,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNetwork } from "@/lib/contexts/NetworkContext";
import { getExplorerTxUrl, type NetworkType } from "@/lib/contracts/addresses";

// ============================================================================
// TYPES
// ============================================================================

export interface PrivacyTransactionReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<string>; // Returns txHash

  operationType:
    | "deposit"
    | "withdraw"
    | "swap"
    | "commit"
    | "reveal"
    | "settle"
    | "claim"
    | "transfer";
  title: string;
  description: string;

  details: Array<{ label: string; value: string; isAddress?: boolean }>;

  privacyInfo: {
    identityHidden: boolean;
    amountHidden: boolean;
    recipientHidden: boolean;
    proofType?: string;
    whatIsOnChain: string[];
    whatIsHidden: string[];
  };

  warnings?: string[];
  className?: string;
}

type ReviewPhase = "review" | "signing" | "executing" | "confirmed" | "error";

// ============================================================================
// CONSTANTS
// ============================================================================

const OPERATION_ICONS: Record<string, typeof Shield> = {
  deposit: ArrowDownToLine,
  withdraw: ArrowUpFromLine,
  swap: ArrowUpDown,
  commit: Lock,
  reveal: Eye,
  settle: Gavel,
  claim: CheckCircle2,
  transfer: Send,
};

const OPERATION_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  deposit: { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  withdraw: { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  swap: { text: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
  commit: { text: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
  reveal: { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  settle: { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  claim: { text: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20" },
  transfer: { text: "text-fuchsia-400", bg: "bg-fuchsia-500/10", border: "border-fuchsia-500/20" },
};

// ============================================================================
// COMPONENT
// ============================================================================

export function PrivacyTransactionReviewModal({
  isOpen,
  onClose,
  onConfirm,
  operationType,
  title,
  description,
  details,
  privacyInfo,
  warnings,
  className,
}: PrivacyTransactionReviewModalProps) {
  const { network } = useNetwork();
  const [phase, setPhase] = useState<ReviewPhase>("review");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const OpIcon = OPERATION_ICONS[operationType] || Shield;
  const colors = OPERATION_COLORS[operationType] || OPERATION_COLORS.deposit;

  const handleSign = async () => {
    setPhase("signing");
    setError(null);
    try {
      setPhase("executing");
      const hash = await onConfirm();
      setTxHash(hash);
      setPhase("confirmed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction failed");
      setPhase("error");
    }
  };

  const handleClose = () => {
    setPhase("review");
    setTxHash(null);
    setError(null);
    onClose();
  };

  const handleRetry = () => {
    setPhase("review");
    setError(null);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={phase === "review" || phase === "confirmed" || phase === "error" ? handleClose : undefined}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", duration: 0.4 }}
            className={cn(
              "relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-gray-900 shadow-2xl shadow-black/50 overflow-hidden",
              className,
            )}
          >
            <AnimatePresence mode="wait">
              {/* ============================================================ */}
              {/* PHASE: REVIEW                                                */}
              {/* ============================================================ */}
              {phase === "review" && (
                <motion.div
                  key="review"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, x: -20 }}
                >
                  {/* Header */}
                  <div className="px-6 pt-5 pb-4 border-b border-white/[0.06]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border", colors.bg, colors.border)}>
                          <OpIcon className={cn("w-5 h-5", colors.text)} />
                        </div>
                        <div>
                          <h3 className="text-base font-semibold text-white">{title}</h3>
                          <p className="text-xs text-gray-500">{description}</p>
                        </div>
                      </div>
                      <button
                        onClick={handleClose}
                        className="p-1.5 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Transaction Details */}
                  <div className="px-6 py-4 space-y-3">
                    <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                      Transaction Details
                    </h4>
                    <div className="space-y-2">
                      {details.map((detail) => (
                        <div key={detail.label} className="flex items-center justify-between py-1.5">
                          <span className="text-xs text-gray-500">{detail.label}</span>
                          <span
                            className={cn(
                              "text-sm font-medium text-white",
                              detail.isAddress && "font-mono text-xs",
                            )}
                          >
                            {detail.isAddress
                              ? `${detail.value.slice(0, 8)}...${detail.value.slice(-6)}`
                              : detail.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Privacy Disclosure */}
                  <div className="px-6 pb-4">
                    <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">
                      Privacy Disclosure
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      {/* On-chain (visible) */}
                      <div className="rounded-xl bg-gray-800/50 border border-white/10 p-3">
                        <div className="flex items-center gap-1.5 mb-2.5">
                          <Eye className="w-3.5 h-3.5 text-gray-400" />
                          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                            Visible on-chain
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {privacyInfo.whatIsOnChain.map((item) => (
                            <div key={item} className="flex items-center gap-1.5">
                              <div className="w-1 h-1 rounded-full bg-gray-500" />
                              <span className="text-[11px] text-gray-400">{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Hidden (encrypted) */}
                      <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3">
                        <div className="flex items-center gap-1.5 mb-2.5">
                          <Lock className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
                            Hidden
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {privacyInfo.whatIsHidden.map((item) => (
                            <div key={item} className="flex items-center gap-1.5">
                              <div className="w-1 h-1 rounded-full bg-emerald-500" />
                              <span className="text-[11px] text-emerald-400">{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Proof type badge */}
                    {privacyInfo.proofType && (
                      <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500/5 border border-violet-500/15">
                        <Fingerprint className="w-3.5 h-3.5 text-violet-400" />
                        <span className="text-[11px] text-violet-400">
                          Proof: {privacyInfo.proofType}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Warnings */}
                  {warnings && warnings.length > 0 && (
                    <div className="px-6 pb-4">
                      {warnings.map((warning) => (
                        <div
                          key={warning}
                          className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/15"
                        >
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                          <span className="text-[11px] text-amber-400">{warning}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Footer Actions */}
                  <div className="px-6 py-4 border-t border-white/[0.06] flex gap-3">
                    <button
                      onClick={handleClose}
                      className="flex-1 py-3 rounded-xl text-sm font-medium text-gray-400 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSign}
                      className="flex-1 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 transition-all shadow-lg shadow-violet-500/20 flex items-center justify-center gap-2"
                    >
                      <KeyRound className="w-4 h-4" />
                      Sign & Submit
                    </button>
                  </div>
                </motion.div>
              )}

              {/* ============================================================ */}
              {/* PHASE: SIGNING                                               */}
              {/* ============================================================ */}
              {phase === "signing" && (
                <motion.div
                  key="signing"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="px-6 py-12 text-center"
                >
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    className="inline-flex"
                  >
                    <Loader2 className="w-12 h-12 text-violet-400" />
                  </motion.div>
                  <h3 className="text-lg font-semibold text-white mt-4">
                    Awaiting Wallet Signature
                  </h3>
                  <p className="text-sm text-gray-500 mt-2">
                    Please confirm the transaction in your wallet...
                  </p>
                </motion.div>
              )}

              {/* ============================================================ */}
              {/* PHASE: EXECUTING                                             */}
              {/* ============================================================ */}
              {phase === "executing" && (
                <motion.div
                  key="executing"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="px-6 py-12 text-center"
                >
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="inline-flex"
                  >
                    <Shield className="w-12 h-12 text-cyan-400" />
                  </motion.div>
                  <h3 className="text-lg font-semibold text-white mt-4">
                    Transaction Submitted
                  </h3>
                  <p className="text-sm text-gray-500 mt-2">
                    Waiting for on-chain confirmation...
                  </p>
                  <div className="mt-4 flex justify-center">
                    <div className="h-1 w-32 bg-gray-800 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-cyan-500 to-violet-500 rounded-full"
                        initial={{ width: "5%" }}
                        animate={{ width: "90%" }}
                        transition={{ duration: 8, ease: "easeOut" }}
                      />
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ============================================================ */}
              {/* PHASE: CONFIRMED                                             */}
              {/* ============================================================ */}
              {phase === "confirmed" && (
                <motion.div
                  key="confirmed"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="px-6 py-10 text-center"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", delay: 0.1 }}
                    className="inline-flex w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 items-center justify-center"
                  >
                    <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                  </motion.div>
                  <h3 className="text-lg font-semibold text-white mt-4">
                    Transaction Confirmed
                  </h3>

                  {txHash && (
                    <a
                      href={getExplorerTxUrl(txHash, network as NetworkType)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 mt-3 text-sm text-violet-400 hover:text-violet-300 transition-colors"
                    >
                      <span className="font-mono text-xs">
                        {txHash.slice(0, 10)}...{txHash.slice(-6)}
                      </span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}

                  <button
                    onClick={handleClose}
                    className="mt-6 w-full py-3 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors"
                  >
                    Done
                  </button>
                </motion.div>
              )}

              {/* ============================================================ */}
              {/* PHASE: ERROR                                                 */}
              {/* ============================================================ */}
              {phase === "error" && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="px-6 py-10 text-center"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", delay: 0.1 }}
                    className="inline-flex w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 items-center justify-center"
                  >
                    <AlertTriangle className="w-8 h-8 text-red-400" />
                  </motion.div>
                  <h3 className="text-lg font-semibold text-white mt-4">
                    Transaction Failed
                  </h3>
                  {error && (
                    <p className="text-sm text-red-400 mt-2 px-4 break-words">
                      {error}
                    </p>
                  )}
                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={handleClose}
                      className="flex-1 py-3 rounded-xl text-sm font-medium text-gray-400 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                    >
                      Close
                    </button>
                    <button
                      onClick={handleRetry}
                      className="flex-1 py-3 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ============================================================================
// COMPANION HOOK
// ============================================================================

export function usePrivacyTransactionReview() {
  const [isOpen, setIsOpen] = useState(false);
  const [props, setProps] = useState<Omit<
    PrivacyTransactionReviewModalProps,
    "isOpen" | "onClose"
  > | null>(null);

  const review = useCallback(
    (p: Omit<PrivacyTransactionReviewModalProps, "isOpen" | "onClose">) => {
      setProps(p);
      setIsOpen(true);
    },
    [],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    setProps(null);
  }, []);

  return { isOpen, props, review, close };
}
