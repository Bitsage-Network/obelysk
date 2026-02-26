"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Bitcoin,
  Shield,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  AlertTriangle,
  CheckCircle2,
  Info,
  ChevronDown,
  Loader2,
  Copy,
  Check,
  Users,
  RefreshCw,
  Zap,
  Lock,
  ExternalLink,
  Key,
  Eye,
  EyeOff,
  Wallet,
  Clock,
  Hash,
  Layers,
  Globe,
  ArrowRight,
  Timer,
  TrendingUp,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useAccount } from "@starknet-react/core";
import { LiveBadge } from "@/components/ui/DataFreshness";
import { TransactionConfirmModal } from "@/components/ui/ConfirmationModal";
import {
  useVM31Vault,
  formatBtcAmount,
  deriveSpendingKey,
  buildPlaceholderMerkleData,
  isMerkleDataPlaceholder,
  encodeAmountM31,
  type VaultPhase,
  type StoredVaultNote,
  type VaultNote,
  type VaultInputNote,
} from "@/lib/hooks/useVM31Vault";
import { usePrivacyKeys } from "@/lib/hooks/usePrivacyKeys";
import { useGardenBridge } from "@/lib/hooks/useGardenBridge";
import { useGardenWithdraw } from "@/lib/hooks/useGardenWithdraw";
import { isGardenAvailable } from "@/lib/btc/gardenApi";
import type { GardenOrderProgress } from "@/lib/btc/types";
import { BTC_VAULT_ASSETS, BTC_VARIANT_ASSETS } from "@/lib/contracts/assets";
import { EXTERNAL_TOKENS } from "@/lib/contracts/addresses";
import { useNetwork } from "@/lib/contexts/NetworkContext";

// ─────────────────────────────────────────────────────────────────────────────
// Types & Constants
// ─────────────────────────────────────────────────────────────────────────────

type TabType = "deposit" | "withdraw" | "transfer";
type DepositSource = "starknet" | "btc_l1";
type WithdrawDest = "starknet" | "btc_l1";

interface BtcAssetOption {
  symbol: string;
  name: string;
  decimals: number;
  color: string;
  available: boolean;
}

/** Standard BTC denomination tiers for privacy-preserving deposits.
 * Using fixed denominations prevents exact-amount correlation (privacy gap #7). */
const BTC_DENOMINATIONS = [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1] as const;
const GARDEN_MIN_SATS = 50_000n;
const GARDEN_MAX_SATS = 10_000_000n; // Raised to support 0.1 BTC denomination

const DEPOSIT_STAGES: { phase: VaultPhase; label: string; icon: typeof Key }[] = [
  { phase: "preparing", label: "Preparing", icon: Loader2 },
  { phase: "keys", label: "Privacy Keys", icon: Key },
  { phase: "approving", label: "ERC20 Approval", icon: Shield },
  { phase: "submitting", label: "Relayer Submit", icon: Zap },
  { phase: "queued", label: "Batch Queue", icon: Clock },
  { phase: "proving", label: "STWO Proof", icon: Layers },
  { phase: "confirmed", label: "Confirmed", icon: CheckCircle2 },
];

const WITHDRAW_STAGES: { phase: VaultPhase; label: string; icon: typeof Key }[] = [
  { phase: "preparing", label: "Preparing", icon: Loader2 },
  { phase: "keys", label: "Spending Key", icon: Key },
  { phase: "submitting", label: "Relayer Submit", icon: Zap },
  { phase: "queued", label: "Batch Queue", icon: Clock },
  { phase: "proving", label: "STWO Proof", icon: Layers },
  { phase: "confirmed", label: "Confirmed", icon: CheckCircle2 },
];

const TRANSFER_STAGES: { phase: VaultPhase; label: string; icon: typeof Key }[] = [
  { phase: "preparing", label: "Preparing", icon: Loader2 },
  { phase: "keys", label: "Spending Key", icon: Key },
  { phase: "submitting", label: "Relayer Submit", icon: Zap },
  { phase: "queued", label: "Batch Queue", icon: Clock },
  { phase: "proving", label: "STWO Proof", icon: Layers },
  { phase: "confirmed", label: "Confirmed", icon: CheckCircle2 },
];

const PHASE_ORDER: VaultPhase[] = [
  "idle", "preparing", "keys", "approving", "submitting", "queued", "proving", "confirming", "confirmed",
];

function phaseIndex(phase: VaultPhase): number {
  const idx = PHASE_ORDER.indexOf(phase);
  return idx >= 0 ? idx : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function truncateAddress(addr: string, start = 6, end = 4): string {
  if (addr.length <= start + end + 2) return addr;
  return `${addr.slice(0, start + 2)}...${addr.slice(-end)}`;
}

function formatBalance(raw: bigint, decimals = 8): string {
  const divisor = 10n ** BigInt(decimals);
  const intPart = raw / divisor;
  const fracPart = raw % divisor;
  const fracStr = fracPart.toString().padStart(decimals, "0");
  const trimmed = fracStr.replace(/0+$/, "").padEnd(4, "0");
  return `${intPart}.${trimmed}`;
}

// Reveal animation variants
const reveal = {
  container: {
    animate: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
  },
  item: {
    initial: { opacity: 0, y: 16, filter: "blur(4px)" },
    animate: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// VaultProgressPipeline — Cinematic proving flow
// ─────────────────────────────────────────────────────────────────────────────

function VaultProgressPipeline({
  stages,
  vaultState,
  onReset,
  onCopyBatch,
  copied,
  resetLabel,
}: {
  stages: { phase: VaultPhase; label: string; icon: typeof Key }[];
  vaultState: { phase: VaultPhase; message: string; progress: number; error: string | null; batchId: string | null; queuePosition: number | null };
  onReset: () => void;
  onCopyBatch: () => void;
  copied: boolean;
  resetLabel: string;
}) {
  const isComplete = vaultState.phase === "confirmed";
  const isError = vaultState.phase === "error";

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "relative overflow-hidden rounded-2xl border p-6 space-y-5",
        isComplete
          ? "bg-emerald-950/15 border-emerald-500/20"
          : isError
            ? "bg-red-950/15 border-red-500/20"
            : "bg-gradient-to-br from-[#1a1008] via-[#12121a] to-[#12121a] border-amber-500/10"
      )}
    >
      {/* Cinematic glow */}
      {!isComplete && !isError && (
        <>
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-orange-500/[0.06] rounded-full blur-[80px] pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-amber-500/[0.04] rounded-full blur-[60px] pointer-events-none" />
        </>
      )}

      <div className="relative flex items-center justify-between">
        <span className="text-sm font-medium text-white/90 tracking-tight">{vaultState.message}</span>
        {isComplete ? (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", bounce: 0.5, delay: 0.2 }}
            className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center"
          >
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          </motion.div>
        ) : isError ? (
          <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
        ) : (
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
          </div>
        )}
      </div>

      {/* Pipeline stages */}
      <div className="relative flex items-center gap-0.5">
        {stages.map((stage) => {
          const currentIdx = phaseIndex(vaultState.phase);
          const stageIdx = phaseIndex(stage.phase);
          const done = currentIdx > stageIdx;
          const active = vaultState.phase === stage.phase;
          const StageIcon = stage.icon;

          return (
            <div key={stage.phase} className="flex-1 flex flex-col items-center gap-2.5">
              <div className="w-full flex items-center gap-0.5">
                <div className={cn(
                  "flex-1 h-1 rounded-full transition-all duration-700",
                  done ? "bg-emerald-500/40" :
                  active ? (isError ? "bg-red-500/40" : "bg-gradient-to-r from-amber-600/60 to-orange-500/40") :
                  "bg-white/[0.03]"
                )}>
                  {active && !isError && (
                    <motion.div
                      className="h-full rounded-full bg-amber-400/70"
                      initial={{ width: "0%" }}
                      animate={{ width: "100%" }}
                      transition={{ duration: 2.5, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" }}
                    />
                  )}
                </div>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <div className={cn(
                  "w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-500 border",
                  done ? "bg-emerald-500/10 border-emerald-500/15" :
                  active ? (isError ? "bg-red-500/10 border-red-500/15" : "bg-amber-500/10 border-amber-500/15") :
                  "bg-white/[0.01] border-transparent"
                )}>
                  <StageIcon className={cn(
                    "w-3 h-3 transition-colors duration-500",
                    done ? "text-emerald-400" :
                    active ? (isError ? "text-red-400" : "text-amber-400") :
                    "text-gray-800"
                  )} />
                </div>
                <span className={cn(
                  "text-[7px] uppercase tracking-[0.15em] font-semibold leading-none text-center",
                  done ? "text-emerald-500/50" :
                  active ? (isError ? "text-red-400/70" : "text-amber-400/70") :
                  "text-gray-800/50"
                )}>
                  {stage.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Overall progress bar */}
      <div className="w-full bg-white/[0.02] rounded-full h-0.5 overflow-hidden">
        <motion.div
          className={cn(
            "h-full rounded-full",
            isError ? "bg-red-500" : isComplete ? "bg-emerald-500" : "bg-gradient-to-r from-amber-600 to-orange-400"
          )}
          initial={{ width: 0 }}
          animate={{ width: `${vaultState.progress}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>

      {vaultState.error && (
        <p className="text-xs text-red-400/70 font-mono leading-relaxed">{vaultState.error}</p>
      )}

      {vaultState.batchId && (
        <div className="flex items-center justify-between pt-3 border-t border-white/[0.03]">
          <div className="flex items-center gap-2">
            <Hash className="w-3 h-3 text-gray-700" />
            <span className="text-[10px] text-gray-600 font-mono tracking-wide">
              {vaultState.batchId.slice(0, 16)}...
            </span>
          </div>
          {vaultState.queuePosition !== null && (
            <span className="text-[10px] text-gray-600 font-mono">
              Queue #{vaultState.queuePosition}
            </span>
          )}
        </div>
      )}

      {isComplete && (
        <div className="flex gap-2 pt-2">
          <button
            onClick={onReset}
            className="flex-1 py-2.5 rounded-xl text-xs font-medium bg-white/[0.02] text-gray-400 hover:text-white hover:bg-white/[0.05] transition-all border border-white/[0.04]"
          >
            {resetLabel}
          </button>
          {vaultState.batchId && (
            <button
              onClick={onCopyBatch}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-medium bg-white/[0.02] text-gray-400 hover:text-white hover:bg-white/[0.05] transition-all border border-white/[0.04]"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              Batch ID
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GardenBridgeProgress
// ─────────────────────────────────────────────────────────────────────────────

function GardenBridgeProgress({
  progress,
  depositAddress,
  depositAmount,
  orderId,
  network,
  onCopy,
  copied,
}: {
  progress: GardenOrderProgress;
  depositAddress?: string;
  depositAmount?: string;
  orderId?: string;
  network: string;
  onCopy: (text: string, key: string) => void;
  copied: string | null;
}) {
  const explorerBase = network === "mainnet"
    ? "https://explorer.garden.finance/order"
    : "https://testnet-explorer.garden.finance/order";

  const statusConfig: Record<GardenOrderProgress["status"], { label: string; color: string; pulse: boolean }> = {
    pending: { label: "Waiting for BTC deposit", color: "text-yellow-400", pulse: true },
    btc_sent: { label: "BTC transaction detected", color: "text-blue-400", pulse: true },
    confirming: { label: `Confirming (${progress.confirmations}/${progress.requiredConfirmations})`, color: "text-blue-400", pulse: true },
    swapping: { label: "Swapping via HTLC", color: "text-amber-400", pulse: true },
    complete: { label: "Bridge complete — wBTC on Starknet", color: "text-emerald-400", pulse: false },
    refunded: { label: "Bridge refunded", color: "text-red-400", pulse: false },
    error: { label: "Bridge error", color: "text-red-400", pulse: false },
  };

  const cfg = statusConfig[progress.status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border border-amber-500/10 bg-gradient-to-br from-[#1a1008] via-[#12121a] to-[#12121a] p-5 space-y-4"
    >
      <div className="absolute -top-16 -left-16 w-32 h-32 bg-orange-500/[0.05] rounded-full blur-3xl pointer-events-none" />

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {cfg.pulse && (
            <span className="relative flex h-2.5 w-2.5">
              <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", cfg.color.replace("text-", "bg-"))} />
              <span className={cn("relative inline-flex rounded-full h-2.5 w-2.5", cfg.color.replace("text-", "bg-"))} />
            </span>
          )}
          <span className={cn("text-sm font-medium", cfg.color)}>{cfg.label}</span>
        </div>
        {progress.status === "complete" ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
        ) : progress.status === "refunded" || progress.status === "error" ? (
          <AlertTriangle className="w-5 h-5 text-red-400" />
        ) : (
          <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
        )}
      </div>

      {depositAddress && progress.status === "pending" && (
        <div className="relative rounded-xl bg-black/40 border border-amber-500/8 p-4 space-y-3">
          <div className="flex items-center gap-2 text-[10px] text-amber-400/70 uppercase tracking-[0.15em] font-semibold">
            <Bitcoin className="w-3.5 h-3.5" />
            Send BTC to this address
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[13px] font-mono text-white/90 break-all bg-white/[0.02] rounded-lg p-3 border border-white/[0.03]">
              {depositAddress}
            </code>
            <button
              onClick={() => onCopy(depositAddress, "btcAddr")}
              className="p-2.5 rounded-lg bg-white/[0.02] text-gray-500 hover:text-white transition-colors border border-white/[0.03] shrink-0"
            >
              {copied === "btcAddr" ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          {depositAmount && (
            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-gray-600">Exact amount</span>
              <span className="font-mono text-white/80">{(Number(depositAmount) / 1e8).toFixed(8)} BTC</span>
            </div>
          )}
        </div>
      )}

      {(progress.status === "confirming" || progress.status === "btc_sent") && progress.requiredConfirmations > 0 && (
        <div className="space-y-2">
          <div className="w-full bg-white/[0.02] rounded-full h-2 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min((progress.confirmations / progress.requiredConfirmations) * 100, 100)}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span className="font-mono">{progress.confirmations} / {progress.requiredConfirmations} confirmations</span>
            {progress.estimatedTimeRemaining && (
              <span className="flex items-center gap-1">
                <Timer className="w-3 h-3" />
                ~{Math.ceil(progress.estimatedTimeRemaining / 60)} min
              </span>
            )}
          </div>
        </div>
      )}

      {progress.sourceTxHash && (
        <div className="flex items-center justify-between text-xs border-t border-white/[0.03] pt-2">
          <span className="text-gray-600">Source TX</span>
          <span className="font-mono text-gray-400">{progress.sourceTxHash.slice(0, 12)}...{progress.sourceTxHash.slice(-6)}</span>
        </div>
      )}

      {progress.destinationTxHash && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-600">Destination TX</span>
          <span className="font-mono text-emerald-400">{progress.destinationTxHash.slice(0, 12)}...{progress.destinationTxHash.slice(-6)}</span>
        </div>
      )}

      {orderId && (
        <a
          href={`${explorerBase}/${orderId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[10px] text-gray-600 hover:text-amber-400 transition-colors uppercase tracking-wider pt-1"
        >
          <ExternalLink className="w-3 h-3" />
          View on Garden Explorer
        </a>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SourceToggle
// ─────────────────────────────────────────────────────────────────────────────

function SourceToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string; icon: typeof Shield; description: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 p-1 rounded-xl bg-black/40 border border-white/[0.03]">
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-medium transition-all duration-200",
              active
                ? "bg-amber-500/10 text-amber-400 border border-amber-500/15"
                : "text-gray-600 hover:text-gray-300 hover:bg-white/[0.01] border border-transparent"
            )}
            title={opt.description}
          >
            <Icon className="w-3.5 h-3.5" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function BtcVaultPage() {
  const { address, isConnected } = useAccount();
  const { network } = useNetwork();
  const vault = useVM31Vault();
  const privacyKeys = usePrivacyKeys();

  // Garden Finance bridge hooks
  const gardenBridge = useGardenBridge(network === "mainnet" ? "mainnet" : "sepolia");
  const gardenWithdraw = useGardenWithdraw(network === "mainnet" ? "mainnet" : "sepolia");
  const gardenEnabled = isGardenAvailable();

  // Local UI state
  const [activeTab, setActiveTab] = useState<TabType>("deposit");
  const [selectedAsset, setSelectedAsset] = useState("wBTC");
  const [amount, setAmount] = useState("");
  const [showAssetDropdown, setShowAssetDropdown] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedNoteIdx, setSelectedNoteIdx] = useState<number | null>(null);
  const [showBalance, setShowBalance] = useState(true);

  // Deposit source toggle
  const [depositSource, setDepositSource] = useState<DepositSource>("starknet");
  const [btcAddress, setBtcAddress] = useState("");
  const [showBridgeConfirm, setShowBridgeConfirm] = useState(false);

  // Withdraw destination toggle
  const [withdrawDest, setWithdrawDest] = useState<WithdrawDest>("starknet");
  const [withdrawBtcAddress, setWithdrawBtcAddress] = useState("");
  const [useGasless, setUseGasless] = useState(true);

  // Withdraw state
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);

  // Transfer fields
  const [transferRecipient, setTransferRecipient] = useState(["", "", "", ""]);
  const [transferAmount, setTransferAmount] = useState("");
  const [showTransferConfirm, setShowTransferConfirm] = useState(false);

  // Build asset options
  const assetOptions: BtcAssetOption[] = useMemo(() => {
    const networkKey = (network || "sepolia") as keyof typeof EXTERNAL_TOKENS;
    const tokens = EXTERNAL_TOKENS[networkKey] ?? EXTERNAL_TOKENS.sepolia;
    const liveAssets = new Set(["wBTC"]);

    return BTC_VAULT_ASSETS.map((symbol) => {
      const tokenAddr = String(tokens[symbol as keyof typeof tokens] ?? "0x0");
      const available = liveAssets.has(symbol) && networkKey !== "devnet"
        ? true
        : tokenAddr !== "0x0" && tokenAddr.length > 4;
      if (symbol === "wBTC") {
        return { symbol, name: "Wrapped Bitcoin", decimals: 8, color: "#F7931A", available };
      }
      const variant = BTC_VARIANT_ASSETS[symbol];
      return {
        symbol,
        name: variant?.name || symbol,
        decimals: variant?.decimals || 8,
        color: variant?.color || "#F7931A",
        available,
      };
    });
  }, [network]);

  const currentAsset = assetOptions.find((a) => a.symbol === selectedAsset) || assetOptions[0];

  // Token balance
  const balanceQuery = vault.useTokenBalance(selectedAsset);
  const walletBalance = balanceQuery.data ?? 0n;

  // Parse amount
  const parsedAmount = useMemo(() => {
    if (!amount || isNaN(parseFloat(amount))) return 0n;
    const parts = amount.split(".");
    const intPart = parts[0] || "0";
    const decPart = (parts[1] || "").padEnd(8, "0").slice(0, 8);
    try { return BigInt(intPart + decPart); }
    catch { return 0n; }
  }, [amount]);

  // Unspent notes
  const unspentNotes = vault.getUnspentNotes(selectedAsset);
  const shieldedBalance = vault.getShieldedBalance(selectedAsset);

  // Selected note for withdrawal
  const selectedNote = useMemo((): StoredVaultNote | null => {
    if (selectedNoteIdx === null || selectedNoteIdx >= unspentNotes.length) return null;
    return unspentNotes[selectedNoteIdx];
  }, [selectedNoteIdx, unspentNotes]);

  const selectedNoteHasMerkle = useMemo(() => {
    return selectedNote?.merkleProofAvailable ?? false;
  }, [selectedNote]);

  // Transfer validation
  const parsedTransferAmount = useMemo(() => {
    if (!transferAmount || isNaN(parseFloat(transferAmount))) return 0n;
    const parts = transferAmount.split(".");
    const intPart = parts[0] || "0";
    const decPart = (parts[1] || "").padEnd(8, "0").slice(0, 8);
    try { return BigInt(intPart + decPart); }
    catch { return 0n; }
  }, [transferAmount]);

  const isRecipientValid = useMemo(() => {
    return transferRecipient.every((v) => {
      if (!v) return false;
      const n = parseInt(v, 10);
      return !isNaN(n) && n >= 0 && n <= 0x7FFFFFFF;
    });
  }, [transferRecipient]);

  const parsedRecipient = useMemo((): [number, number, number, number] | null => {
    if (!isRecipientValid) return null;
    return transferRecipient.map((v) => parseInt(v, 10)) as [number, number, number, number];
  }, [transferRecipient, isRecipientValid]);

  // Copy utility
  const handleCopy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  // Max button
  const handleMax = useCallback(() => {
    if (walletBalance > 0n) {
      setAmount(formatBalance(walletBalance, 8));
    }
  }, [walletBalance]);

  // Garden quote fetching
  const gardenAmountError = useMemo(() => {
    if (depositSource !== "btc_l1" || parsedAmount === 0n) return null;
    if (parsedAmount < GARDEN_MIN_SATS) return `Min ${Number(GARDEN_MIN_SATS) / 1e8} BTC for L1 bridge`;
    if (parsedAmount > GARDEN_MAX_SATS) return `Max ${Number(GARDEN_MAX_SATS) / 1e8} BTC for L1 bridge`;
    return null;
  }, [parsedAmount, depositSource]);

  useEffect(() => {
    if (depositSource !== "btc_l1" || !gardenEnabled) return;
    if (gardenAmountError || parsedAmount === 0n) return;
    gardenBridge.fetchQuote(parsedAmount);
  }, [parsedAmount, depositSource, gardenEnabled, gardenAmountError]);

  useEffect(() => {
    if (withdrawDest !== "btc_l1" || !gardenEnabled || activeTab !== "withdraw") return;
    if (selectedNote) {
      gardenWithdraw.fetchWithdrawQuote(BigInt(selectedNote.amount));
    }
  }, [selectedNote, withdrawDest, gardenEnabled, activeTab]);

  // BTC address validation
  const btcAddressError = useMemo(() => {
    if (!btcAddress) return null;
    if (btcAddress.length < 26 || btcAddress.length > 90) return "Invalid address length";
    const isMainnet = network === "mainnet";
    if (isMainnet) {
      if (btcAddress.startsWith("bc1") || btcAddress.startsWith("1") || btcAddress.startsWith("3")) return null;
      if (btcAddress.startsWith("tb1") || btcAddress.startsWith("2") || btcAddress.startsWith("m") || btcAddress.startsWith("n"))
        return "This is a testnet address. Use a mainnet address (bc1..., 1..., or 3...)";
      return "Invalid BTC address format";
    } else {
      if (btcAddress.startsWith("tb1") || btcAddress.startsWith("2") || btcAddress.startsWith("m") || btcAddress.startsWith("n")) return null;
      if (btcAddress.startsWith("bc1") || btcAddress.startsWith("1") || btcAddress.startsWith("3"))
        return "This is a mainnet address. Use a testnet address (tb1..., 2N..., m..., or n...)";
      return "Invalid BTC address format";
    }
  }, [btcAddress, network]);

  const isBtcAddressValid = useMemo(() => {
    return !!btcAddress && !btcAddressError;
  }, [btcAddress, btcAddressError]);

  const withdrawBtcAddressError = useMemo(() => {
    if (!withdrawBtcAddress) return null;
    if (withdrawBtcAddress.length < 26 || withdrawBtcAddress.length > 90) return "Invalid address length";
    const isMainnet = network === "mainnet";
    if (isMainnet) {
      if (withdrawBtcAddress.startsWith("bc1") || withdrawBtcAddress.startsWith("1") || withdrawBtcAddress.startsWith("3")) return null;
      if (withdrawBtcAddress.startsWith("tb1") || withdrawBtcAddress.startsWith("2") || withdrawBtcAddress.startsWith("m") || withdrawBtcAddress.startsWith("n"))
        return "This is a testnet address. Use a mainnet address (bc1..., 1..., or 3...)";
      return "Invalid BTC address format";
    } else {
      if (withdrawBtcAddress.startsWith("tb1") || withdrawBtcAddress.startsWith("2") || withdrawBtcAddress.startsWith("m") || withdrawBtcAddress.startsWith("n")) return null;
      if (withdrawBtcAddress.startsWith("bc1") || withdrawBtcAddress.startsWith("1") || withdrawBtcAddress.startsWith("3"))
        return "This is a mainnet address. Use a testnet address (tb1..., 2N..., m..., or n...)";
      return "Invalid BTC address format";
    }
  }, [withdrawBtcAddress, network]);

  const isWithdrawBtcAddressValid = useMemo(() => {
    return !!withdrawBtcAddress && !withdrawBtcAddressError;
  }, [withdrawBtcAddress, withdrawBtcAddressError]);

  // Garden bridge deposit handler
  const handleBridgeDepositClick = useCallback(() => {
    if (!isConnected || !isBtcAddressValid || parsedAmount === 0n || !gardenBridge.quote) return;
    setShowBridgeConfirm(true);
  }, [isConnected, isBtcAddressValid, parsedAmount, gardenBridge.quote]);

  const executeBridgeDeposit = useCallback(async () => {
    setShowBridgeConfirm(false);
    if (!address || !gardenBridge.quote) return;
    await gardenBridge.createBridgeOrder(
      btcAddress,
      address,
      parsedAmount,
      gardenBridge.quote.destination.amount,
    );
  }, [address, btcAddress, parsedAmount, gardenBridge]);

  // Auto-continue to VM31 after bridge completes
  useEffect(() => {
    if (gardenBridge.progress?.status !== "complete" || !gardenBridge.order?.outputAmount) return;
    vault.deposit({
      amount: gardenBridge.order.outputAmount,
      assetSymbol: "wBTC",
    }).catch(() => {});
  }, [gardenBridge.progress?.status]);

  // Garden withdraw handler
  const executeGardenWithdraw = useCallback(async () => {
    if (!address || !gardenWithdraw.quote || !isWithdrawBtcAddressValid) return;
    if (!selectedNote) return;
    await gardenWithdraw.executeWithdraw(
      address,
      withdrawBtcAddress,
      BigInt(selectedNote.amount),
      gardenWithdraw.quote.destination.amount,
      useGasless,
    );
  }, [address, withdrawBtcAddress, selectedNote, gardenWithdraw, useGasless, isWithdrawBtcAddressValid]);

  // Deposit handlers
  const handleDepositClick = useCallback(() => {
    if (!isConnected || !currentAsset.available || parsedAmount === 0n) return;
    setShowConfirmModal(true);
  }, [isConnected, currentAsset.available, parsedAmount]);

  const executeDeposit = useCallback(async () => {
    setShowConfirmModal(false);
    try {
      await vault.deposit({ amount: parsedAmount, assetSymbol: currentAsset.symbol });
    } catch {}
  }, [vault, parsedAmount, currentAsset.symbol]);

  // Withdraw handlers
  const handleWithdrawClick = useCallback(() => {
    if (!isConnected || selectedNote === null) return;
    setShowWithdrawConfirm(true);
  }, [isConnected, selectedNote]);

  const executeWithdraw = useCallback(async () => {
    setShowWithdrawConfirm(false);
    if (!selectedNote) return;
    try {
      const keyPair = await privacyKeys.unlockKeys();
      if (!keyPair) throw new Error("Failed to unlock spending key");
      const spendingKey = deriveSpendingKey(keyPair.privateKey);
      const vaultNote: VaultNote = {
        owner_pubkey: selectedNote.ownerPubkey,
        asset_id: selectedNote.assetId,
        amount_lo: selectedNote.amountLo,
        amount_hi: selectedNote.amountHi,
        blinding: selectedNote.blinding,
      };
      const merkleData = selectedNote.merkleProofAvailable && selectedNote.merklePath && selectedNote.merkleRoot
        ? { merklePath: selectedNote.merklePath, merkleRoot: selectedNote.merkleRoot, withdrawalBinding: [0, 0, 0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number, number, number] }
        : buildPlaceholderMerkleData();
      if (isMerkleDataPlaceholder(merkleData.merkleRoot)) {
        throw new Error(
          "Withdrawal requires a Merkle proof. Your deposit is confirmed but the proof " +
          "has not been indexed yet. Please wait for the next batch sync or try again later."
        );
      }
      await vault.withdraw({
        amount: BigInt(selectedNote.amount),
        assetSymbol: selectedNote.symbol,
        note: vaultNote,
        spendingKey,
        merklePath: merkleData.merklePath,
        merkleRoot: merkleData.merkleRoot,
        withdrawalBinding: merkleData.withdrawalBinding,
      });
      await vault.markVaultNoteSpent(selectedNote.commitment, vault.state.batchId || `withdraw-${Date.now()}`);
      setSelectedNoteIdx(null);
    } catch {}
  }, [selectedNote, privacyKeys, vault]);

  // Transfer handlers
  const handleTransferClick = useCallback(() => {
    if (!isConnected || !isRecipientValid || parsedTransferAmount === 0n || unspentNotes.length < 2) return;
    setShowTransferConfirm(true);
  }, [isConnected, isRecipientValid, parsedTransferAmount, unspentNotes.length]);

  const executeTransfer = useCallback(async () => {
    setShowTransferConfirm(false);
    if (!parsedRecipient || unspentNotes.length < 2) return;
    try {
      const keyPair = await privacyKeys.unlockKeys();
      if (!keyPair) throw new Error("Failed to unlock spending key");
      const spendingKey = deriveSpendingKey(keyPair.privateKey);
      const pk = keyPair.publicKey;
      const M31_MOD = 0x7FFF_FFFF;
      const senderViewingKey: [number, number, number, number] = [
        Number(pk.x & BigInt(M31_MOD)),
        Number((pk.x >> 31n) & BigInt(M31_MOD)),
        Number(pk.y & BigInt(M31_MOD)),
        Number((pk.y >> 31n) & BigInt(M31_MOD)),
      ];
      const inputNotes = unspentNotes.slice(0, 2).map((note): VaultInputNote => {
        const vaultNote: VaultNote = {
          owner_pubkey: note.ownerPubkey,
          asset_id: note.assetId,
          amount_lo: note.amountLo,
          amount_hi: note.amountHi,
          blinding: note.blinding,
        };
        const merkle = note.merkleProofAvailable && note.merklePath
          ? note.merklePath
          : { siblings: [], index: 0 };
        return { note: vaultNote, spending_key: spendingKey, merkle_path: merkle };
      }) as [VaultInputNote, VaultInputNote];
      const firstNote = unspentNotes[0];
      const merkleRoot = firstNote.merkleProofAvailable && firstNote.merkleRoot
        ? firstNote.merkleRoot
        : [0, 0, 0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number, number, number];
      await vault.transfer({
        amount: parsedTransferAmount,
        assetSymbol: currentAsset.symbol,
        recipientPubkey: parsedRecipient,
        recipientViewingKey: parsedRecipient,
        senderViewingKey,
        inputNotes,
        merkleRoot,
      });
      const batchId = vault.state.batchId || `transfer-${Date.now()}`;
      for (const note of unspentNotes.slice(0, 2)) {
        await vault.markVaultNoteSpent(note.commitment, batchId);
      }
    } catch {}
  }, [parsedRecipient, unspentNotes, privacyKeys, vault, parsedTransferAmount, currentAsset.symbol]);

  const tabs = [
    { id: "deposit" as const, label: "Deposit", icon: ArrowDownToLine },
    { id: "withdraw" as const, label: "Withdraw", icon: ArrowUpFromLine },
    { id: "transfer" as const, label: "Transfer", icon: ArrowLeftRight },
  ];

  const isActive = vault.state.phase !== "idle" && vault.state.phase !== "error";
  const isComplete = vault.state.phase === "confirmed";

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <motion.div
      variants={reveal.container}
      initial="initial"
      animate="animate"
      className="max-w-[680px] mx-auto space-y-6 px-4 sm:px-6 pb-24 lg:pb-8 relative"
    >
      {/* ── Atmospheric background ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        {/* Top amber wash */}
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-b from-amber-500/[0.025] via-orange-500/[0.015] to-transparent rounded-full blur-[120px]" />
        {/* Side accent */}
        <div className="absolute top-1/3 -right-32 w-[300px] h-[500px] bg-amber-600/[0.012] rounded-full blur-[100px]" />
        {/* Subtle grid overlay */}
        <div className="absolute inset-0 opacity-[0.015]" style={{
          backgroundImage: `linear-gradient(rgba(245,158,11,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(245,158,11,0.3) 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
        }} />
      </div>

      {/* ── Header ── */}
      <motion.div variants={reveal.item} className="relative flex items-center justify-between pt-3">
        <div className="flex items-center gap-5">
          {/* Bitcoin emblem */}
          <div className="relative group">
            <div className="absolute inset-0 bg-amber-500/20 rounded-2xl blur-xl group-hover:bg-amber-500/30 transition-colors duration-700" />
            <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/15 to-orange-600/10 border border-amber-500/20 flex items-center justify-center overflow-hidden">
              <Bitcoin className="w-8 h-8 text-amber-400" />
              {/* Embossed ring */}
              <div className="absolute inset-[3px] rounded-[13px] border border-amber-400/[0.07]" />
            </div>
            <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-lg bg-[#12121a] border border-amber-500/20 flex items-center justify-center">
              <Shield className="w-3 h-3 text-amber-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-[1.65rem] font-bold text-white tracking-tight leading-none">
                BTC Privacy Vault
              </h1>
              <LiveBadge isConnected={vault.relayerOnline || true} />
            </div>
            <p className="text-[13px] text-gray-500 mt-1.5 tracking-wide">
              Shield Bitcoin with VM31 UTXO + STARK proofs
            </p>
          </div>
        </div>
        <Link
          href="/vault"
          className="text-[10px] text-gray-600 hover:text-amber-400 transition-colors uppercase tracking-[0.2em] font-semibold"
        >
          Vault
        </Link>
      </motion.div>

      {/* ── System Status Bar ── */}
      <motion.div
        variants={reveal.item}
        className="relative overflow-hidden rounded-xl border border-white/[0.03] bg-black/30 backdrop-blur-sm px-4 py-3 flex items-center justify-between text-xs"
      >
        {/* Subtle left accent line */}
        <div className="absolute left-0 top-2 bottom-2 w-[2px] bg-gradient-to-b from-amber-500/30 via-amber-500/10 to-transparent rounded-r" />

        <div className="flex items-center gap-5 pl-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              {vault.relayerOnline && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
              )}
              <span className={cn(
                "relative inline-flex rounded-full h-2 w-2",
                vault.relayerOnline ? "bg-emerald-400" : vault.isRelayerLoading ? "bg-yellow-400" : "bg-amber-400"
              )} />
            </span>
            <span className="text-gray-500 font-medium">Relayer</span>
            <span className={cn(
              "font-mono",
              vault.relayerOnline ? "text-emerald-400/70" : "text-amber-400/70"
            )}>
              {vault.relayerOnline ? "Online" : vault.isRelayerLoading ? "..." : network === "mainnet" ? "Mainnet" : "Sepolia Testnet"}
            </span>
            {vault.relayerHealth && (
              <span className="text-gray-700 font-mono text-[10px]">v{vault.relayerHealth.version}</span>
            )}
          </div>
          {vault.relayerStatus && (
            <div className="flex items-center gap-1.5 text-gray-600">
              <Hash className="w-3 h-3" />
              <span className="font-mono">{vault.relayerStatus.pendingTransactions} pending</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          {vault.poolDeployed && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/10 text-emerald-400/70 text-[10px] uppercase tracking-[0.15em] font-semibold">
              <Shield className="w-3 h-3" /> Pool Active
            </span>
          )}
        </div>
      </motion.div>

      {/* ── Wallet Balance Card ── */}
      <motion.div
        variants={reveal.item}
        className="relative overflow-hidden rounded-2xl border border-amber-500/[0.08] bg-gradient-to-br from-[#16130e] via-[#12121a] to-[#12121a] p-6"
      >
        {/* Decorative corner accent */}
        <div className="absolute top-0 right-0 w-32 h-32">
          <div className="absolute top-4 right-4 w-16 h-16 border border-amber-500/[0.06] rounded-lg rotate-12" />
          <div className="absolute top-8 right-8 w-8 h-8 border border-amber-500/[0.04] rounded-md rotate-12" />
        </div>

        {isConnected ? (
          <div className="relative flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2.5 mb-3">
                <span className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-semibold">Wallet Balance</span>
                <button
                  onClick={() => setShowBalance(!showBalance)}
                  className="text-gray-600 hover:text-gray-400 transition-colors p-0.5"
                >
                  {showBalance ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                </button>
              </div>
              <div className="flex items-baseline gap-3">
                {balanceQuery.isLoading ? (
                  <Loader2 className="w-5 h-5 text-gray-600 animate-spin" />
                ) : (
                  <span className="text-[2rem] font-mono font-bold text-white tracking-tighter leading-none">
                    {showBalance ? formatBalance(walletBalance, 8) : "••••••••"}
                  </span>
                )}
                <span className="text-sm text-gray-500 font-semibold">{currentAsset.symbol}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2 mb-3 justify-end">
                <span className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-semibold">Shielded</span>
                <Lock className="w-3 h-3 text-amber-400/40" />
              </div>
              <div className="flex items-baseline gap-3 justify-end">
                <span className="text-[2rem] font-mono font-bold text-amber-400 tracking-tighter leading-none">
                  {showBalance ? formatBtcAmount(shieldedBalance) : "••••••••"}
                </span>
                <span className="text-sm text-gray-500 font-semibold">{currentAsset.symbol}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="relative flex flex-col items-center gap-4 py-8">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.02] border border-white/[0.04] flex items-center justify-center">
              <Wallet className="w-8 h-8 text-gray-700" />
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-400 mb-1">Connect wallet to view balances</p>
              <p className="text-[11px] text-gray-700">Supports ArgentX and Braavos</p>
            </div>
          </div>
        )}
      </motion.div>

      {/* ── Asset Selector ── */}
      <motion.div variants={reveal.item} className="relative">
        <button
          onClick={() => setShowAssetDropdown(!showAssetDropdown)}
          className={cn(
            "w-full rounded-2xl border p-4 flex items-center justify-between transition-all duration-200",
            showAssetDropdown
              ? "bg-[#12121a] border-amber-500/15"
              : "bg-[#12121a]/80 border-white/[0.04] hover:border-amber-500/10"
          )}
        >
          <div className="flex items-center gap-4">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center border"
              style={{
                backgroundColor: `${currentAsset.color}08`,
                borderColor: `${currentAsset.color}18`,
              }}
            >
              <Bitcoin className="w-5 h-5" style={{ color: currentAsset.color }} />
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-white tracking-tight">{currentAsset.symbol}</p>
              <p className="text-[11px] text-gray-500">{currentAsset.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {currentAsset.available ? (
              <span className="text-[9px] px-3 py-1 rounded-md bg-emerald-500/[0.07] text-emerald-400/70 border border-emerald-500/10 uppercase tracking-[0.15em] font-bold">
                Live
              </span>
            ) : (
              <span className="text-[9px] px-3 py-1 rounded-md bg-white/[0.02] text-gray-600 uppercase tracking-[0.15em]">
                Soon
              </span>
            )}
            <ChevronDown className={cn("w-4 h-4 text-gray-600 transition-transform duration-200", showAssetDropdown && "rotate-180")} />
          </div>
        </button>

        <AnimatePresence>
          {showAssetDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="absolute z-30 w-full mt-2 rounded-xl bg-[#14141e] border border-white/[0.06] shadow-2xl shadow-black/60 overflow-hidden backdrop-blur-2xl"
            >
              {assetOptions.map((asset, i) => (
                <button
                  key={asset.symbol}
                  onClick={() => {
                    if (asset.available) {
                      setSelectedAsset(asset.symbol);
                      setAmount("");
                    }
                    setShowAssetDropdown(false);
                  }}
                  disabled={!asset.available}
                  className={cn(
                    "w-full flex items-center justify-between p-4 transition-all",
                    asset.available ? "hover:bg-white/[0.02] cursor-pointer" : "opacity-25 cursor-not-allowed",
                    asset.symbol === selectedAsset && "bg-amber-500/[0.04]",
                    i < assetOptions.length - 1 && "border-b border-white/[0.02]"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${asset.color}0A` }}
                    >
                      <Bitcoin className="w-4 h-4" style={{ color: asset.color }} />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-white">{asset.symbol}</p>
                      <p className="text-[10px] text-gray-600">{asset.name}</p>
                    </div>
                  </div>
                  {asset.available ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/50" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-gray-700" />
                  )}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── Tab Bar ── */}
      <motion.div
        variants={reveal.item}
        className="rounded-2xl border border-white/[0.03] bg-black/30 p-1.5 flex gap-1"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                vault.reset();
                setAmount("");
                setSelectedNoteIdx(null);
                setTransferAmount("");
              }}
              className={cn(
                "flex-1 flex items-center justify-center gap-2.5 py-3.5 rounded-xl text-sm font-medium transition-all duration-200 relative",
                active
                  ? "text-amber-400"
                  : "text-gray-600 hover:text-gray-300"
              )}
            >
              {active && (
                <motion.div
                  layoutId="btcActiveTab"
                  className="absolute inset-0 rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/[0.06] border border-amber-500/12"
                  transition={{ type: "spring", duration: 0.4, bounce: 0.12 }}
                />
              )}
              <span className="relative flex items-center gap-2">
                <Icon className="w-4 h-4" />
                {tab.label}
              </span>
            </button>
          );
        })}
      </motion.div>

      {/* ── Tab Content ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* ═══════════════════════════════════════════════════════════════
             DEPOSIT TAB
             ═══════════════════════════════════════════════════════════════ */}
          {activeTab === "deposit" && (
            <div className="space-y-5">
              {/* Source Toggle */}
              {gardenEnabled && (
                <SourceToggle<DepositSource>
                  options={[
                    { id: "starknet", label: "On Starknet", icon: Shield, description: "Deposit wBTC/LBTC/tBTC already on Starknet" },
                    { id: "btc_l1", label: "From Bitcoin L1", icon: Globe, description: "Bridge native BTC via Garden Finance" },
                  ]}
                  value={depositSource}
                  onChange={(v) => {
                    setDepositSource(v);
                    setAmount("");
                    gardenBridge.reset();
                    vault.reset();
                  }}
                />
              )}

              {/* Privacy Key Initialization */}
              {isConnected && !privacyKeys.hasKeys && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="relative overflow-hidden rounded-2xl border border-amber-500/12 bg-gradient-to-r from-[#1a1008] to-[#12121a] p-6"
                >
                  <div className="absolute -top-12 -left-12 w-24 h-24 bg-amber-500/[0.08] rounded-full blur-2xl pointer-events-none" />
                  <div className="relative flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/12 flex items-center justify-center shrink-0">
                      <Key className="w-5 h-5 text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white mb-1 tracking-tight">Initialize Privacy Keys</p>
                      <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                        Generate your VM31 spending key to create shielded notes.
                        Requires one wallet signature.
                      </p>
                      <button
                        onClick={() => privacyKeys.initializeKeys()}
                        disabled={privacyKeys.isLoading}
                        className={cn(
                          "inline-flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200",
                          privacyKeys.isLoading
                            ? "bg-amber-500/[0.06] text-amber-400/50 cursor-not-allowed"
                            : "bg-amber-500/12 text-amber-400 hover:bg-amber-500/20 border border-amber-500/15 active:scale-[0.98]"
                        )}
                      >
                        {privacyKeys.isLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Key className="w-3.5 h-3.5" />
                        )}
                        {privacyKeys.isLoading ? "Signing..." : "Generate Keys"}
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Key status badge */}
              {isConnected && privacyKeys.hasKeys && (
                <div className="flex items-center gap-2.5 px-1">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/10">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    <span className="text-[10px] text-emerald-400/70 uppercase tracking-wider font-semibold">Keys Active</span>
                  </div>
                  {privacyKeys.publicKey && (
                    <button
                      onClick={() => handleCopy(
                        `${privacyKeys.publicKey!.x.toString(16).slice(0, 8)}...`,
                        "pubkey"
                      )}
                      className="text-[10px] text-gray-600 hover:text-gray-400 font-mono transition-colors"
                    >
                      {copied === "pubkey" ? <Check className="w-3 h-3 inline text-emerald-400" /> : "PK"}
                    </button>
                  )}
                </div>
              )}

              {/* Amount Card */}
              <div className="rounded-2xl border border-white/[0.04] bg-[#12121a]/90 p-6 space-y-5">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-semibold">
                      Amount
                    </label>
                    {isConnected && currentAsset.available && (
                      <button
                        onClick={handleMax}
                        className="text-[10px] text-amber-400/50 hover:text-amber-400 uppercase tracking-[0.15em] font-bold transition-colors"
                      >
                        Max
                      </button>
                    )}
                  </div>
                  <div className="relative group">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00000000"
                      value={amount}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9.]/g, "");
                        if (v.split(".").length <= 2) setAmount(v);
                      }}
                      className={cn(
                        "w-full bg-black/40 border rounded-xl px-5 py-4 text-white text-2xl font-mono tracking-tighter",
                        "focus:outline-none transition-all duration-200 placeholder:text-gray-800",
                        isActive
                          ? "border-amber-500/15 cursor-not-allowed opacity-50"
                          : "border-white/[0.05] focus:border-amber-500/25 group-hover:border-white/[0.07]"
                      )}
                      disabled={isActive || !currentAsset.available}
                    />
                    <span className="absolute right-5 top-1/2 -translate-y-1/2 text-sm text-gray-600 font-bold">
                      {currentAsset.symbol}
                    </span>
                  </div>
                </div>

                {/* Denomination Presets */}
                <div className="flex gap-1.5 flex-wrap">
                  {BTC_DENOMINATIONS.map((d) => (
                    <button
                      key={d}
                      onClick={() => setAmount(d.toString())}
                      disabled={isActive || !currentAsset.available}
                      className={cn(
                        "px-4 py-2 rounded-lg text-xs font-mono border transition-all duration-150",
                        amount === d.toString()
                          ? "border-amber-500/25 bg-amber-500/[0.07] text-amber-400"
                          : "border-white/[0.03] text-gray-600 hover:text-gray-300 hover:border-white/[0.06] hover:bg-white/[0.01]"
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>

                {/* Insufficient balance warning */}
                {depositSource === "starknet" && parsedAmount > 0n && parsedAmount > walletBalance && isConnected && (
                  <div className="flex items-center gap-2.5 text-xs text-amber-400/70 bg-amber-500/[0.03] rounded-lg p-3">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Exceeds wallet balance ({formatBalance(walletBalance, 8)} {currentAsset.symbol})</span>
                  </div>
                )}

                {/* Privacy info (Starknet source) */}
                {depositSource === "starknet" && (
                  <div className="rounded-xl bg-amber-500/[0.02] border border-amber-500/[0.06] p-4">
                    <div className="flex items-start gap-3">
                      <Shield className="w-4 h-4 text-amber-400/50 mt-0.5 shrink-0" />
                      <div className="text-[11px] text-gray-500 leading-relaxed space-y-1.5">
                        <p>
                          Your <span className="text-gray-300 font-medium">{currentAsset.symbol}</span> will
                          be shielded into a VM31 UTXO note via Poseidon2-M31 commitment. Only your
                          spending key can unlock it.
                        </p>
                        <p className="text-gray-600">
                          Batch proving via STWO STARKs. Proofs verify on-chain.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* BTC L1 Source Fields */}
                {depositSource === "btc_l1" && (
                  <>
                    <div>
                      <label className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-semibold mb-2 block">
                        Your BTC Address
                      </label>
                      <input
                        type="text"
                        placeholder={network === "mainnet" ? "bc1q..." : "tb1q... or 2N..."}
                        value={btcAddress}
                        onChange={(e) => setBtcAddress(e.target.value.trim())}
                        className="w-full bg-black/40 border border-white/[0.05] rounded-xl px-4 py-3.5 text-white text-sm font-mono focus:outline-none focus:border-amber-500/25 transition-all placeholder:text-gray-800"
                      />
                      {btcAddressError ? (
                        <p className="text-[10px] text-red-400 mt-1.5 pl-0.5">{btcAddressError}</p>
                      ) : (
                        <p className="text-[10px] text-gray-700 mt-1.5 pl-0.5">
                          Source address for the HTLC deposit (your BTC wallet)
                        </p>
                      )}
                    </div>

                    {gardenAmountError && parsedAmount > 0n && (
                      <div className="flex items-center gap-2 text-xs text-amber-400/70 bg-amber-500/[0.04] border border-amber-500/8 rounded-lg px-3 py-2">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        {gardenAmountError}
                      </div>
                    )}

                    {gardenBridge.isQuoting && parsedAmount > 0n && !gardenAmountError && (
                      <div className="flex items-center gap-2.5 text-xs text-gray-500">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400/50" />
                        Fetching Garden quote...
                      </div>
                    )}

                    {gardenBridge.quote && !gardenBridge.isQuoting && (
                      <div className="rounded-xl bg-amber-500/[0.02] border border-amber-500/[0.06] p-4 space-y-3">
                        <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
                          <Globe className="w-3.5 h-3.5 text-amber-400" />
                          Garden Finance Quote
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <p className="text-[9px] text-gray-600 uppercase tracking-wider mb-1">Fee</p>
                            <p className="text-sm font-mono text-white">{(Number(gardenBridge.quote.fee) / 1e8).toFixed(8)}</p>
                            <p className="text-[9px] text-gray-600 mt-0.5">BTC</p>
                          </div>
                          <div>
                            <p className="text-[9px] text-gray-600 uppercase tracking-wider mb-1">Receive</p>
                            <p className="text-sm font-mono text-emerald-400">{(Number(gardenBridge.quote.destination.amount) / 1e8).toFixed(8)}</p>
                            <p className="text-[9px] text-gray-600 mt-0.5">wBTC</p>
                          </div>
                          <div>
                            <p className="text-[9px] text-gray-600 uppercase tracking-wider mb-1">Est. Time</p>
                            <p className="text-sm font-mono text-white">~{Math.ceil(gardenBridge.quote.estimated_time / 60)}</p>
                            <p className="text-[9px] text-gray-600 mt-0.5">min</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2 pt-2 border-t border-white/[0.02]">
                          <Info className="w-3.5 h-3.5 text-gray-700 mt-0.5 shrink-0" />
                          <p className="text-[10px] text-gray-600 leading-relaxed">
                            BTC L1 <ArrowRight className="w-3 h-3 inline text-gray-700" /> Garden HTLC <ArrowRight className="w-3 h-3 inline text-gray-700" /> wBTC on Starknet <ArrowRight className="w-3 h-3 inline text-gray-700" /> VM31 shielded note
                          </p>
                        </div>
                      </div>
                    )}

                    {gardenBridge.error && (
                      <div className="flex items-center gap-2 text-xs text-red-400/70">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>{gardenBridge.error}</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Garden Bridge Progress */}
              {depositSource === "btc_l1" && gardenBridge.progress && (
                <GardenBridgeProgress
                  progress={gardenBridge.progress}
                  depositAddress={gardenBridge.order?.depositAddress}
                  depositAmount={gardenBridge.order?.depositAmount}
                  orderId={gardenBridge.order?.orderId}
                  network={network}
                  onCopy={handleCopy}
                  copied={copied}
                />
              )}

              {/* VM31 Progress Pipeline */}
              {(depositSource === "starknet" || gardenBridge.progress?.status === "complete") &&
                (isActive || isComplete || vault.state.phase === "error") && (
                <VaultProgressPipeline
                  stages={DEPOSIT_STAGES}
                  vaultState={vault.state}
                  onReset={() => { vault.reset(); gardenBridge.reset(); }}
                  onCopyBatch={() => vault.state.batchId && handleCopy(vault.state.batchId, "batch")}
                  copied={copied === "batch"}
                  resetLabel="New Deposit"
                />
              )}

              {/* Submit Button (Starknet ERC20) */}
              {depositSource === "starknet" && vault.state.phase === "idle" && (
                <button
                  onClick={handleDepositClick}
                  disabled={!isConnected || !currentAsset.available || parsedAmount === 0n || parsedAmount > walletBalance}
                  className={cn(
                    "w-full py-4 rounded-xl font-semibold text-sm tracking-tight transition-all duration-200 relative overflow-hidden",
                    isConnected && currentAsset.available && parsedAmount > 0n && parsedAmount <= walletBalance
                      ? "bg-gradient-to-r from-amber-600 to-orange-500 text-white shadow-xl shadow-amber-500/15 hover:shadow-amber-500/25 active:scale-[0.99]"
                      : "bg-white/[0.02] text-gray-600 cursor-not-allowed border border-white/[0.03]"
                  )}
                >
                  {isConnected && currentAsset.available && parsedAmount > 0n && parsedAmount <= walletBalance && (
                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 -translate-x-full animate-[shimmer_3s_infinite]" />
                  )}
                  <span className="relative">
                    {!isConnected
                      ? "Connect Wallet"
                      : !currentAsset.available
                        ? `${currentAsset.symbol} Coming Soon`
                        : parsedAmount === 0n
                          ? "Enter Amount"
                          : parsedAmount > walletBalance
                            ? "Insufficient Balance"
                            : `Shield ${amount} ${currentAsset.symbol}`}
                  </span>
                </button>
              )}

              {/* Submit Button (BTC L1) */}
              {depositSource === "btc_l1" && vault.state.phase === "idle" && !gardenBridge.order && (
                <button
                  onClick={handleBridgeDepositClick}
                  disabled={!isConnected || parsedAmount === 0n || !isBtcAddressValid || !gardenBridge.quote || gardenBridge.isQuoting || !!gardenAmountError}
                  className={cn(
                    "w-full py-4 rounded-xl font-semibold text-sm tracking-tight transition-all duration-200 relative overflow-hidden",
                    isConnected && parsedAmount > 0n && isBtcAddressValid && gardenBridge.quote && !gardenAmountError
                      ? "bg-gradient-to-r from-amber-600 to-orange-500 text-white shadow-xl shadow-amber-500/15 hover:shadow-amber-500/25 active:scale-[0.99]"
                      : "bg-white/[0.02] text-gray-600 cursor-not-allowed border border-white/[0.03]"
                  )}
                >
                  <span className="relative">
                    {!isConnected
                      ? "Connect Wallet"
                      : parsedAmount === 0n
                        ? "Enter BTC Amount"
                        : !isBtcAddressValid
                          ? "Enter BTC Address"
                          : gardenBridge.isQuoting
                            ? "Fetching Quote..."
                            : !gardenBridge.quote
                              ? "No Quote Available"
                              : `Bridge & Shield ${amount} BTC`}
                  </span>
                </button>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             WITHDRAW TAB
             ═══════════════════════════════════════════════════════════════ */}
          {activeTab === "withdraw" && (
            <div className="space-y-5">
              {/* Destination toggle */}
              {gardenEnabled && (
                <SourceToggle<WithdrawDest>
                  options={[
                    { id: "starknet", label: "To Starknet", icon: Shield, description: "Withdraw wBTC to your Starknet address" },
                    { id: "btc_l1", label: "To Bitcoin L1", icon: Globe, description: "Withdraw to native BTC via Garden Finance" },
                  ]}
                  value={withdrawDest}
                  onChange={(v) => {
                    setWithdrawDest(v);
                    gardenWithdraw.reset();
                    vault.reset();
                  }}
                />
              )}

              <div className="rounded-2xl border border-white/[0.04] bg-[#12121a]/90 p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-amber-500/[0.07] flex items-center justify-center">
                      <ArrowUpFromLine className="w-4 h-4 text-amber-400" />
                    </div>
                    <span className="text-sm font-semibold text-white tracking-tight">Withdraw from Vault</span>
                  </div>
                  <span className="text-[10px] text-gray-600 font-mono uppercase tracking-wider">
                    {unspentNotes.length} note{unspentNotes.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Shielded Notes List */}
                <div className="space-y-2">
                  <label className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-semibold">
                    Your Shielded Notes
                  </label>

                  {unspentNotes.length > 0 ? (
                    <div className="space-y-2">
                      {unspentNotes.map((note, i) => (
                        <button
                          key={i}
                          onClick={() => setSelectedNoteIdx(selectedNoteIdx === i ? null : i)}
                          className={cn(
                            "w-full rounded-xl p-4 border transition-all duration-200 text-left group",
                            selectedNoteIdx === i
                              ? "border-amber-500/25 bg-amber-500/[0.04]"
                              : "border-white/[0.03] bg-black/30 hover:border-white/[0.06] hover:bg-white/[0.01]"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "w-9 h-9 rounded-lg flex items-center justify-center transition-colors",
                                selectedNoteIdx === i ? "bg-amber-500/12" : "bg-white/[0.02]"
                              )}>
                                <Lock className={cn(
                                  "w-4 h-4 transition-colors",
                                  selectedNoteIdx === i ? "text-amber-400" : "text-gray-600"
                                )} />
                              </div>
                              <div>
                                <span className="text-sm font-mono text-white font-semibold tracking-tight">
                                  {formatBtcAmount(BigInt(note.amount))}
                                </span>
                                <span className="text-xs text-gray-500 ml-2">{note.symbol}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] text-gray-600 font-mono">
                                {new Date(note.createdAt).toLocaleDateString()}
                              </p>
                              {note.batchId && (
                                <p className="text-[9px] text-gray-700 font-mono mt-0.5">
                                  {note.batchId.slice(0, 8)}...
                                </p>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-white/[0.05] p-12 text-center">
                      <div className="w-16 h-16 rounded-2xl bg-white/[0.01] border border-white/[0.03] flex items-center justify-center mx-auto mb-4">
                        <Lock className="w-7 h-7 text-gray-800" />
                      </div>
                      <p className="text-sm text-gray-500 mb-1 font-medium">No shielded notes</p>
                      <p className="text-xs text-gray-700">
                        Deposit {currentAsset.symbol} to create shielded UTXO notes
                      </p>
                    </div>
                  )}
                </div>

                {/* Payout Address — Starknet */}
                {withdrawDest === "starknet" && (
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-semibold mb-2 block">
                      Payout Address
                    </label>
                    <div className="flex items-center gap-2 bg-black/40 border border-white/[0.05] rounded-xl px-4 py-3.5">
                      <span className="text-sm text-white font-mono flex-1 truncate tracking-tight">
                        {address ? truncateAddress(address) : "Connect wallet..."}
                      </span>
                      {address && (
                        <button
                          onClick={() => handleCopy(address, "addr")}
                          className="text-gray-600 hover:text-gray-400 transition-colors p-0.5"
                        >
                          {copied === "addr" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-700 mt-1.5 pl-0.5">
                      ERC20 tokens returned to your Starknet address
                    </p>
                  </div>
                )}

                {/* Payout Address — BTC L1 */}
                {withdrawDest === "btc_l1" && (
                  <>
                    <div>
                      <label className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-semibold mb-2 block">
                        BTC Payout Address
                      </label>
                      <input
                        type="text"
                        placeholder={network === "mainnet" ? "bc1q..." : "tb1q... or 2N..."}
                        value={withdrawBtcAddress}
                        onChange={(e) => setWithdrawBtcAddress(e.target.value.trim())}
                        className="w-full bg-black/40 border border-white/[0.05] rounded-xl px-4 py-3.5 text-white text-sm font-mono focus:outline-none focus:border-amber-500/25 transition-all placeholder:text-gray-800"
                      />
                      {withdrawBtcAddressError ? (
                        <p className="text-[10px] text-red-400 mt-1.5 pl-0.5">{withdrawBtcAddressError}</p>
                      ) : (
                        <p className="text-[10px] text-gray-700 mt-1.5 pl-0.5">
                          Native BTC will be sent to this address via Garden HTLC
                        </p>
                      )}
                    </div>

                    {gardenWithdraw.isQuoting && selectedNote && (
                      <div className="flex items-center gap-2.5 text-xs text-gray-500">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400/50" />
                        Fetching withdrawal quote...
                      </div>
                    )}

                    {gardenWithdraw.quote && !gardenWithdraw.isQuoting && (
                      <div className="rounded-xl bg-amber-500/[0.02] border border-amber-500/[0.06] p-4 space-y-3">
                        <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
                          <Globe className="w-3.5 h-3.5 text-amber-400" />
                          Garden Withdrawal Quote
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <p className="text-[9px] text-gray-600 uppercase tracking-wider mb-1">Fee</p>
                            <p className="text-sm font-mono text-white">{(Number(gardenWithdraw.quote.fee) / 1e8).toFixed(8)}</p>
                            <p className="text-[9px] text-gray-600 mt-0.5">wBTC</p>
                          </div>
                          <div>
                            <p className="text-[9px] text-gray-600 uppercase tracking-wider mb-1">Receive</p>
                            <p className="text-sm font-mono text-emerald-400">{(Number(gardenWithdraw.quote.destination.amount) / 1e8).toFixed(8)}</p>
                            <p className="text-[9px] text-gray-600 mt-0.5">BTC</p>
                          </div>
                          <div>
                            <p className="text-[9px] text-gray-600 uppercase tracking-wider mb-1">Est. Time</p>
                            <p className="text-sm font-mono text-white">~{Math.ceil(gardenWithdraw.quote.estimated_time / 60)}</p>
                            <p className="text-[9px] text-gray-600 mt-0.5">min</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Gasless toggle */}
                    <div className="flex items-center justify-between rounded-xl bg-black/30 border border-white/[0.03] p-3.5">
                      <div className="flex items-center gap-2.5">
                        <Zap className="w-4 h-4 text-amber-400/70" />
                        <div>
                          <p className="text-xs text-white font-medium">Gasless (SNIP-12)</p>
                          <p className="text-[10px] text-gray-600">Sign typed data instead of paying gas</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setUseGasless(!useGasless)}
                        className={cn(
                          "w-11 h-6 rounded-full transition-colors duration-200 relative",
                          useGasless ? "bg-amber-500/40" : "bg-white/[0.04] border border-white/[0.06]"
                        )}
                      >
                        <div className={cn(
                          "w-4.5 h-4.5 rounded-full bg-white absolute top-[3px] transition-transform duration-200",
                          useGasless ? "translate-x-[22px]" : "translate-x-[3px]"
                        )} />
                      </button>
                    </div>

                    {gardenWithdraw.error && (
                      <div className="flex items-center gap-2 text-xs text-red-400/70">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>{gardenWithdraw.error}</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Merkle proof warning */}
              {selectedNote && !selectedNoteHasMerkle && (
                <div className="flex items-center gap-2.5 rounded-xl bg-amber-500/[0.03] border border-amber-500/10 p-3.5 text-xs text-amber-400/70">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    Merkle inclusion proof not yet available. The relayer may reject this withdrawal until
                    proof indexing is enabled (relayer v2).
                  </span>
                </div>
              )}

              {/* Garden withdraw progress */}
              {withdrawDest === "btc_l1" && gardenWithdraw.progress && (
                <GardenBridgeProgress
                  progress={gardenWithdraw.progress}
                  orderId={gardenWithdraw.orderId ?? undefined}
                  network={network}
                  onCopy={handleCopy}
                  copied={copied}
                />
              )}

              {/* Withdraw progress pipeline */}
              {activeTab === "withdraw" && (isActive || isComplete || vault.state.phase === "error") && (
                <VaultProgressPipeline
                  stages={WITHDRAW_STAGES}
                  vaultState={vault.state}
                  onReset={() => { vault.reset(); gardenWithdraw.reset(); }}
                  onCopyBatch={() => vault.state.batchId && handleCopy(vault.state.batchId, "batch")}
                  copied={copied === "batch"}
                  resetLabel="New Withdrawal"
                />
              )}

              {/* Withdraw button — Starknet */}
              {withdrawDest === "starknet" && vault.state.phase === "idle" && (
                <button
                  onClick={handleWithdrawClick}
                  disabled={selectedNoteIdx === null || !isConnected}
                  className={cn(
                    "w-full py-4 rounded-xl font-semibold text-sm tracking-tight transition-all duration-200",
                    selectedNoteIdx !== null && isConnected
                      ? "bg-gradient-to-r from-amber-600 to-orange-500 text-white shadow-xl shadow-amber-500/15 hover:shadow-amber-500/25 active:scale-[0.99]"
                      : "bg-white/[0.02] text-gray-600 cursor-not-allowed border border-white/[0.03]"
                  )}
                >
                  {!isConnected
                    ? "Connect Wallet"
                    : selectedNote !== null
                      ? `Withdraw ${formatBtcAmount(BigInt(selectedNote.amount))} ${currentAsset.symbol}`
                      : "Select a Note to Withdraw"}
                </button>
              )}

              {/* Withdraw button — BTC L1 */}
              {withdrawDest === "btc_l1" && vault.state.phase === "idle" && !gardenWithdraw.orderId && (
                <button
                  onClick={async () => {
                    setShowWithdrawConfirm(false);
                    if (!selectedNote) return;
                    try {
                      await executeWithdraw();
                      await executeGardenWithdraw();
                    } catch {}
                  }}
                  disabled={
                    selectedNoteIdx === null ||
                    !isConnected ||
                    !isWithdrawBtcAddressValid ||
                    !gardenWithdraw.quote ||
                    gardenWithdraw.isExecuting
                  }
                  className={cn(
                    "w-full py-4 rounded-xl font-semibold text-sm tracking-tight transition-all duration-200",
                    selectedNoteIdx !== null && isConnected && isWithdrawBtcAddressValid && gardenWithdraw.quote
                      ? "bg-gradient-to-r from-amber-600 to-orange-500 text-white shadow-xl shadow-amber-500/15 hover:shadow-amber-500/25 active:scale-[0.99]"
                      : "bg-white/[0.02] text-gray-600 cursor-not-allowed border border-white/[0.03]"
                  )}
                >
                  {!isConnected
                    ? "Connect Wallet"
                    : selectedNote === null
                      ? "Select a Note"
                      : !isWithdrawBtcAddressValid
                        ? "Enter BTC Address"
                        : gardenWithdraw.isExecuting
                          ? "Processing..."
                          : !gardenWithdraw.quote
                            ? "No Quote Available"
                            : "Withdraw to BTC L1"}
                </button>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
             TRANSFER TAB
             ═══════════════════════════════════════════════════════════════ */}
          {activeTab === "transfer" && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-white/[0.04] bg-[#12121a]/90 p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-amber-500/[0.07] flex items-center justify-center">
                    <ArrowLeftRight className="w-4 h-4 text-amber-400" />
                  </div>
                  <span className="text-sm font-semibold text-white tracking-tight">Private Transfer</span>
                </div>

                {/* Recipient VM31 Pubkey */}
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-semibold mb-2 block">
                    Recipient VM31 Public Key
                  </label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {transferRecipient.map((val, i) => (
                      <input
                        key={i}
                        type="text"
                        inputMode="numeric"
                        placeholder={`u32[${i}]`}
                        value={val}
                        onChange={(e) => {
                          const next = [...transferRecipient];
                          next[i] = e.target.value.replace(/[^0-9]/g, "");
                          setTransferRecipient(next);
                        }}
                        className="w-full bg-black/40 border border-white/[0.05] rounded-lg px-2.5 py-3 text-white text-xs font-mono text-center focus:outline-none focus:border-amber-500/25 transition-all placeholder:text-gray-800"
                      />
                    ))}
                  </div>
                </div>

                {/* Amount */}
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-semibold mb-2 block">
                    Transfer Amount
                  </label>
                  <div className="relative group">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00000000"
                      value={transferAmount}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9.]/g, "");
                        if (v.split(".").length <= 2) setTransferAmount(v);
                      }}
                      className="w-full bg-black/40 border border-white/[0.05] rounded-xl px-5 py-4 text-white text-xl font-mono tracking-tighter focus:outline-none focus:border-amber-500/25 group-hover:border-white/[0.07] transition-all placeholder:text-gray-800"
                    />
                    <span className="absolute right-5 top-1/2 -translate-y-1/2 text-sm text-gray-600 font-bold">
                      {currentAsset.symbol}
                    </span>
                  </div>
                </div>

                {/* 2-in/2-out info */}
                <div className="rounded-xl bg-indigo-500/[0.02] border border-indigo-500/[0.06] p-4">
                  <div className="flex items-start gap-3">
                    <Info className="w-4 h-4 text-indigo-400/50 mt-0.5 shrink-0" />
                    <div className="text-[11px] text-gray-500 leading-relaxed">
                      <p>
                        Private transfers use a <span className="text-gray-300 font-medium">2-input / 2-output</span> structure.
                        Input notes are consumed and nullified. Two new notes are created: one for the
                        recipient and a change note back to you.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Auto-selected input notes */}
                {unspentNotes.length > 0 && (
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-semibold mb-2 block">
                      Input Notes (auto-selected)
                    </label>
                    <div className="space-y-1.5">
                      {unspentNotes.slice(0, 2).map((note, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between rounded-lg bg-black/30 border border-white/[0.03] p-3"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="w-6 h-6 rounded-md bg-amber-500/[0.07] flex items-center justify-center text-[9px] font-mono text-amber-400 font-bold">
                              {i + 1}
                            </div>
                            <span className="text-xs font-mono text-white tracking-tight">
                              {formatBtcAmount(BigInt(note.amount))} {note.symbol}
                            </span>
                          </div>
                          <Lock className="w-3 h-3 text-gray-700" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Recipient validation error */}
              {transferRecipient.some((v) => v !== "") && !isRecipientValid && (
                <div className="flex items-center gap-2.5 text-xs text-red-400/70 bg-red-500/[0.03] rounded-lg p-3">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>Each pubkey field must be a valid u32 (0 to 2,147,483,647)</span>
                </div>
              )}

              {/* Insufficient shielded balance */}
              {parsedTransferAmount > 0n && parsedTransferAmount > shieldedBalance && (
                <div className="flex items-center gap-2.5 text-xs text-amber-400/70 bg-amber-500/[0.03] rounded-lg p-3">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>Transfer exceeds shielded balance ({formatBtcAmount(shieldedBalance)} {currentAsset.symbol})</span>
                </div>
              )}

              {/* Merkle proof warning */}
              {unspentNotes.length >= 2 && unspentNotes.slice(0, 2).some((n) => !n.merkleProofAvailable) && (
                <div className="flex items-center gap-2.5 rounded-xl bg-amber-500/[0.03] border border-amber-500/10 p-3.5 text-xs text-amber-400/70">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    Input notes lack merkle inclusion proofs. The relayer may reject this transfer
                    until proof indexing is enabled (relayer v2).
                  </span>
                </div>
              )}

              {/* Transfer progress */}
              {activeTab === "transfer" && (isActive || isComplete || vault.state.phase === "error") && (
                <VaultProgressPipeline
                  stages={TRANSFER_STAGES}
                  vaultState={vault.state}
                  onReset={() => vault.reset()}
                  onCopyBatch={() => vault.state.batchId && handleCopy(vault.state.batchId, "batch")}
                  copied={copied === "batch"}
                  resetLabel="New Transfer"
                />
              )}

              {/* Transfer button */}
              {vault.state.phase === "idle" && (
                <button
                  onClick={handleTransferClick}
                  disabled={unspentNotes.length < 2 || !isRecipientValid || parsedTransferAmount === 0n || !isConnected}
                  className={cn(
                    "w-full py-4 rounded-xl font-semibold text-sm tracking-tight transition-all duration-200",
                    unspentNotes.length >= 2 && isRecipientValid && parsedTransferAmount > 0n && isConnected
                      ? "bg-gradient-to-r from-amber-600 to-orange-500 text-white shadow-xl shadow-amber-500/15 hover:shadow-amber-500/25 active:scale-[0.99]"
                      : "bg-white/[0.02] text-gray-600 cursor-not-allowed border border-white/[0.03]"
                  )}
                >
                  {!isConnected
                    ? "Connect Wallet"
                    : unspentNotes.length < 2
                      ? "Need 2+ Notes"
                      : !isRecipientValid
                        ? "Enter Valid Recipient"
                        : parsedTransferAmount === 0n
                          ? "Enter Amount"
                          : `Transfer ${transferAmount} ${currentAsset.symbol}`}
                </button>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* ── Vault Statistics ── */}
      <motion.div
        variants={reveal.item}
        className="rounded-2xl border border-white/[0.03] bg-[#12121a]/70 p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[10px] text-gray-500 uppercase tracking-[0.2em] font-bold">Vault Statistics</h3>
          <button
            onClick={() => balanceQuery.refetch?.()}
            className="text-gray-700 hover:text-amber-400 transition-colors p-1.5 rounded-lg hover:bg-white/[0.02]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            { label: "Shielded", value: formatBtcAmount(shieldedBalance), unit: currentAsset.symbol, icon: Bitcoin, color: "text-amber-400", glow: "bg-amber-500/[0.06]" },
            { label: "Notes", value: unspentNotes.length.toString(), unit: "active", icon: Shield, color: "text-emerald-400", glow: "bg-emerald-500/[0.06]" },
            { label: "Queue", value: vault.relayerStatus?.pendingTransactions.toString() ?? "—", unit: "txs", icon: Clock, color: "text-blue-400", glow: "bg-blue-500/[0.06]" },
            { label: "Prover", value: "STWO", unit: "STARK", icon: Zap, color: "text-amber-400", glow: "bg-amber-500/[0.06]" },
            { label: "Set Size", value: vault.poolDeployed ? "Active" : "—", unit: "", icon: Users, color: "text-purple-400", glow: "bg-purple-500/[0.06]" },
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="rounded-xl bg-black/30 border border-white/[0.02] p-4 text-center group hover:border-white/[0.04] transition-all"
              >
                <div className={cn("w-8 h-8 rounded-lg mx-auto mb-2.5 flex items-center justify-center", stat.glow)}>
                  <Icon className={cn("w-3.5 h-3.5", stat.color)} />
                </div>
                <p className="text-sm font-mono text-white leading-none font-bold">{stat.value}</p>
                <p className="text-[8px] text-gray-600 mt-2 uppercase tracking-[0.15em]">
                  {stat.unit ? `${stat.label} (${stat.unit})` : stat.label}
                </p>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* ── How It Works ── */}
      <motion.div
        variants={reveal.item}
        className="rounded-2xl border border-white/[0.03] bg-[#12121a]/50 overflow-hidden"
      >
        <button
          onClick={() => setShowInfo(!showInfo)}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/[0.005] transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <Info className="w-4 h-4 text-amber-400/40" />
            <span className="text-sm font-medium text-gray-400">How BTC Privacy Vaults Work</span>
          </div>
          <ChevronDown className={cn("w-4 h-4 text-gray-600 transition-transform duration-300", showInfo && "rotate-180")} />
        </button>

        <AnimatePresence>
          {showInfo && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="px-6 pb-6 space-y-3.5">
                {[
                  {
                    step: "1",
                    title: "Deposit",
                    desc: "Your BTC-backed ERC20 (wBTC, LBTC, etc.) is locked in VM31Pool. A shielded UTXO note is created with a Poseidon2-M31 commitment.",
                  },
                  {
                    step: "2",
                    title: "Batch Proving",
                    desc: "The VM31 relayer batches transactions and generates a STWO STARK proof. Verified on-chain by VM31Verifier.",
                  },
                  {
                    step: "3",
                    title: "Transfer",
                    desc: "Send shielded BTC to another VM31 public key. 2-in/2-out transactions — input notes are nullified, new notes created.",
                  },
                  {
                    step: "4",
                    title: "Withdraw",
                    desc: "Prove note ownership via spending key. The underlying ERC20 is returned to your Starknet address.",
                  },
                ].map((item) => (
                  <div key={item.step} className="flex items-start gap-4">
                    <span className="w-7 h-7 rounded-lg bg-amber-500/[0.07] flex items-center justify-center text-[10px] font-mono text-amber-400 font-bold shrink-0 mt-0.5">
                      {item.step}
                    </span>
                    <p className="text-[11px] text-gray-500 leading-relaxed">
                      <span className="text-gray-300 font-semibold">{item.title}:</span>{" "}
                      {item.desc}
                    </p>
                  </div>
                ))}
                <div className="mt-3 pt-3 border-t border-white/[0.02]">
                  <p className="text-[10px] text-gray-700 leading-relaxed">
                    The VM31 system is fully asset-agnostic — the same prover and circuits handle all token types.
                    BTC variants are registered as new asset IDs in the pool.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── External Link ── */}
      <motion.div variants={reveal.item} className="text-center pb-6">
        <a
          href="https://starkgate.starknet.io"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-[11px] text-gray-600 hover:text-amber-400 transition-colors group"
        >
          <ExternalLink className="w-3 h-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          Get wBTC on Starknet via StarkGate
        </a>
      </motion.div>

      {/* ── Confirmation Modals ── */}
      <TransactionConfirmModal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirm={executeDeposit}
        title={`Shield ${amount} ${currentAsset.symbol}`}
        description="Your BTC will be locked in the VM31Pool and converted into a shielded UTXO note with a Poseidon2-M31 commitment."
        variant="privacy"
        details={[
          { label: "Amount", value: `${amount} ${currentAsset.symbol}`, isCurrency: true },
          { label: "Destination", value: "VM31 Privacy Pool" },
          { label: "Proof System", value: "STWO STARK" },
          { label: "Bridge Fee", value: "0 (direct ERC20)" },
          { label: "Network", value: network === "mainnet" ? "Starknet Mainnet" : "Starknet Sepolia" },
        ]}
        estimatedGas="~0.001 ETH"
        isLoading={isActive}
      />

      <TransactionConfirmModal
        isOpen={showBridgeConfirm}
        onClose={() => setShowBridgeConfirm(false)}
        onConfirm={executeBridgeDeposit}
        title={`Bridge & Shield ${amount} BTC`}
        description="Native BTC will be bridged via Garden Finance HTLC to wBTC on Starknet, then automatically shielded into a VM31 UTXO note."
        variant="privacy"
        details={[
          { label: "Send", value: `${amount} BTC`, isCurrency: true },
          { label: "Receive", value: gardenBridge.quote ? `${(Number(gardenBridge.quote.destination.amount) / 1e8).toFixed(8)} wBTC` : "—", isCurrency: true },
          { label: "Bridge Fee", value: gardenBridge.quote ? `${(Number(gardenBridge.quote.fee) / 1e8).toFixed(8)} BTC` : "—" },
          { label: "Bridge", value: "Garden Finance (HTLC)" },
          { label: "Est. Time", value: gardenBridge.quote ? `~${Math.ceil(gardenBridge.quote.estimated_time / 60)} min` : "—" },
          { label: "Destination", value: "VM31 Privacy Pool" },
          { label: "Network", value: network === "mainnet" ? "Mainnet" : "Sepolia (Testnet)" },
        ]}
        estimatedGas="Gas-free (BTC L1 tx fee applies)"
        isLoading={!!gardenBridge.order}
      />

      <TransactionConfirmModal
        isOpen={showWithdrawConfirm}
        onClose={() => setShowWithdrawConfirm(false)}
        onConfirm={executeWithdraw}
        title={selectedNote ? `Withdraw ${formatBtcAmount(BigInt(selectedNote.amount))} ${currentAsset.symbol}` : "Withdraw"}
        description="Your shielded UTXO note will be consumed and the underlying ERC20 tokens returned to your Starknet address."
        variant="privacy"
        details={[
          { label: "Amount", value: selectedNote ? `${formatBtcAmount(BigInt(selectedNote.amount))} ${selectedNote.symbol}` : "—", isCurrency: true },
          { label: "Source", value: "VM31 Privacy Pool" },
          { label: "Destination", value: address ? truncateAddress(address) : "—", isAddress: true },
          { label: "Proof System", value: "STWO STARK" },
          { label: "Merkle Proof", value: selectedNoteHasMerkle ? "Available" : "Placeholder (may fail)" },
          { label: "Network", value: network === "mainnet" ? "Starknet Mainnet" : "Starknet Sepolia" },
        ]}
        estimatedGas="~0.001 ETH"
        isLoading={isActive}
      />

      <TransactionConfirmModal
        isOpen={showTransferConfirm}
        onClose={() => setShowTransferConfirm(false)}
        onConfirm={executeTransfer}
        title={`Transfer ${transferAmount} ${currentAsset.symbol}`}
        description="Two input notes will be consumed and nullified. Two new notes are created: one for the recipient and a change note back to you."
        variant="privacy"
        details={[
          { label: "Amount", value: `${transferAmount} ${currentAsset.symbol}`, isCurrency: true },
          { label: "Recipient", value: parsedRecipient ? `[${parsedRecipient.join(", ")}]` : "—" },
          { label: "Input Notes", value: `${Math.min(unspentNotes.length, 2)} notes` },
          { label: "Structure", value: "2-in / 2-out UTXO" },
          { label: "Proof System", value: "STWO STARK" },
          { label: "Network", value: network === "mainnet" ? "Starknet Mainnet" : "Starknet Sepolia" },
        ]}
        estimatedGas="~0.001 ETH"
        isLoading={isActive}
      />
    </motion.div>
  );
}
