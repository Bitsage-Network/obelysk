"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Shield,
  Lock,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  Eye,
  EyeOff,
  Zap,
  X,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Timer,
  Gavel,
  ExternalLink,
  RefreshCw,
  Fingerprint,
  Sparkles,
  Activity,
  Wallet,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAccount, useConnect } from "@starknet-react/core";
import { useNetwork } from "@/lib/contexts/NetworkContext";
import {
  useDarkPool,
  type EpochPhase,
  type DarkPoolBalance,
  type OrderView,
} from "@/lib/hooks/useDarkPool";
import {
  type TradingPairInfo,
  DARK_POOL_PAIRS,
} from "@/lib/darkpool/darkPoolOrder";
import {
  TOKEN_METADATA,
  NETWORK_CONFIG,
  type TokenSymbol,
  type NetworkType,
} from "@/lib/contracts/addresses";
import { useDarkPoolEvents, type DarkPoolEventItem } from "@/lib/hooks/useProtocolEvents";
import { EpochHistoryPanel } from "./EpochHistoryPanel";
import { PnLSummaryCard } from "./PnLSummaryCard";

// ============================================================================
// Epoch Phase Display Config
// ============================================================================

const PHASE_CONFIG: Record<EpochPhase, {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  gradientFrom: string;
  icon: typeof Lock;
  description: string;
  actionLabel: string;
}> = {
  commit: {
    label: "Commit",
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/20",
    gradientFrom: "from-cyan-500/20",
    icon: Lock,
    description: "Submit sealed orders — prices & amounts hidden on-chain",
    actionLabel: "Commit Order",
  },
  reveal: {
    label: "Reveal",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
    gradientFrom: "from-amber-500/20",
    icon: Eye,
    description: "Commitments are opened — verifying order integrity",
    actionLabel: "Auto-Revealing",
  },
  settle: {
    label: "Settle",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
    gradientFrom: "from-emerald-500/20",
    icon: Gavel,
    description: "On-chain matching at uniform clearing price — zero MEV",
    actionLabel: "Settle Epoch",
  },
  closed: {
    label: "Closed",
    color: "text-gray-400",
    bgColor: "bg-gray-500/10",
    borderColor: "border-gray-500/30",
    gradientFrom: "from-gray-500/10",
    icon: Clock,
    description: "Epoch complete — waiting for next cycle",
    actionLabel: "Waiting",
  },
};

// ============================================================================
// Sub-components
// ============================================================================

function EpochTimerBanner({
  epoch,
  phase,
  secondsRemaining: serverSeconds,
  fromContract,
}: {
  epoch: number;
  phase: EpochPhase;
  secondsRemaining: number;
  fromContract: boolean;
}) {
  // Local countdown interpolation for smooth display between RPC polls
  const [localSeconds, setLocalSeconds] = useState(serverSeconds);
  useEffect(() => {
    setLocalSeconds(serverSeconds);
  }, [serverSeconds, epoch, phase]);
  useEffect(() => {
    if (localSeconds <= 0) return;
    const timer = setInterval(() => {
      setLocalSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [localSeconds > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const secondsRemaining = localSeconds;
  const config = PHASE_CONFIG[phase];
  const PhaseIcon = config.icon;
  const phases: EpochPhase[] = ["commit", "reveal", "settle"];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative overflow-hidden rounded-2xl border p-5",
        config.borderColor,
        "bg-gradient-to-r",
        config.gradientFrom,
        "to-transparent",
      )}
    >
      {/* Subtle background pulse */}
      <motion.div
        className={cn("absolute inset-0 opacity-[0.03]", config.bgColor)}
        animate={{ opacity: [0.03, 0.06, 0.03] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-4">
          <motion.div
            className={cn(
              "w-12 h-12 rounded-xl flex items-center justify-center",
              config.bgColor,
              "border",
              config.borderColor,
            )}
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <PhaseIcon className={cn("w-5 h-5", config.color)} />
          </motion.div>
          <div>
            <div className="flex items-center gap-2.5">
              <span className={cn("text-sm font-bold tracking-wide uppercase", config.color)}>
                {config.label} Phase
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] text-gray-400 font-mono">
                Epoch #{epoch}
              </span>
              {fromContract && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-[9px] text-emerald-400 font-medium">
                  LIVE
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{config.description}</p>
          </div>
        </div>
        <div className="text-right">
          <motion.div
            className={cn("text-2xl font-bold font-mono tabular-nums", config.color)}
            key={secondsRemaining}
            initial={{ opacity: 0.7, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            ~{secondsRemaining}s
          </motion.div>
          <div className="text-[10px] text-gray-600 mt-0.5">until next phase</div>
        </div>
      </div>

      {/* Phase progress bar */}
      <div className="relative mt-4 flex gap-1.5">
        {phases.map((p) => {
          const isActive = p === phase;
          const isPast = phases.indexOf(p) < phases.indexOf(phase);
          return (
            <div key={p} className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
              {isPast && (
                <div className="h-full w-full bg-emerald-500/60 rounded-full" />
              )}
              {isActive && (
                <motion.div
                  className={cn("h-full rounded-full", {
                    "bg-gradient-to-r from-cyan-400 to-cyan-500": p === "commit",
                    "bg-gradient-to-r from-amber-400 to-amber-500": p === "reveal",
                    "bg-gradient-to-r from-emerald-400 to-emerald-500": p === "settle",
                  })}
                  initial={{ width: "5%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: secondsRemaining, ease: "linear" }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1.5">
        {phases.map((p) => {
          const isActive = p === phase;
          const isPast = phases.indexOf(p) < phases.indexOf(phase);
          return (
            <span
              key={p}
              className={cn("text-[10px] font-medium uppercase tracking-wider", {
                [PHASE_CONFIG[p].color]: isActive,
                "text-emerald-500/60": isPast,
                "text-gray-600": !isActive && !isPast,
              })}
            >
              {p}
            </span>
          );
        })}
      </div>
    </motion.div>
  );
}

/**
 * Format a decrypted bigint balance to human-readable string
 */
function formatDecryptedBalance(amount: bigint, symbol: TokenSymbol): string {
  const decimals = TOKEN_METADATA[symbol]?.decimals ?? 18;
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 4);
  // Trim trailing zeros
  const trimmed = fracStr.replace(/0+$/, "") || "0";
  if (whole === 0n && amount > 0n) return `0.${fracStr}`;
  return `${whole}.${trimmed}`;
}

function BalanceCard({
  balances,
  onDeposit,
  onWithdraw,
  isLoading,
  onRefresh,
}: {
  balances: DarkPoolBalance[];
  onDeposit: (token: TokenSymbol, amount: number) => Promise<void>;
  onWithdraw: (token: TokenSymbol, amount: number) => Promise<void>;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [action, setAction] = useState<"deposit" | "withdraw">("deposit");
  const [selectedToken, setSelectedToken] = useState<TokenSymbol>("ETH");
  const [amount, setAmount] = useState("");

  const handleSubmit = async () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) return;
    if (action === "deposit") {
      await onDeposit(selectedToken, val);
    } else {
      await onWithdraw(selectedToken, val);
    }
    setAmount("");
  };

  const selectedBalance = balances.find((b) => b.symbol === selectedToken);

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
            <Fingerprint className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Encrypted Vault</h3>
            <p className="text-[10px] text-gray-500">ElGamal encrypted on-chain balances</p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          className="p-2 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-colors"
          title="Refresh balances"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Balance Grid */}
      <div className="px-5 py-3 border-b border-white/[0.06]">
        <div className="grid grid-cols-5 gap-2">
          {(["ETH", "STRK", "wBTC", "USDC", "SAGE"] as TokenSymbol[]).map((sym) => {
            const bal = balances.find((b) => b.symbol === sym);
            const hasBalance = bal?.encrypted !== null;
            const decrypted = bal?.decrypted;
            return (
              <button
                key={sym}
                onClick={() => setSelectedToken(sym)}
                className={cn(
                  "relative flex flex-col items-center py-2.5 rounded-xl text-xs transition-all",
                  selectedToken === sym
                    ? "bg-white/10 text-white border border-white/20 shadow-lg shadow-white/5"
                    : "bg-white/[0.02] text-gray-500 hover:text-white hover:bg-white/5 border border-transparent",
                )}
              >
                <span className="font-semibold">{sym}</span>
                {hasBalance && decrypted !== null && decrypted !== undefined ? (
                  <span className="text-[9px] text-emerald-400 font-mono mt-1">
                    {formatDecryptedBalance(decrypted, sym)}
                  </span>
                ) : hasBalance ? (
                  <div className="flex items-center gap-0.5 mt-1">
                    <Lock className="w-2.5 h-2.5 text-emerald-400" />
                    <span className="text-[9px] text-emerald-400">active</span>
                  </div>
                ) : (
                  <span className="text-[9px] text-gray-600 mt-1">empty</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Selected token detail */}
        {selectedBalance?.decrypted !== null && selectedBalance?.decrypted !== undefined && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-2 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-500">Decrypted Balance</span>
              <span className="text-xs text-emerald-400 font-mono font-semibold">
                {formatDecryptedBalance(selectedBalance.decrypted, selectedToken)} {selectedToken}
              </span>
            </div>
          </motion.div>
        )}
      </div>

      {/* Action Toggle */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex gap-1.5 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <button
            onClick={() => setAction("deposit")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all",
              action === "deposit"
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                : "text-gray-500 hover:text-white",
            )}
          >
            <ArrowDownToLine className="w-3.5 h-3.5" /> Deposit
          </button>
          <button
            onClick={() => setAction("withdraw")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all",
              action === "withdraw"
                ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                : "text-gray-500 hover:text-white",
            )}
          >
            <ArrowUpFromLine className="w-3.5 h-3.5" /> Withdraw
          </button>
        </div>
      </div>

      {/* Amount Input */}
      <div className="px-5 pb-4">
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            step="any"
            className="w-full px-4 py-3 pr-20 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white font-mono text-sm placeholder:text-gray-600 focus:outline-none focus:border-violet-500/40 transition-colors"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            {action === "withdraw" && selectedBalance?.decrypted !== null && selectedBalance?.decrypted !== undefined && selectedBalance.decrypted > 0n && (
              <button
                onClick={() => setAmount(formatDecryptedBalance(selectedBalance.decrypted!, selectedToken))}
                className="px-1.5 py-0.5 rounded bg-violet-500/15 text-[9px] font-bold text-violet-400 hover:bg-violet-500/25 transition-colors"
              >
                MAX
              </button>
            )}
            <span className="text-xs text-gray-500 font-medium">
              {selectedToken}
            </span>
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={isLoading || !amount || parseFloat(amount) <= 0}
          className={cn(
            "w-full mt-3 py-3 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2",
            action === "deposit"
              ? "bg-emerald-500/80 hover:bg-emerald-500 text-white disabled:bg-emerald-500/20 disabled:text-emerald-500/40"
              : "bg-amber-500/80 hover:bg-amber-500 text-white disabled:bg-amber-500/20 disabled:text-amber-500/40",
          )}
        >
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : action === "deposit" ? (
            <>
              <Lock className="w-3.5 h-3.5" />
              Encrypt & Deposit {selectedToken}
            </>
          ) : (
            <>
              <Shield className="w-3.5 h-3.5" />
              Prove & Withdraw {selectedToken}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function OrdersTable({
  orders,
  onCancel,
  onClaimFill,
  explorerUrl,
}: {
  orders: Array<{
    orderId: bigint;
    side: "buy" | "sell";
    pair: string;
    price: string;
    amount: string;
    status: string;
    epoch: number;
    fillAmount?: string;
    clearingPrice?: string;
    commitTxHash?: string;
    revealTxHash?: string;
  }>;
  onCancel: (orderId: bigint) => Promise<void>;
  onClaimFill: (orderId: bigint) => Promise<void>;
  explorerUrl: string;
}) {
  if (orders.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02]">
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <EyeOff className="w-4 h-4 text-cyan-400" />
            My Orders
            <span className="text-[10px] text-gray-500 font-normal px-2 py-0.5 rounded-full bg-white/5">
              only visible to you
            </span>
          </h3>
        </div>
        <div className="py-14 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="inline-flex flex-col items-center"
          >
            <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-3">
              <Lock className="w-6 h-6 text-gray-600" />
            </div>
            <p className="text-sm text-gray-500 mb-1">No orders yet</p>
            <p className="text-xs text-gray-600">Place a sealed order during the Commit phase</p>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <EyeOff className="w-4 h-4 text-cyan-400" />
          My Orders
          <span className="text-[10px] text-gray-500 font-normal px-2 py-0.5 rounded-full bg-white/5">
            {orders.length} total
          </span>
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-gray-500 border-b border-white/[0.04] uppercase tracking-wider">
              <th className="px-5 py-3 text-left font-medium">Side</th>
              <th className="px-3 py-3 text-left font-medium">Pair</th>
              <th className="px-3 py-3 text-right font-medium">Price</th>
              <th className="px-3 py-3 text-right font-medium">Amount</th>
              <th className="px-3 py-3 text-right font-medium">Fill Price</th>
              <th className="px-3 py-3 text-right font-medium">P&L</th>
              <th className="px-3 py-3 text-center font-medium">Status</th>
              <th className="px-3 py-3 text-center font-medium">Epoch</th>
              <th className="px-5 py-3 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence>
              {orders.map((order, i) => (
                <motion.tr
                  key={order.orderId.toString()}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      {order.side === "buy" ? (
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                      )}
                      <span
                        className={cn(
                          "text-xs font-bold uppercase tracking-wide",
                          order.side === "buy" ? "text-emerald-400" : "text-red-400",
                        )}
                      >
                        {order.side}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3.5 text-white text-xs font-medium">{order.pair}</td>
                  <td className="px-3 py-3.5 text-right text-white font-mono text-xs">{order.price}</td>
                  <td className="px-3 py-3.5 text-right text-white font-mono text-xs">{order.amount}</td>
                  <td className="px-3 py-3.5 text-right text-xs font-mono">
                    {order.clearingPrice ? (
                      <span className="text-gray-300">{order.clearingPrice}</span>
                    ) : (
                      <span className="text-gray-600">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3.5 text-right text-xs font-mono">
                    {order.clearingPrice && order.fillAmount ? (() => {
                      const entry = parseFloat(order.price);
                      const fill = parseFloat(order.clearingPrice);
                      const amount = parseFloat(order.fillAmount);
                      if (!entry || !fill || !amount) return <span className="text-gray-600">-</span>;
                      const pnl = order.side === "buy"
                        ? (entry - fill) * amount
                        : (fill - entry) * amount;
                      const isProfit = pnl >= 0;
                      return (
                        <span className={cn(isProfit ? "text-emerald-400" : "text-red-400")}>
                          {isProfit ? "+" : ""}{pnl.toFixed(4)}
                        </span>
                      );
                    })() : (
                      <span className="text-gray-600">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3.5 text-center">
                    <span
                      className={cn("px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wide", {
                        "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20": order.status === "committed",
                        "bg-amber-500/10 text-amber-400 border border-amber-500/20": order.status === "revealed",
                        "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20": order.status === "filled" || order.status === "claimed",
                        "bg-gray-500/10 text-gray-400 border border-gray-500/20": order.status === "cancelled" || order.status === "expired",
                      })}
                    >
                      {order.status}
                    </span>
                  </td>
                  <td className="px-3 py-3.5 text-center text-gray-500 font-mono text-[10px]">
                    #{order.epoch}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {(order.status === "committed" || order.status === "revealed") && (
                        <button
                          onClick={() => onCancel(order.orderId)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
                          title="Cancel order"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {order.status === "filled" && order.fillAmount && (
                        <button
                          onClick={() => onClaimFill(order.orderId)}
                          className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-semibold hover:bg-emerald-500/20 transition-colors"
                          title="Claim fill to update encrypted balances"
                        >
                          Claim Fill
                        </button>
                      )}
                      {order.status === "claimed" && (
                        <span className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Claimed
                        </span>
                      )}
                      {order.commitTxHash && explorerUrl && (
                        <a
                          href={`${explorerUrl}/tx/${order.commitTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg hover:bg-white/5 text-gray-600 hover:text-cyan-400 transition-colors"
                          title="View on explorer"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Activity Feed Sub-component
// ============================================================================

const EVENT_TYPE_CONFIG: Record<string, { label: string; color: string; icon: typeof Lock }> = {
  order_committed: { label: "Committed", color: "text-cyan-400", icon: Lock },
  order_revealed: { label: "Revealed", color: "text-amber-400", icon: Eye },
  order_filled: { label: "Filled", color: "text-emerald-400", icon: CheckCircle2 },
  order_cancelled: { label: "Cancelled", color: "text-gray-400", icon: X },
  epoch_settled: { label: "Settled", color: "text-emerald-400", icon: Gavel },
  deposited: { label: "Deposit", color: "text-violet-400", icon: ArrowDownToLine },
  withdrawn: { label: "Withdraw", color: "text-amber-400", icon: ArrowUpFromLine },
};

function DarkPoolActivityFeed({
  network,
  explorerUrl,
}: {
  network: NetworkType;
  explorerUrl: string;
}) {
  const { darkPoolEvents } = useDarkPoolEvents({ network });

  const recentEvents = darkPoolEvents.slice(0, 8);

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02]">
      <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
        <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
          <Activity className="w-3 h-3 text-cyan-400" />
          Live Activity
        </h4>
        {darkPoolEvents.length > 0 && (
          <span className="flex items-center gap-1 text-[9px] text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </span>
        )}
      </div>

      {recentEvents.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-xs text-gray-600">No recent activity</p>
          <p className="text-[10px] text-gray-700 mt-1">Events appear here as they happen on-chain</p>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.03]">
          {recentEvents.map((event, i) => {
            const config = EVENT_TYPE_CONFIG[event.event_type] ?? {
              label: event.event_type,
              color: "text-gray-400",
              icon: Activity,
            };
            const EventIcon = config.icon;
            const shortTrader = event.trader
              ? `${event.trader.slice(0, 6)}...${event.trader.slice(-4)}`
              : "";

            return (
              <motion.div
                key={`${event.tx_hash}-${i}`}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className="px-5 py-2.5 flex items-center gap-2.5"
              >
                <EventIcon className={cn("w-3 h-3 flex-shrink-0", config.color)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("text-[10px] font-semibold", config.color)}>
                      {config.label}
                    </span>
                    {shortTrader && (
                      <span className="text-[9px] text-gray-600 font-mono truncate">
                        {shortTrader}
                      </span>
                    )}
                  </div>
                </div>
                {explorerUrl && (
                  <a
                    href={`${explorerUrl}/tx/${event.tx_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-600 hover:text-cyan-400 transition-colors flex-shrink-0"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function PrivateAuction() {
  const { address } = useAccount();
  const { connect, connectors } = useConnect();
  const { network } = useNetwork();
  const {
    stage,
    error,
    currentEpoch,
    submitOrder,
    cancelOrder,
    settleEpoch,
    claimFill,
    deposit,
    withdraw,
    balances,
    refreshBalances,
    myOrders,
    epochResult,
    pairs,
    relayMode,
    setRelayMode,
    relayConnected,
    resetError,
  } = useDarkPool();

  // Local UI state
  const [selectedPair, setSelectedPair] = useState<TradingPairInfo>(DARK_POOL_PAIRS[0]);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [priceInput, setPriceInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [showPairDropdown, setShowPairDropdown] = useState(false);

  // Click-outside handler for pair dropdown
  const dropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showPairDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowPairDropdown(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowPairDropdown(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showPairDropdown]);

  const phase = currentEpoch?.phase ?? "closed";
  const phaseConfig = PHASE_CONFIG[phase];
  const explorerUrl = NETWORK_CONFIG[network as NetworkType]?.explorerUrl || "";

  const isSubmitting = stage === "building" || stage === "committing" || stage === "revealing";
  const isBalanceOp = stage === "depositing" || stage === "withdrawing";
  const canCommit = phase === "commit" && !isSubmitting && !!address;

  // Auto-settle: when settle phase begins and user has revealed orders, trigger once per epoch.
  // Use a ref to survive remounts and track which epoch was already auto-settled.
  const autoSettledEpochRef = useRef<number>(-1);
  const hasRevealedOrders = myOrders.some((o) => o.status === "revealed");

  useEffect(() => {
    if (
      phase === "settle" &&
      hasRevealedOrders &&
      stage === "idle" &&
      address &&
      currentEpoch &&
      // Only fire once per epoch — ref persists across renders
      autoSettledEpochRef.current !== currentEpoch.epoch &&
      // Don't fire if this epoch is already settled (epochResult exists)
      epochResult?.epochId !== currentEpoch.epoch
    ) {
      autoSettledEpochRef.current = currentEpoch.epoch;
      settleEpoch(currentEpoch.epoch);
    }
  }, [phase, hasRevealedOrders, stage, address, currentEpoch, epochResult, settleEpoch]);

  // --------------------------------------------------------------------------
  // Handlers
  // --------------------------------------------------------------------------

  const handleSubmitOrder = async () => {
    const price = parseFloat(priceInput);
    const amount = parseFloat(amountInput);
    if (!price || !amount || price <= 0 || amount <= 0) return;
    await submitOrder(price, amount, side, selectedPair);
    setPriceInput("");
    setAmountInput("");
  };

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <div className="space-y-5">
      {/* Privacy Banner + Relay Toggle */}
      <motion.div
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-violet-500/10 via-cyan-500/5 to-transparent border border-violet-500/15"
      >
        <Shield className="w-4 h-4 text-violet-400 flex-shrink-0" />
        <p className="text-xs text-gray-400 flex-1">
          <span className="text-violet-400 font-semibold">Fully encrypted trading.</span>{" "}
          Orders are sealed during commit, revealed briefly for matching, then settled at uniform clearing price per pair.
          No front-running. No MEV. Balances always encrypted.
        </p>
        {/* Relay Mode Toggle */}
        <button
          onClick={() => setRelayMode(!relayMode)}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all flex-shrink-0 border",
            relayMode
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-white/[0.03] border-white/[0.08] text-gray-500 hover:text-white hover:border-white/20",
          )}
          title={relayMode ? "Transactions submitted via relay — identity hidden" : "Enable relay mode to hide your identity"}
        >
          <Shield className="w-3 h-3" />
          {relayMode ? (
            <>
              <span className={cn("w-1.5 h-1.5 rounded-full", relayConnected ? "bg-emerald-400" : "bg-amber-400 animate-pulse")} />
              Identity Hidden
            </>
          ) : (
            "Relay Mode"
          )}
        </button>
      </motion.div>

      {/* Epoch Timer Banner */}
      {currentEpoch ? (
        <EpochTimerBanner
          epoch={currentEpoch.epoch}
          phase={phase}
          secondsRemaining={currentEpoch.secondsRemaining}
          fromContract={currentEpoch.fromContract}
        />
      ) : (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/[0.04]" />
              <div className="space-y-2">
                <div className="h-3 w-28 rounded bg-white/[0.06]" />
                <div className="h-2 w-48 rounded bg-white/[0.04]" />
              </div>
            </div>
            <div className="h-8 w-16 rounded bg-white/[0.04]" />
          </div>
          <div className="mt-4 flex gap-1.5">
            <div className="flex-1 h-2 rounded-full bg-white/[0.04]" />
            <div className="flex-1 h-2 rounded-full bg-white/[0.04]" />
            <div className="flex-1 h-2 rounded-full bg-white/[0.04]" />
          </div>
        </div>
      )}

      {/* Error Display */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3.5 rounded-xl bg-red-500/8 border border-red-500/15 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <span className="text-xs text-red-400 leading-relaxed">{error}</span>
              </div>
              <button
                onClick={resetError}
                className="p-1 rounded hover:bg-white/5 text-red-400/60 hover:text-red-400 transition-colors flex-shrink-0"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stage Indicator */}
      <AnimatePresence>
        {stage !== "idle" && stage !== "error" && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-4"
          >
            <div className="flex items-center gap-3">
              <motion.div
                className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center"
                animate={{ scale: [1, 1.08, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                {stage === "settled" ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                )}
              </motion.div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-white capitalize">
                  {stage.replace("-", " ").replace("waiting ", "Waiting for ")}
                </div>
                <div className="text-xs text-gray-500">
                  {stage === "building" && "Generating cryptographic proofs..."}
                  {stage === "committing" && "Submitting sealed order to network..."}
                  {stage === "waiting-reveal" && "Your order is committed. Auto-reveal will trigger on phase change."}
                  {stage === "revealing" && "Opening your commitment on-chain..."}
                  {stage === "waiting-settle" && "Order revealed. Waiting for batch settlement..."}
                  {stage === "settling" && "Triggering on-chain settlement..."}
                  {stage === "settled" && "Orders matched at uniform clearing price!"}
                  {stage === "depositing" && "Encrypting & depositing to vault..."}
                  {stage === "withdrawing" && "Proving balance & withdrawing..."}
                </div>
              </div>
              {stage === "settled" && (
                <Sparkles className="w-5 h-5 text-emerald-400" />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Grid */}
      <div className="grid lg:grid-cols-3 gap-5">
        {/* Order Form (2 cols) */}
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Lock className="w-4 h-4 text-cyan-400" />
                Place Sealed Order
              </h3>
              {currentEpoch?.fromContract && (
                <span className="flex items-center gap-1.5 text-[10px] text-emerald-400">
                  <Activity className="w-3 h-3" />
                  On-chain epoch sync
                </span>
              )}
            </div>

            {/* Pair Selector */}
            <div className="mb-4 relative" ref={dropdownRef}>
              <button
                onClick={() => setShowPairDropdown(!showPairDropdown)}
                className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-white/20 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-1">
                    <div className="w-6 h-6 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-[9px] font-bold text-white">
                      {selectedPair.giveSymbol.slice(0, 2)}
                    </div>
                    <div className="w-6 h-6 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-[9px] font-bold text-white">
                      {selectedPair.wantSymbol.slice(0, 2)}
                    </div>
                  </div>
                  <span className="text-white font-semibold text-sm">{selectedPair.label}</span>
                </div>
                <ChevronDown className={cn("w-4 h-4 text-gray-400 transition-transform", showPairDropdown && "rotate-180")} />
              </button>

              <AnimatePresence>
                {showPairDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    className="absolute top-full mt-1.5 w-full rounded-xl bg-[#1a1a2e] border border-white/10 shadow-2xl shadow-black/50 z-20 overflow-hidden"
                  >
                    {pairs.map((pair) => (
                      <button
                        key={pair.label}
                        onClick={() => { setSelectedPair(pair); setShowPairDropdown(false); }}
                        className={cn(
                          "w-full px-4 py-3 text-left text-sm hover:bg-white/5 transition-colors flex items-center gap-3",
                          pair.label === selectedPair.label ? "text-white bg-white/5" : "text-gray-400",
                        )}
                      >
                        <div className="flex -space-x-1">
                          <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[8px] font-bold text-white">
                            {pair.giveSymbol.slice(0, 2)}
                          </div>
                          <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[8px] font-bold text-white">
                            {pair.wantSymbol.slice(0, 2)}
                          </div>
                        </div>
                        {pair.label}
                        {pair.label === selectedPair.label && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 ml-auto" />
                        )}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Buy / Sell Toggle */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                onClick={() => setSide("buy")}
                className={cn(
                  "py-3.5 rounded-xl text-sm font-bold transition-all tracking-wide",
                  side === "buy"
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-lg shadow-emerald-500/5"
                    : "bg-white/[0.02] text-gray-500 border border-transparent hover:text-white hover:bg-white/[0.04]",
                )}
              >
                Buy
              </button>
              <button
                onClick={() => setSide("sell")}
                className={cn(
                  "py-3.5 rounded-xl text-sm font-bold transition-all tracking-wide",
                  side === "sell"
                    ? "bg-red-500/15 text-red-400 border border-red-500/30 shadow-lg shadow-red-500/5"
                    : "bg-white/[0.02] text-gray-500 border border-transparent hover:text-white hover:bg-white/[0.04]",
                )}
              >
                Sell
              </button>
            </div>

            {/* Price Input */}
            <div className="mb-3">
              <label className="text-[11px] text-gray-500 mb-1.5 block font-medium uppercase tracking-wider">
                Limit Price
                <span className="lowercase tracking-normal ml-1 text-gray-600">
                  ({selectedPair.wantSymbol} per {selectedPair.giveSymbol})
                </span>
              </label>
              <input
                type="number"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder="0.00"
                step="any"
                min="0"
                className="w-full px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white font-mono text-sm placeholder:text-gray-600 focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/10 transition-all"
              />
            </div>

            {/* Amount Input */}
            <div className="mb-5">
              <label className="text-[11px] text-gray-500 mb-1.5 block font-medium uppercase tracking-wider">
                Amount
                <span className="lowercase tracking-normal ml-1 text-gray-600">
                  ({side === "sell" ? selectedPair.giveSymbol : selectedPair.wantSymbol})
                </span>
              </label>
              <input
                type="number"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="0.00"
                step="any"
                min="0"
                className="w-full px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white font-mono text-sm placeholder:text-gray-600 focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/10 transition-all"
              />
            </div>

            {/* Estimated Total */}
            {priceInput && amountInput && parseFloat(priceInput) > 0 && parseFloat(amountInput) > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="mb-4 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.06]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500 uppercase tracking-wider font-medium">
                    Est. Total
                  </span>
                  <span className="text-sm text-white font-mono font-semibold">
                    {(parseFloat(priceInput) * parseFloat(amountInput)).toFixed(6)}{" "}
                    <span className="text-gray-500 text-xs">
                      {side === "buy" ? selectedPair.giveSymbol : selectedPair.wantSymbol}
                    </span>
                  </span>
                </div>
              </motion.div>
            )}

            {/* Privacy Info */}
            <div className="mb-5 p-3.5 rounded-xl bg-gradient-to-r from-cyan-500/5 to-violet-500/5 border border-cyan-500/10">
              <div className="flex items-start gap-2.5">
                <EyeOff className="w-4 h-4 text-cyan-400 mt-0.5 flex-shrink-0" />
                <div className="text-[11px] text-gray-400 leading-relaxed">
                  Your order is{" "}
                  <span className="text-cyan-400 font-semibold">committed as a Poseidon hash</span>.
                  Price, amount, and side remain hidden until the reveal phase. Nobody — not even the sequencer — can front-run your trade.
                </div>
              </div>
            </div>

            {/* Submit Button */}
            {!address ? (
              <button
                onClick={() => { if (connectors[0]) connect({ connector: connectors[0] }); }}
                className="w-full py-4 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2.5 tracking-wide bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white shadow-lg shadow-violet-500/20"
              >
                <Wallet className="w-4 h-4" />
                Connect Wallet
              </button>
            ) : (
              <button
                onClick={handleSubmitOrder}
                disabled={!canCommit || !priceInput || !amountInput}
                className={cn(
                  "w-full py-4 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2.5 tracking-wide",
                  side === "buy"
                    ? "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-lg shadow-emerald-500/20 disabled:from-emerald-500/15 disabled:to-emerald-500/10 disabled:text-emerald-500/40 disabled:shadow-none"
                    : "bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white shadow-lg shadow-red-500/20 disabled:from-red-500/15 disabled:to-red-500/10 disabled:text-red-500/40 disabled:shadow-none",
                )}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {stage === "building" ? "Generating proof..." : stage === "committing" ? "Committing..." : "Revealing..."}
                  </>
                ) : phase !== "commit" ? (
                  <>
                    <Timer className="w-4 h-4" />
                    Wait for Commit Phase
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    {side === "buy" ? "Buy" : "Sell"} — Commit Sealed Order
                  </>
                )}
              </button>
            )}
          </div>

          {/* Settle Button (permissionless — shown when user has orders) */}
          <AnimatePresence>
            {phase === "settle" && currentEpoch && hasRevealedOrders && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="rounded-2xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 to-transparent p-5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                      <Gavel className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">Settle Epoch #{currentEpoch.epoch}</div>
                      <div className="text-xs text-gray-500">Permissionless — anyone can trigger settlement</div>
                    </div>
                  </div>
                  <button
                    onClick={() => settleEpoch(currentEpoch.epoch)}
                    disabled={stage === "settling"}
                    className="px-5 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-sm font-semibold hover:bg-emerald-500/25 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {stage === "settling" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5" />
                    )}
                    Settle Now
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Epoch Result */}
          <AnimatePresence>
            {epochResult && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-2xl border border-emerald-500/15 bg-gradient-to-r from-emerald-500/5 to-transparent p-5"
              >
                <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Epoch #{epochResult.epochId} Settlement
                  <span className="text-[10px] text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    MATCHED
                  </span>
                </h4>
                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
                    <div className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider font-medium">Clearing Price</div>
                    <div className="text-sm font-mono text-white font-bold">{epochResult.clearingPrice}</div>
                  </div>
                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
                    <div className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider font-medium">Volume</div>
                    <div className="text-sm font-mono text-white font-bold">{epochResult.totalBuyFilled}</div>
                  </div>
                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
                    <div className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider font-medium">Fills</div>
                    <div className="text-sm font-mono text-white font-bold">{epochResult.numFills}</div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Epoch History Panel */}
          <EpochHistoryPanel />
        </div>

        {/* Right Sidebar */}
        <div className="space-y-5">
          {/* Encrypted Vault / Balance Card */}
          <BalanceCard
            balances={balances}
            onDeposit={deposit}
            onWithdraw={withdraw}
            isLoading={isBalanceOp}
            onRefresh={refreshBalances}
          />

          {/* P&L Summary Card */}
          <PnLSummaryCard orders={myOrders} />

          {/* How It Works */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
            <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-4">
              How It Works
            </h4>
            <div className="space-y-4">
              {[
                {
                  step: "1",
                  label: "Deposit",
                  desc: "Encrypt tokens into your dark pool vault",
                  color: "text-violet-400",
                  bg: "bg-violet-500/10",
                  border: "border-violet-500/20",
                },
                {
                  step: "2",
                  label: "Commit",
                  desc: "Submit a sealed order — only the hash is visible",
                  color: "text-cyan-400",
                  bg: "bg-cyan-500/10",
                  border: "border-cyan-500/20",
                },
                {
                  step: "3",
                  label: "Reveal",
                  desc: "Auto-reveal opens your commitment for verification",
                  color: "text-amber-400",
                  bg: "bg-amber-500/10",
                  border: "border-amber-500/20",
                },
                {
                  step: "4",
                  label: "Settle",
                  desc: "On-chain matching at uniform clearing price",
                  color: "text-emerald-400",
                  bg: "bg-emerald-500/10",
                  border: "border-emerald-500/20",
                },
              ].map((item) => (
                <div key={item.step} className="flex items-start gap-3">
                  <div
                    className={cn(
                      "w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black flex-shrink-0 border",
                      item.bg,
                      item.color,
                      item.border,
                    )}
                  >
                    {item.step}
                  </div>
                  <div>
                    <div className={cn("text-xs font-bold", item.color)}>{item.label}</div>
                    <div className="text-[11px] text-gray-500 leading-relaxed">{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Privacy Guarantees */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
            <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">
              Privacy Guarantees
            </h4>
            <div className="space-y-2.5">
              {[
                { label: "No front-running possible", icon: Shield, color: "text-emerald-400" },
                { label: "Zero MEV extraction", icon: Zap, color: "text-amber-400" },
                { label: "Balances always encrypted", icon: Lock, color: "text-cyan-400" },
                { label: "Uniform clearing price", icon: CheckCircle2, color: "text-violet-400" },
                { label: "Identity never revealed", icon: EyeOff, color: "text-rose-400" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2.5">
                  <item.icon className={cn("w-3.5 h-3.5", item.color)} />
                  <span className="text-xs text-gray-400">{item.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Live Activity Feed */}
          <DarkPoolActivityFeed network={network as NetworkType} explorerUrl={explorerUrl} />
        </div>
      </div>

      {/* Orders Table */}
      <OrdersTable
        orders={myOrders}
        onCancel={cancelOrder}
        onClaimFill={claimFill}
        explorerUrl={explorerUrl}
      />
    </div>
  );
}
