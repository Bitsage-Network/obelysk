/**
 * Privacy Session Card
 *
 * Shows active privacy session status with real-time countdown,
 * spending limits, and quick actions.
 */

"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Clock,
  Zap,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Settings,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  usePrivacySession,
  SESSION_PRESETS,
  type SessionPreset,
} from "@/lib/sessions/privacySession";

// ============================================================================
// TYPES
// ============================================================================

interface PrivacySessionCardProps {
  className?: string;
  compact?: boolean;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return "Expired";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

function formatSageAmount(wei: bigint): string {
  const sage = Number(wei) / 1e18;
  if (sage >= 1000) {
    return `${(sage / 1000).toFixed(1)}k`;
  }
  return sage.toFixed(0);
}

// ============================================================================
// PRESET SELECTOR
// ============================================================================

function PresetSelector({
  selected,
  onSelect,
  disabled,
}: {
  selected: SessionPreset;
  onSelect: (preset: SessionPreset) => void;
  disabled?: boolean;
}) {
  const presets: { key: SessionPreset; label: string; description: string }[] = [
    {
      key: "conservative",
      label: "Conservative",
      description: "4h, 100 SAGE/tx, no withdrawals",
    },
    {
      key: "standard",
      label: "Standard",
      description: "24h, 1,000 SAGE/tx, full access",
    },
    {
      key: "power",
      label: "Power",
      description: "7 days, 10,000 SAGE/tx, high limits",
    },
  ];

  return (
    <div className="space-y-2">
      {presets.map((preset) => (
        <button
          key={preset.key}
          onClick={() => onSelect(preset.key)}
          disabled={disabled}
          className={cn(
            "w-full p-3 rounded-lg border text-left transition-all",
            selected === preset.key
              ? "border-violet-500 bg-violet-500/10"
              : "border-white/10 bg-white/5 hover:bg-white/10",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium text-white">{preset.label}</span>
            {selected === preset.key && (
              <CheckCircle2 className="w-4 h-4 text-violet-400" />
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">{preset.description}</p>
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// SPENDING PROGRESS
// ============================================================================

function SpendingProgress({
  spent,
  limit,
  label,
}: {
  spent: bigint;
  limit: bigint;
  label: string;
}) {
  const percentage = limit > BigInt(0)
    ? Math.min(100, Number((spent * BigInt(100)) / limit))
    : 0;

  const isNearLimit = percentage > 80;
  const isAtLimit = percentage >= 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className={cn(
          isAtLimit ? "text-red-400" : isNearLimit ? "text-amber-400" : "text-gray-300"
        )}>
          {formatSageAmount(spent)} / {formatSageAmount(limit)} SAGE
        </span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          className={cn(
            "h-full rounded-full",
            isAtLimit ? "bg-red-500" : isNearLimit ? "bg-amber-500" : "bg-violet-500"
          )}
        />
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function PrivacySessionCard({ className, compact = false }: PrivacySessionCardProps) {
  const {
    session,
    createSession,
    revokeSession,
    timeRemaining,
    isActive,
    dailySpending,
  } = usePrivacySession();

  const [isExpanded, setIsExpanded] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<SessionPreset>("standard");
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleCreateSession = useCallback(async () => {
    setIsCreating(true);
    try {
      await createSession(selectedPreset);
      setShowCreateModal(false);
    } catch (error) {
      console.error("Failed to create session:", error);
    } finally {
      setIsCreating(false);
    }
  }, [createSession, selectedPreset]);

  // No session - show create button
  if (!session || !isActive) {
    return (
      <>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn("glass-card p-4", className)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center">
                <Lock className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <h3 className="font-medium text-white">Privacy Session</h3>
                <p className="text-xs text-gray-400">
                  Sign once, transact privately
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-sm font-medium transition-colors"
            >
              Enable
            </button>
          </div>
        </motion.div>

        {/* Create Modal */}
        <AnimatePresence>
          {showCreateModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowCreateModal(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md bg-surface-card border border-white/10 rounded-2xl p-6"
              >
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-white">
                    Create Privacy Session
                  </h2>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                  >
                    <X className="w-5 h-5 text-gray-400" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-400 mb-3">
                      Choose a session preset based on your needs:
                    </p>
                    <PresetSelector
                      selected={selectedPreset}
                      onSelect={setSelectedPreset}
                      disabled={isCreating}
                    />
                  </div>

                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-amber-200">
                        This will create a session key that can execute privacy
                        operations without additional signatures. Only enable on
                        trusted devices.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowCreateModal(false)}
                      disabled={isCreating}
                      className="flex-1 px-4 py-3 rounded-lg border border-white/10 text-gray-300 hover:bg-white/5 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateSession}
                      disabled={isCreating}
                      className="flex-1 px-4 py-3 rounded-lg bg-violet-500 hover:bg-violet-600 text-white font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      {isCreating ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Shield className="w-4 h-4" />
                          Create Session
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  // Active session - show status
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("glass-card overflow-hidden", className)}
    >
      {/* Header */}
      <button
        onClick={() => !compact && setIsExpanded(!isExpanded)}
        className={cn(
          "w-full p-4 flex items-center justify-between",
          !compact && "hover:bg-white/5 transition-colors"
        )}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <Unlock className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-white">Session Active</h3>
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs">
                <Zap className="w-3 h-3" />
                Fast Mode
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <Clock className="w-3 h-3" />
              {formatTimeRemaining(timeRemaining)} remaining
            </div>
          </div>
        </div>
        {!compact && (
          <ChevronDown
            className={cn(
              "w-5 h-5 text-gray-400 transition-transform",
              isExpanded && "rotate-180"
            )}
          />
        )}
      </button>

      {/* Expanded Details */}
      <AnimatePresence>
        {isExpanded && !compact && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-white/10"
          >
            <div className="p-4 space-y-4">
              {/* Spending Limits */}
              <div className="space-y-3">
                <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                  Daily Limits
                </h4>
                <SpendingProgress
                  spent={dailySpending.spent}
                  limit={dailySpending.spendingLimit}
                  label="Transfers"
                />
                <SpendingProgress
                  spent={dailySpending.withdrawn}
                  limit={dailySpending.withdrawLimit}
                  label="Withdrawals"
                />
              </div>

              {/* Permissions */}
              <div>
                <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                  Permissions
                </h4>
                <div className="flex flex-wrap gap-2">
                  {session.policy.canDeposit && (
                    <span className="px-2 py-1 rounded-full bg-white/10 text-xs text-gray-300">
                      Deposit
                    </span>
                  )}
                  {session.policy.canTransfer && (
                    <span className="px-2 py-1 rounded-full bg-white/10 text-xs text-gray-300">
                      Transfer
                    </span>
                  )}
                  {session.policy.canWithdraw && (
                    <span className="px-2 py-1 rounded-full bg-white/10 text-xs text-gray-300">
                      Withdraw
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => revokeSession()}
                  className="flex-1 px-4 py-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm transition-colors"
                >
                  Revoke Session
                </button>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-4 py-2 rounded-lg border border-white/10 text-gray-300 hover:bg-white/5 text-sm transition-colors"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default PrivacySessionCard;
