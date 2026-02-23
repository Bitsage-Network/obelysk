/**
 * Gasless Deposit Panel
 *
 * Complete deposit UI with:
 * - Denomination selection
 * - Gas payment method selection (wallet, sponsored, pay-in-token)
 * - Real-time proving flow visualization
 * - Session status indicator
 */

"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDownToLine,
  Zap,
  Wallet,
  Shield,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ExternalLink,
  RefreshCw,
  Lock,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccount } from "@starknet-react/core";
import { useNetwork } from "@/lib/contexts/NetworkContext";
import { getExplorerTxUrl, type NetworkType } from "@/lib/contracts/addresses";
import {
  useGaslessPrivacyDeposit,
  type GasPaymentMethod,
} from "@/lib/hooks/useGaslessPrivacyDeposit";
import { PRIVACY_DENOMINATIONS, type PrivacyDenomination } from "@/lib/crypto";
import { ProvingFlowCard, type ProvingStage } from "./ProvingFlowCard";
import {
  PrivacyTransactionReviewModal,
  usePrivacyTransactionReview,
} from "./PrivacyTransactionReviewModal";

// ============================================================================
// TYPES
// ============================================================================

interface GaslessDepositPanelProps {
  onSuccess?: (txHash: string) => void;
  onError?: (error: string) => void;
  className?: string;
}

// ============================================================================
// GAS METHOD OPTIONS
// ============================================================================

const GAS_METHODS: {
  id: GasPaymentMethod;
  label: string;
  description: string;
  icon: typeof Wallet;
  badge?: string;
  badgeColor?: string;
}[] = [
  {
    id: "wallet",
    label: "Wallet",
    description: "Pay gas in STRK",
    icon: Wallet,
  },
  {
    id: "sponsored",
    label: "Free",
    description: "AVNU sponsored",
    icon: Sparkles,
    badge: "FREE",
    badgeColor: "bg-emerald-500/20 text-emerald-400",
  },
  {
    id: "pay-strk",
    label: "STRK",
    description: "Gasless in STRK",
    icon: Zap,
  },
  {
    id: "pay-usdc",
    label: "USDC",
    description: "Gasless in USDC",
    icon: Zap,
  },
];

// ============================================================================
// COMPONENT
// ============================================================================

export function GaslessDepositPanel({
  onSuccess,
  onError,
  className,
}: GaslessDepositPanelProps) {
  const { isConnected } = useAccount();
  const { network } = useNetwork();
  const {
    state,
    deposit,
    reset,
    isPaymasterAvailable,
    checkSponsoredEligibility,
    sessionStatus,
  } = useGaslessPrivacyDeposit();

  const [selectedDenomination, setSelectedDenomination] = useState<PrivacyDenomination>(10);
  const [selectedGasMethod, setSelectedGasMethod] = useState<GasPaymentMethod>("wallet");
  const [sponsoredEligible, setSponsoredEligible] = useState(false);
  const [isCheckingEligibility, setIsCheckingEligibility] = useState(false);
  const txReview = usePrivacyTransactionReview();

  // Check sponsored eligibility on mount
  useEffect(() => {
    const checkEligibility = async () => {
      if (!isConnected) return;
      setIsCheckingEligibility(true);
      try {
        const eligible = await checkSponsoredEligibility();
        setSponsoredEligible(eligible);
        // Auto-select sponsored if eligible
        if (eligible) {
          setSelectedGasMethod("sponsored");
        }
      } catch {
        // Ignore errors
      } finally {
        setIsCheckingEligibility(false);
      }
    };
    checkEligibility();
  }, [isConnected, checkSponsoredEligibility]);

  // Handle deposit — shows review modal first
  const handleDeposit = () => {
    txReview.review({
      operationType: "deposit",
      title: "Privacy Pool Deposit",
      description: `Deposit ${selectedDenomination} SAGE into the privacy pool`,
      details: [
        { label: "Amount", value: `${selectedDenomination} SAGE` },
        { label: "Gas", value: selectedGasMethod === "sponsored" ? "Free (Sponsored)" : selectedGasMethod.toUpperCase() },
      ],
      privacyInfo: {
        identityHidden: false,
        amountHidden: true,
        recipientHidden: false,
        proofType: "Pedersen Commitment + ElGamal Encryption",
        whatIsOnChain: ["Commitment hash", "Encrypted amount ciphertext"],
        whatIsHidden: ["Exact deposit amount", "Blinding factor"],
      },
      onConfirm: async () => {
        const txHash = await deposit({
          denomination: selectedDenomination,
          gasMethod: selectedGasMethod,
        });
        onSuccess?.(txHash);
        return txHash;
      },
    });
  };

  // Determine if actively depositing
  const isDepositing = state.stage !== "idle" && state.stage !== "confirmed" && state.stage !== "error";
  const isComplete = state.stage === "confirmed";
  const hasError = state.stage === "error";

  return (
    <div className={cn("space-y-6", className)}>
      {/* Session Status Banner */}
      {sessionStatus.isActive && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20"
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Lock className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-emerald-400">Session Active</p>
            <p className="text-xs text-gray-400">
              {Math.floor(sessionStatus.timeRemaining / 60)}m remaining
            </p>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs">
            <Zap className="w-3 h-3 inline mr-1" />
            Fast Mode
          </span>
        </motion.div>
      )}

      {/* Showing Proving Flow when active */}
      <AnimatePresence mode="wait">
        {(isDepositing || isComplete || hasError) ? (
          <motion.div
            key="proving-flow"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <ProvingFlowCard
              stage={state.stage}
              proofType="deposit"
              result={state.provingTimeMs ? {
                factHash: state.commitment || "",
                proofTime: state.provingTimeMs,
                securityBits: 96,
                usedGpu: true,
                proverId: "bitsage-stwo-01",
              } : null}
              error={state.error}
              onRetry={reset}
            />

            {/* Transaction Details */}
            {isComplete && state.txHash && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-4 p-4 rounded-lg bg-surface-elevated border border-surface-border"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Amount</span>
                    <span className="text-sm font-medium text-white">
                      {selectedDenomination} SAGE
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Gas</span>
                    <span className={cn(
                      "text-sm font-medium",
                      state.gasSponsored ? "text-emerald-400" : "text-white"
                    )}>
                      {state.gasSponsored ? "Sponsored (Free)" : selectedGasMethod.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Proof Time</span>
                    <span className="text-sm font-medium text-violet-400">
                      {state.provingTimeMs}ms
                    </span>
                  </div>
                  <div className="pt-2 border-t border-surface-border">
                    <a
                      href={getExplorerTxUrl(state.txHash, network as NetworkType)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300"
                    >
                      View on Starkscan
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Action Button */}
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={isComplete || hasError ? reset : undefined}
              disabled={isDepositing}
              className={cn(
                "mt-4 w-full py-4 rounded-xl font-semibold transition-all",
                isComplete
                  ? "bg-gradient-to-r from-emerald-600 to-violet-600 text-white hover:shadow-lg"
                  : hasError
                  ? "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
                  : "bg-gray-600 text-gray-400 cursor-not-allowed"
              )}
            >
              {isComplete ? (
                <span className="flex items-center justify-center gap-2">
                  <RefreshCw className="w-5 h-5" />
                  Deposit Another
                </span>
              ) : hasError ? (
                <span className="flex items-center justify-center gap-2">
                  <RefreshCw className="w-5 h-5" />
                  Try Again
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing...
                </span>
              )}
            </motion.button>
          </motion.div>
        ) : (
          <motion.div
            key="deposit-form"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            {/* Denomination Selection */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-gray-300">
                Deposit Amount
              </label>
              <div className="grid grid-cols-4 gap-2">
                {PRIVACY_DENOMINATIONS.map((denom) => (
                  <button
                    key={denom}
                    onClick={() => setSelectedDenomination(denom)}
                    className={cn(
                      "p-3 rounded-lg border text-center transition-all",
                      selectedDenomination === denom
                        ? "border-violet-500 bg-violet-500/10 text-white"
                        : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10"
                    )}
                  >
                    <p className="font-semibold">{denom}</p>
                    <p className="text-xs opacity-60">SAGE</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Gas Payment Method */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-gray-300">
                Gas Payment
              </label>
              <div className="grid grid-cols-2 gap-2">
                {GAS_METHODS.map((method) => {
                  const isDisabled = method.id === "sponsored" && !sponsoredEligible;
                  const Icon = method.icon;

                  return (
                    <button
                      key={method.id}
                      onClick={() => !isDisabled && setSelectedGasMethod(method.id)}
                      disabled={isDisabled}
                      className={cn(
                        "p-3 rounded-lg border text-left transition-all relative",
                        selectedGasMethod === method.id
                          ? method.id === "sponsored"
                            ? "border-emerald-500 bg-emerald-500/10"
                            : "border-violet-500 bg-violet-500/10"
                          : "border-white/10 bg-white/5 hover:bg-white/10",
                        isDisabled && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className={cn(
                          "w-4 h-4",
                          selectedGasMethod === method.id
                            ? method.id === "sponsored"
                              ? "text-emerald-400"
                              : "text-violet-400"
                            : "text-gray-400"
                        )} />
                        <span className="text-sm font-medium text-white">
                          {method.label}
                        </span>
                        {method.badge && (
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-medium",
                            method.badgeColor || "bg-violet-500/20 text-violet-400"
                          )}>
                            {method.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">{method.description}</p>
                    </button>
                  );
                })}
              </div>
              {selectedGasMethod !== "wallet" && (
                <p className="text-xs text-emerald-400/80 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Transaction via AVNU Paymaster
                </p>
              )}
            </div>

            {/* Privacy Info */}
            <div className="p-4 rounded-lg bg-violet-500/10 border border-violet-500/20">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-violet-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-violet-300">
                    Privacy Guaranteed
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Your deposit will be shielded using Pedersen commitments and
                    ElGamal encryption. A private note will be stored locally.
                  </p>
                </div>
              </div>
            </div>

            {/* Deposit Button */}
            <button
              onClick={handleDeposit}
              disabled={!isConnected}
              className={cn(
                "w-full py-4 rounded-xl font-semibold text-white transition-all",
                !isConnected
                  ? "bg-gray-600 cursor-not-allowed"
                  : selectedGasMethod === "sponsored"
                  ? "bg-gradient-to-r from-emerald-600 to-violet-600 hover:shadow-lg hover:shadow-emerald-500/25"
                  : "bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:shadow-lg hover:shadow-violet-500/25"
              )}
            >
              <span className="flex items-center justify-center gap-2">
                <ArrowDownToLine className="w-5 h-5" />
                {selectedGasMethod === "sponsored" ? (
                  <>Deposit {selectedDenomination} SAGE (Free Gas)</>
                ) : (
                  <>Deposit {selectedDenomination} SAGE</>
                )}
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Privacy Transaction Review Modal */}
      {txReview.props && (
        <PrivacyTransactionReviewModal
          isOpen={txReview.isOpen}
          onClose={txReview.close}
          {...txReview.props}
        />
      )}
    </div>
  );
}

export default GaslessDepositPanel;
