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

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

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

const BTC_DENOMINATIONS = [0.0001, 0.001, 0.01, 0.05, 0.1] as const;

// Deposit flow stages for the progress pipeline
const DEPOSIT_STAGES: {
  phase: VaultPhase;
  label: string;
  icon: typeof Key;
}[] = [
  { phase: "preparing", label: "Preparing", icon: Loader2 },
  { phase: "keys", label: "Privacy Keys", icon: Key },
  { phase: "approving", label: "ERC20 Approval", icon: Shield },
  { phase: "submitting", label: "Relayer Submit", icon: Zap },
  { phase: "queued", label: "Batch Queue", icon: Clock },
  { phase: "proving", label: "STWO Proof", icon: Layers },
  { phase: "confirmed", label: "Confirmed", icon: CheckCircle2 },
];

const WITHDRAW_STAGES: {
  phase: VaultPhase;
  label: string;
  icon: typeof Key;
}[] = [
  { phase: "preparing", label: "Preparing", icon: Loader2 },
  { phase: "keys", label: "Spending Key", icon: Key },
  { phase: "submitting", label: "Relayer Submit", icon: Zap },
  { phase: "queued", label: "Batch Queue", icon: Clock },
  { phase: "proving", label: "STWO Proof", icon: Layers },
  { phase: "confirmed", label: "Confirmed", icon: CheckCircle2 },
];

const TRANSFER_STAGES: {
  phase: VaultPhase;
  label: string;
  icon: typeof Key;
}[] = [
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

// ============================================================================
// HELPERS
// ============================================================================

function truncateAddress(addr: string, start = 6, end = 4): string {
  if (addr.length <= start + end + 2) return addr;
  return `${addr.slice(0, start + 2)}...${addr.slice(-end)}`;
}

function formatBalance(raw: bigint, decimals = 8): string {
  const divisor = 10n ** BigInt(decimals);
  const intPart = raw / divisor;
  const fracPart = raw % divisor;
  const fracStr = fracPart.toString().padStart(decimals, "0");
  // Show up to 8 decimals, trim trailing zeros but keep at least 4
  const trimmed = fracStr.replace(/0+$/, "").padEnd(4, "0");
  return `${intPart}.${trimmed}`;
}

// ============================================================================
// VaultProgressPipeline — shared progress UI for deposit/withdraw/transfer
// ============================================================================

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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-5 space-y-4"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-white">{vaultState.message}</span>
        {isComplete ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
        ) : isError ? (
          <AlertTriangle className="w-5 h-5 text-red-400" />
        ) : (
          <Loader2 className="w-5 h-5 text-orange-400 animate-spin" />
        )}
      </div>

      {/* Stage indicators */}
      <div className="flex items-center gap-1">
        {stages.map((stage) => {
          const currentIdx = phaseIndex(vaultState.phase);
          const stageIdx = phaseIndex(stage.phase);
          const done = currentIdx > stageIdx;
          const active = vaultState.phase === stage.phase;

          return (
            <div key={stage.phase} className="flex-1 flex flex-col items-center gap-1.5">
              <div className={cn(
                "w-full h-1 rounded-full transition-colors duration-500",
                done ? "bg-emerald-500/60" :
                active ? (isError ? "bg-red-500/60" : "bg-orange-500/60") :
                "bg-surface-dark/60"
              )} />
              <span className={cn(
                "text-[9px] uppercase tracking-wider font-medium",
                done ? "text-emerald-500/70" :
                active ? (isError ? "text-red-400" : "text-orange-400") :
                "text-gray-700"
              )}>
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Overall progress bar */}
      <div className="w-full bg-surface-dark/40 rounded-full h-1">
        <motion.div
          className={cn(
            "h-full rounded-full",
            isError ? "bg-red-500" :
            isComplete ? "bg-emerald-500" : "bg-gradient-to-r from-orange-500 to-amber-500"
          )}
          initial={{ width: 0 }}
          animate={{ width: `${vaultState.progress}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>

      {vaultState.error && (
        <p className="text-xs text-red-400/90">{vaultState.error}</p>
      )}

      {/* Batch info */}
      {vaultState.batchId && (
        <div className="flex items-center justify-between pt-2 border-t border-surface-border/20">
          <div className="flex items-center gap-2">
            <Hash className="w-3 h-3 text-gray-600" />
            <span className="text-xs text-gray-500 font-mono">
              {vaultState.batchId.slice(0, 12)}...
            </span>
          </div>
          {vaultState.queuePosition !== null && (
            <span className="text-xs text-gray-600">
              Queue #{vaultState.queuePosition}
            </span>
          )}
        </div>
      )}

      {/* Success actions */}
      {isComplete && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={onReset}
            className="flex-1 py-2 rounded-lg text-xs font-medium bg-surface-dark/50 text-gray-400 hover:text-white transition-colors border border-surface-border/30"
          >
            {resetLabel}
          </button>
          {vaultState.batchId && (
            <button
              onClick={onCopyBatch}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-surface-dark/50 text-gray-400 hover:text-white transition-colors border border-surface-border/30"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              Batch ID
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ============================================================================
// GardenBridgeProgress — shows BTC bridge status (deposit address, confirmations)
// ============================================================================

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
    swapping: { label: "Swapping via HTLC", color: "text-orange-400", pulse: true },
    complete: { label: "Bridge complete — wBTC on Starknet", color: "text-emerald-400", pulse: false },
    refunded: { label: "Bridge refunded", color: "text-red-400", pulse: false },
    error: { label: "Bridge error", color: "text-red-400", pulse: false },
  };

  const cfg = statusConfig[progress.status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-5 space-y-4"
    >
      {/* Status header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {cfg.pulse && <span className="w-2 h-2 rounded-full bg-current animate-pulse" style={{ color: cfg.color.replace("text-", "") }} />}
          <span className={cn("text-sm font-medium", cfg.color)}>{cfg.label}</span>
        </div>
        {progress.status === "complete" ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-400" />
        ) : progress.status === "refunded" || progress.status === "error" ? (
          <AlertTriangle className="w-5 h-5 text-red-400" />
        ) : (
          <Loader2 className="w-5 h-5 text-orange-400 animate-spin" />
        )}
      </div>

      {/* BTC deposit address (shown before BTC is sent) */}
      {depositAddress && progress.status === "pending" && (
        <div className="rounded-xl bg-surface-dark/50 border border-orange-500/15 p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wider">
            <Bitcoin className="w-3.5 h-3.5 text-orange-400" />
            Send BTC to this address
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm font-mono text-white break-all bg-surface-dark/60 rounded-lg p-3 border border-surface-border/20">
              {depositAddress}
            </code>
            <button
              onClick={() => onCopy(depositAddress, "btcAddr")}
              className="p-2 rounded-lg bg-surface-dark/50 text-gray-400 hover:text-white transition-colors border border-surface-border/20 shrink-0"
            >
              {copied === "btcAddr" ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          {depositAmount && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Exact amount</span>
              <span className="font-mono text-white">{(Number(depositAmount) / 1e8).toFixed(8)} BTC</span>
            </div>
          )}
        </div>
      )}

      {/* Confirmation progress bar */}
      {(progress.status === "confirming" || progress.status === "btc_sent") && progress.requiredConfirmations > 0 && (
        <div className="space-y-2">
          <div className="w-full bg-surface-dark/40 rounded-full h-1.5">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min((progress.confirmations / progress.requiredConfirmations) * 100, 100)}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span>{progress.confirmations} / {progress.requiredConfirmations} confirmations</span>
            {progress.estimatedTimeRemaining && (
              <span className="flex items-center gap-1">
                <Timer className="w-3 h-3" />
                ~{Math.ceil(progress.estimatedTimeRemaining / 60)} min
              </span>
            )}
          </div>
        </div>
      )}

      {/* Source TX hash */}
      {progress.sourceTxHash && (
        <div className="flex items-center justify-between text-xs border-t border-surface-border/20 pt-2">
          <span className="text-gray-600">Source TX</span>
          <span className="font-mono text-gray-400">{progress.sourceTxHash.slice(0, 12)}...{progress.sourceTxHash.slice(-6)}</span>
        </div>
      )}

      {/* Destination TX hash */}
      {progress.destinationTxHash && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-600">Destination TX</span>
          <span className="font-mono text-emerald-400">{progress.destinationTxHash.slice(0, 12)}...{progress.destinationTxHash.slice(-6)}</span>
        </div>
      )}

      {/* Garden explorer link */}
      {orderId && (
        <a
          href={`${explorerBase}/${orderId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-orange-400 transition-colors pt-1"
        >
          <ExternalLink className="w-3 h-3" />
          View on Garden Explorer
        </a>
      )}
    </motion.div>
  );
}

// ============================================================================
// SourceToggle — toggle between Starknet ERC20 and Bitcoin L1
// ============================================================================

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
    <div className="flex gap-1.5 p-1 rounded-xl bg-surface-dark/30 border border-surface-border/20">
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition-all duration-150",
              active
                ? "bg-orange-500/15 text-orange-400 shadow-inner shadow-orange-500/5 border border-orange-500/20"
                : "text-gray-600 hover:text-gray-300 hover:bg-white/[0.02] border border-transparent"
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

// ============================================================================
// PAGE
// ============================================================================

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

  // Deposit source toggle (Starknet ERC20 vs Bitcoin L1)
  const [depositSource, setDepositSource] = useState<DepositSource>("starknet");
  const [btcAddress, setBtcAddress] = useState("");
  const [showBridgeConfirm, setShowBridgeConfirm] = useState(false);

  // Withdraw destination toggle (Starknet vs Bitcoin L1)
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
    const tokens = EXTERNAL_TOKENS[network as keyof typeof EXTERNAL_TOKENS];
    return BTC_VAULT_ASSETS.map((symbol) => {
      const tokenAddr = tokens?.[symbol as keyof typeof tokens] || "0x0";
      const available = tokenAddr !== "0x0" && BigInt(tokenAddr as string) !== 0n;
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

  // Token balance query
  const balanceQuery = vault.useTokenBalance(selectedAsset);
  const walletBalance = balanceQuery.data ?? 0n;

  // Parse amount input → base units (8 decimals)
  const parsedAmount = useMemo(() => {
    if (!amount || isNaN(parseFloat(amount))) return 0n;
    const parts = amount.split(".");
    const intPart = parts[0] || "0";
    const decPart = (parts[1] || "").padEnd(8, "0").slice(0, 8);
    try { return BigInt(intPart + decPart); }
    catch { return 0n; }
  }, [amount]);

  // Unspent notes for selected asset
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

  // Max button handler
  const handleMax = useCallback(() => {
    if (walletBalance > 0n) {
      setAmount(formatBalance(walletBalance, 8));
    }
  }, [walletBalance]);

  // Garden quote fetching (when deposit source is BTC L1)
  useEffect(() => {
    if (depositSource !== "btc_l1" || !gardenEnabled) return;
    gardenBridge.fetchQuote(parsedAmount);
  }, [parsedAmount, depositSource, gardenEnabled]);

  // Garden withdraw quote fetching
  useEffect(() => {
    if (withdrawDest !== "btc_l1" || !gardenEnabled || activeTab !== "withdraw") return;
    if (selectedNote) {
      gardenWithdraw.fetchWithdrawQuote(BigInt(selectedNote.amount));
    }
  }, [selectedNote, withdrawDest, gardenEnabled, activeTab]);

  // BTC address validation (basic)
  const isBtcAddressValid = useMemo(() => {
    if (!btcAddress) return false;
    // Testnet: tb1/2/m/n prefixes; Mainnet: bc1/1/3 prefixes
    return btcAddress.length >= 26 && btcAddress.length <= 90;
  }, [btcAddress]);

  const isWithdrawBtcAddressValid = useMemo(() => {
    if (!withdrawBtcAddress) return false;
    return withdrawBtcAddress.length >= 26 && withdrawBtcAddress.length <= 90;
  }, [withdrawBtcAddress]);

  // Handle Garden bridge deposit (BTC L1 → Starknet → VM31)
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

  // After Garden bridge completes, auto-continue to VM31 deposit
  useEffect(() => {
    if (gardenBridge.progress?.status !== "complete" || !gardenBridge.order?.outputAmount) return;

    // wBTC has arrived on Starknet — trigger VM31 deposit
    vault.deposit({
      amount: gardenBridge.order.outputAmount,
      assetSymbol: "wBTC",
    }).catch(() => {
      // Error handled by vault hook
    });
  }, [gardenBridge.progress?.status]);

  // Handle Garden withdraw (VM31 → wBTC → BTC L1)
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

  // Deposit handler (opens confirm modal first)
  const handleDepositClick = useCallback(() => {
    if (!isConnected || !currentAsset.available || parsedAmount === 0n) return;
    setShowConfirmModal(true);
  }, [isConnected, currentAsset.available, parsedAmount]);

  // Execute deposit after confirmation
  const executeDeposit = useCallback(async () => {
    setShowConfirmModal(false);
    try {
      await vault.deposit({
        amount: parsedAmount,
        assetSymbol: currentAsset.symbol,
      });
    } catch {
      // Error state is handled by the vault hook
    }
  }, [vault, parsedAmount, currentAsset.symbol]);

  // Withdraw handler (opens confirm modal)
  const handleWithdrawClick = useCallback(() => {
    if (!isConnected || selectedNote === null) return;
    setShowWithdrawConfirm(true);
  }, [isConnected, selectedNote]);

  // Execute withdraw after confirmation
  const executeWithdraw = useCallback(async () => {
    setShowWithdrawConfirm(false);
    if (!selectedNote) return;

    try {
      const keyPair = await privacyKeys.unlockKeys();
      if (!keyPair) throw new Error("Failed to unlock spending key");

      const spendingKey = deriveSpendingKey(keyPair.privateKey);

      // Reconstruct VaultNote from stored data
      const vaultNote: VaultNote = {
        owner_pubkey: selectedNote.ownerPubkey,
        asset_id: selectedNote.assetId,
        amount_lo: selectedNote.amountLo,
        amount_hi: selectedNote.amountHi,
        blinding: selectedNote.blinding,
      };

      // Use stored merkle data or placeholder
      const merkleData = selectedNote.merkleProofAvailable && selectedNote.merklePath && selectedNote.merkleRoot
        ? {
            merklePath: selectedNote.merklePath,
            merkleRoot: selectedNote.merkleRoot,
            withdrawalBinding: [0, 0, 0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number, number, number],
          }
        : buildPlaceholderMerkleData();

      // Block withdrawal with placeholder (all-zero) merkle data — prover will reject it
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

      // Mark note as spent on success
      await vault.markVaultNoteSpent(
        selectedNote.commitment,
        vault.state.batchId || `withdraw-${Date.now()}`,
      );
      setSelectedNoteIdx(null);
    } catch {
      // Error state is handled by the vault hook
    }
  }, [selectedNote, privacyKeys, vault]);

  // Transfer handler (opens confirm modal)
  const handleTransferClick = useCallback(() => {
    if (!isConnected || !isRecipientValid || parsedTransferAmount === 0n || unspentNotes.length < 2) return;
    setShowTransferConfirm(true);
  }, [isConnected, isRecipientValid, parsedTransferAmount, unspentNotes.length]);

  // Execute transfer after confirmation
  const executeTransfer = useCallback(async () => {
    setShowTransferConfirm(false);
    if (!parsedRecipient || unspentNotes.length < 2) return;

    try {
      const keyPair = await privacyKeys.unlockKeys();
      if (!keyPair) throw new Error("Failed to unlock spending key");

      const spendingKey = deriveSpendingKey(keyPair.privateKey);
      // Derive sender viewing key from pubkey (same limb split as deposit)
      const pk = keyPair.publicKey;
      const M31_MOD = 0x7FFF_FFFF;
      const senderViewingKey: [number, number, number, number] = [
        Number(pk.x & BigInt(M31_MOD)),
        Number((pk.x >> 31n) & BigInt(M31_MOD)),
        Number(pk.y & BigInt(M31_MOD)),
        Number((pk.y >> 31n) & BigInt(M31_MOD)),
      ];

      // Build input notes from first 2 unspent notes
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

        return {
          note: vaultNote,
          spending_key: spendingKey,
          merkle_path: merkle,
        };
      }) as [VaultInputNote, VaultInputNote];

      // Use stored merkle root from first note, or placeholder
      const firstNote = unspentNotes[0];
      const merkleRoot = firstNote.merkleProofAvailable && firstNote.merkleRoot
        ? firstNote.merkleRoot
        : [0, 0, 0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number, number, number];

      await vault.transfer({
        amount: parsedTransferAmount,
        assetSymbol: currentAsset.symbol,
        recipientPubkey: parsedRecipient,
        recipientViewingKey: parsedRecipient, // recipient viewing key = pubkey in this context
        senderViewingKey,
        inputNotes,
        merkleRoot,
      });

      // Mark both input notes as spent
      const batchId = vault.state.batchId || `transfer-${Date.now()}`;
      for (const note of unspentNotes.slice(0, 2)) {
        await vault.markVaultNoteSpent(note.commitment, batchId);
      }
    } catch {
      // Error state is handled by the vault hook
    }
  }, [parsedRecipient, unspentNotes, privacyKeys, vault, parsedTransferAmount, currentAsset.symbol]);

  const tabs = [
    { id: "deposit" as const, label: "Deposit", icon: ArrowDownToLine },
    { id: "withdraw" as const, label: "Withdraw", icon: ArrowUpFromLine },
    { id: "transfer" as const, label: "Transfer", icon: ArrowLeftRight },
  ];

  const isActive = vault.state.phase !== "idle" && vault.state.phase !== "error";
  const isComplete = vault.state.phase === "confirmed";

  return (
    <div className="max-w-2xl mx-auto space-y-5 p-4 sm:p-6 pb-20">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 rounded-xl bg-orange-500/15 border border-orange-500/20 flex items-center justify-center">
              <Bitcoin className="w-6 h-6 text-orange-400" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-surface-dark border-2 border-surface-card flex items-center justify-center">
              <Shield className="w-2.5 h-2.5 text-orange-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white tracking-tight">BTC Privacy Vault</h1>
              <LiveBadge isConnected={vault.relayerOnline} />
            </div>
            <p className="text-sm text-gray-500">
              Shield Bitcoin with VM31 UTXO notes + STARK proofs
            </p>
          </div>
        </div>
        <Link
          href="/wallet"
          className="text-xs text-gray-600 hover:text-gray-300 transition-colors uppercase tracking-wider"
        >
          Wallet
        </Link>
      </div>

      {/* ── System Status Bar ── */}
      <div className="glass-card p-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "w-1.5 h-1.5 rounded-full",
              vault.relayerOnline ? "bg-emerald-400" : vault.isRelayerLoading ? "bg-yellow-400 animate-pulse" : "bg-red-400"
            )} />
            <span className="text-gray-500">Relayer</span>
            <span className={cn(vault.relayerOnline ? "text-emerald-400" : "text-gray-600")}>
              {vault.relayerOnline ? "Online" : vault.isRelayerLoading ? "..." : "Offline"}
            </span>
            {vault.relayerHealth && (
              <span className="text-gray-700">v{vault.relayerHealth.version}</span>
            )}
          </div>
          {vault.relayerStatus && (
            <div className="flex items-center gap-1.5 text-gray-600">
              <Hash className="w-3 h-3" />
              <span>{vault.relayerStatus.pendingTransactions} pending</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {vault.poolDeployed && (
            <span className="flex items-center gap-1 text-emerald-400">
              <Shield className="w-3 h-3" /> Pool Active
            </span>
          )}
        </div>
      </div>

      {/* ── Wallet Balance Card ── */}
      <div className="glass-card p-4">
        {isConnected ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Wallet Balance</span>
                <button
                  onClick={() => setShowBalance(!showBalance)}
                  className="text-gray-600 hover:text-gray-400 transition-colors"
                >
                  {showBalance ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                </button>
              </div>
              <div className="flex items-baseline gap-2">
                {balanceQuery.isLoading ? (
                  <Loader2 className="w-5 h-5 text-gray-600 animate-spin" />
                ) : (
                  <span className="text-2xl font-mono font-bold text-white tracking-tight">
                    {showBalance ? formatBalance(walletBalance, 8) : "••••••"}
                  </span>
                )}
                <span className="text-sm text-gray-500">{currentAsset.symbol}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Shielded</span>
                <Lock className="w-3 h-3 text-orange-400/60" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-mono font-bold text-orange-400 tracking-tight">
                  {showBalance ? formatBtcAmount(shieldedBalance) : "••••••"}
                </span>
                <span className="text-sm text-gray-500">{currentAsset.symbol}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-4">
            <Wallet className="w-8 h-8 text-gray-600" />
            <p className="text-sm text-gray-500">Connect wallet to view balances</p>
          </div>
        )}
      </div>

      {/* ── Asset Selector ── */}
      <div className="relative">
        <button
          onClick={() => setShowAssetDropdown(!showAssetDropdown)}
          className="w-full glass-card p-3 flex items-center justify-between hover:border-orange-500/20 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center border"
              style={{
                backgroundColor: `${currentAsset.color}12`,
                borderColor: `${currentAsset.color}25`,
              }}
            >
              <Bitcoin className="w-4.5 h-4.5" style={{ color: currentAsset.color }} />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-white">{currentAsset.symbol}</p>
              <p className="text-xs text-gray-500">{currentAsset.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {currentAsset.available ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 uppercase tracking-wider font-medium">
                Live
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-600 uppercase tracking-wider">
                Soon
              </span>
            )}
            <ChevronDown className={cn("w-4 h-4 text-gray-600 transition-transform duration-200", showAssetDropdown && "rotate-180")} />
          </div>
        </button>

        <AnimatePresence>
          {showAssetDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.12 }}
              className="absolute z-30 w-full mt-1.5 rounded-xl bg-surface-card border border-surface-border/60 shadow-2xl shadow-black/40 overflow-hidden backdrop-blur-xl"
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
                    "w-full flex items-center justify-between p-3 transition-colors",
                    asset.available ? "hover:bg-white/[0.03]" : "opacity-35 cursor-not-allowed",
                    asset.symbol === selectedAsset && "bg-orange-500/[0.06]",
                    i < assetOptions.length - 1 && "border-b border-surface-border/30"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${asset.color}15` }}
                    >
                      <Bitcoin className="w-4 h-4" style={{ color: asset.color }} />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-white">{asset.symbol}</p>
                      <p className="text-[11px] text-gray-600">{asset.name}</p>
                    </div>
                  </div>
                  {asset.available ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/70" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-gray-700" />
                  )}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Tab Bar ── */}
      <div className="glass-card p-1 flex gap-0.5">
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
                "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                active
                  ? "bg-orange-500/15 text-orange-400 shadow-inner shadow-orange-500/5"
                  : "text-gray-600 hover:text-gray-300 hover:bg-white/[0.02]"
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Tab Content ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.12 }}
        >
          {/* ══════════ DEPOSIT TAB ══════════ */}
          {activeTab === "deposit" && (
            <div className="space-y-4">
              {/* Source Toggle: Starknet ERC20 vs Bitcoin L1 */}
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

              {/* Privacy Key Status */}
              {isConnected && !privacyKeys.hasKeys && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="glass-card p-4 border-orange-500/20"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                      <Key className="w-5 h-5 text-orange-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white mb-1">Initialize Privacy Keys</p>
                      <p className="text-xs text-gray-500 mb-3">
                        Generate your VM31 spending key to create shielded notes.
                        Requires one wallet signature.
                      </p>
                      <button
                        onClick={() => privacyKeys.initializeKeys()}
                        disabled={privacyKeys.isLoading}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500/20 text-orange-400 text-xs font-medium hover:bg-orange-500/30 transition-colors border border-orange-500/20"
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

              {/* Key status badge (when keys exist) */}
              {isConnected && privacyKeys.hasKeys && (
                <div className="flex items-center gap-2 px-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-xs text-emerald-400/80">Privacy keys active</span>
                  {privacyKeys.publicKey && (
                    <button
                      onClick={() => handleCopy(
                        `${privacyKeys.publicKey!.x.toString(16).slice(0, 8)}...`,
                        "pubkey"
                      )}
                      className="text-xs text-gray-600 hover:text-gray-400 font-mono transition-colors"
                    >
                      {copied === "pubkey" ? <Check className="w-3 h-3 inline" /> : "PK"}
                    </button>
                  )}
                </div>
              )}

              {/* Amount Card */}
              <div className="glass-card p-5 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-gray-500 uppercase tracking-wider">
                      Amount
                    </label>
                    {isConnected && currentAsset.available && (
                      <button
                        onClick={handleMax}
                        className="text-[10px] text-orange-400/70 hover:text-orange-400 uppercase tracking-wider font-medium transition-colors"
                      >
                        Max
                      </button>
                    )}
                  </div>
                  <div className="relative">
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
                        "w-full bg-surface-dark/60 border rounded-xl px-4 py-4 text-white text-xl font-mono tracking-tight",
                        "focus:outline-none transition-colors placeholder:text-gray-700",
                        isActive
                          ? "border-orange-500/30 cursor-not-allowed opacity-60"
                          : "border-surface-border/40 focus:border-orange-500/40"
                      )}
                      disabled={isActive || !currentAsset.available}
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-600 font-medium">
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
                        "px-3 py-1.5 rounded-lg text-xs font-mono border transition-all duration-150",
                        amount === d.toString()
                          ? "border-orange-500/40 bg-orange-500/10 text-orange-400"
                          : "border-surface-border/30 text-gray-600 hover:text-gray-300 hover:border-surface-border/60"
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>

                {/* Insufficient balance warning (Starknet source only) */}
                {depositSource === "starknet" && parsedAmount > 0n && parsedAmount > walletBalance && isConnected && (
                  <div className="flex items-center gap-2 text-xs text-amber-400/80">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Exceeds wallet balance ({formatBalance(walletBalance, 8)} {currentAsset.symbol})</span>
                  </div>
                )}

                {/* Privacy info (Starknet source) */}
                {depositSource === "starknet" && (
                  <div className="rounded-xl bg-orange-500/[0.04] border border-orange-500/10 p-3.5">
                    <div className="flex items-start gap-2.5">
                      <Shield className="w-4 h-4 text-orange-400/70 mt-0.5 shrink-0" />
                      <div className="text-[11px] text-gray-500 leading-relaxed space-y-1">
                        <p>
                          Your <span className="text-gray-400">{currentAsset.symbol}</span> will
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

                {/* ── BTC L1 Source Fields ── */}
                {depositSource === "btc_l1" && (
                  <>
                    {/* BTC address input */}
                    <div>
                      <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">
                        Your BTC Address
                      </label>
                      <input
                        type="text"
                        placeholder={network === "mainnet" ? "bc1q..." : "tb1q... or 2N..."}
                        value={btcAddress}
                        onChange={(e) => setBtcAddress(e.target.value.trim())}
                        className="w-full bg-surface-dark/50 border border-surface-border/30 rounded-xl px-4 py-3 text-white text-sm font-mono focus:outline-none focus:border-orange-500/40 transition-colors placeholder:text-gray-700"
                      />
                      <p className="text-[10px] text-gray-700 mt-1.5 pl-1">
                        Source address for the HTLC deposit (your BTC wallet)
                      </p>
                    </div>

                    {/* Garden quote display */}
                    {gardenBridge.isQuoting && parsedAmount > 0n && (
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Fetching Garden quote...
                      </div>
                    )}

                    {gardenBridge.quote && !gardenBridge.isQuoting && (
                      <div className="rounded-xl bg-orange-500/[0.04] border border-orange-500/10 p-3.5 space-y-2">
                        <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
                          <Globe className="w-3.5 h-3.5 text-orange-400" />
                          Garden Finance Quote
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <p className="text-[10px] text-gray-600 uppercase tracking-wider">Fee</p>
                            <p className="text-sm font-mono text-white">
                              {(Number(gardenBridge.quote.fee) / 1e8).toFixed(8)}
                            </p>
                            <p className="text-[10px] text-gray-600">BTC</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-gray-600 uppercase tracking-wider">Receive</p>
                            <p className="text-sm font-mono text-emerald-400">
                              {(Number(gardenBridge.quote.destination.amount) / 1e8).toFixed(8)}
                            </p>
                            <p className="text-[10px] text-gray-600">wBTC</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-gray-600 uppercase tracking-wider">Est. Time</p>
                            <p className="text-sm font-mono text-white">
                              ~{Math.ceil(gardenBridge.quote.estimated_time / 60)}
                            </p>
                            <p className="text-[10px] text-gray-600">min</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2 pt-1.5 border-t border-surface-border/15">
                          <Info className="w-3.5 h-3.5 text-gray-600 mt-0.5 shrink-0" />
                          <p className="text-[10px] text-gray-600 leading-relaxed">
                            BTC L1 <ArrowRight className="w-3 h-3 inline" /> Garden HTLC <ArrowRight className="w-3 h-3 inline" /> wBTC on Starknet <ArrowRight className="w-3 h-3 inline" /> VM31 shielded note
                          </p>
                        </div>
                      </div>
                    )}

                    {gardenBridge.error && (
                      <div className="flex items-center gap-2 text-xs text-red-400/80">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>{gardenBridge.error}</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── Garden Bridge Progress (BTC L1 source) ── */}
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

              {/* ── VM31 Progress Pipeline (shown after bridge completes, or for Starknet source) ── */}
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

              {/* ── Submit Button (Starknet ERC20 source) ── */}
              {depositSource === "starknet" && vault.state.phase === "idle" && (
                <button
                  onClick={handleDepositClick}
                  disabled={
                    !isConnected ||
                    !currentAsset.available ||
                    parsedAmount === 0n ||
                    parsedAmount > walletBalance
                  }
                  className={cn(
                    "w-full py-3.5 rounded-xl font-medium text-sm transition-all duration-200",
                    isConnected && currentAsset.available && parsedAmount > 0n && parsedAmount <= walletBalance
                      ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 shadow-lg shadow-orange-500/20 active:scale-[0.99]"
                      : "bg-surface-dark/40 text-gray-600 cursor-not-allowed border border-surface-border/20"
                  )}
                >
                  {!isConnected
                    ? "Connect Wallet"
                    : !currentAsset.available
                      ? `${currentAsset.symbol} Coming Soon`
                      : parsedAmount === 0n
                        ? "Enter Amount"
                        : parsedAmount > walletBalance
                          ? "Insufficient Balance"
                          : `Shield ${amount} ${currentAsset.symbol}`}
                </button>
              )}

              {/* ── Submit Button (BTC L1 source) ── */}
              {depositSource === "btc_l1" && vault.state.phase === "idle" && !gardenBridge.order && (
                <button
                  onClick={handleBridgeDepositClick}
                  disabled={
                    !isConnected ||
                    parsedAmount === 0n ||
                    !isBtcAddressValid ||
                    !gardenBridge.quote ||
                    gardenBridge.isQuoting
                  }
                  className={cn(
                    "w-full py-3.5 rounded-xl font-medium text-sm transition-all duration-200",
                    isConnected && parsedAmount > 0n && isBtcAddressValid && gardenBridge.quote
                      ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 shadow-lg shadow-orange-500/20 active:scale-[0.99]"
                      : "bg-surface-dark/40 text-gray-600 cursor-not-allowed border border-surface-border/20"
                  )}
                >
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
                </button>
              )}
            </div>
          )}

          {/* ══════════ WITHDRAW TAB ══════════ */}
          {activeTab === "withdraw" && (
            <div className="space-y-4">
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

              <div className="glass-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ArrowUpFromLine className="w-4 h-4 text-orange-400" />
                    <span className="text-sm font-medium text-white">Withdraw from Vault</span>
                  </div>
                  <span className="text-xs text-gray-600">
                    {unspentNotes.length} note{unspentNotes.length !== 1 ? "s" : ""} available
                  </span>
                </div>

                {/* Shielded Notes List */}
                <div className="space-y-2">
                  <label className="text-xs text-gray-500 uppercase tracking-wider">
                    Your Shielded Notes
                  </label>

                  {unspentNotes.length > 0 ? (
                    <div className="space-y-2">
                      {unspentNotes.map((note, i) => (
                        <button
                          key={i}
                          onClick={() => setSelectedNoteIdx(selectedNoteIdx === i ? null : i)}
                          className={cn(
                            "w-full rounded-xl p-3 border transition-all text-left",
                            selectedNoteIdx === i
                              ? "border-orange-500/40 bg-orange-500/[0.06]"
                              : "border-surface-border/30 bg-surface-dark/30 hover:border-surface-border/60"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                                <Lock className="w-3.5 h-3.5 text-orange-400" />
                              </div>
                              <div>
                                <span className="text-sm font-mono text-white">
                                  {formatBtcAmount(BigInt(note.amount))}
                                </span>
                                <span className="text-xs text-gray-500 ml-1.5">{note.symbol}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] text-gray-600">
                                {new Date(note.createdAt).toLocaleDateString()}
                              </p>
                              {note.batchId && (
                                <p className="text-[10px] text-gray-700 font-mono">
                                  {note.batchId.slice(0, 8)}...
                                </p>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-surface-border/30 p-8 text-center">
                      <div className="w-12 h-12 rounded-xl bg-surface-dark/50 flex items-center justify-center mx-auto mb-3">
                        <Lock className="w-6 h-6 text-gray-700" />
                      </div>
                      <p className="text-sm text-gray-500 mb-1">No shielded notes</p>
                      <p className="text-xs text-gray-700">
                        Deposit {currentAsset.symbol} to create shielded UTXO notes
                      </p>
                    </div>
                  )}
                </div>

                {/* Recipient — Starknet address (default) */}
                {withdrawDest === "starknet" && (
                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">
                      Payout Address
                    </label>
                    <div className="flex items-center gap-2 bg-surface-dark/40 border border-surface-border/30 rounded-xl px-4 py-3">
                      <span className="text-sm text-white font-mono flex-1 truncate">
                        {address ? truncateAddress(address) : "Connect wallet..."}
                      </span>
                      {address && (
                        <button
                          onClick={() => handleCopy(address, "addr")}
                          className="text-gray-600 hover:text-gray-400 transition-colors"
                        >
                          {copied === "addr" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-700 mt-1.5 pl-1">
                      ERC20 tokens returned to your Starknet address
                    </p>
                  </div>
                )}

                {/* Recipient — BTC L1 address */}
                {withdrawDest === "btc_l1" && (
                  <>
                    <div>
                      <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">
                        BTC Payout Address
                      </label>
                      <input
                        type="text"
                        placeholder={network === "mainnet" ? "bc1q..." : "tb1q... or 2N..."}
                        value={withdrawBtcAddress}
                        onChange={(e) => setWithdrawBtcAddress(e.target.value.trim())}
                        className="w-full bg-surface-dark/50 border border-surface-border/30 rounded-xl px-4 py-3 text-white text-sm font-mono focus:outline-none focus:border-orange-500/40 transition-colors placeholder:text-gray-700"
                      />
                      <p className="text-[10px] text-gray-700 mt-1.5 pl-1">
                        Native BTC will be sent to this address via Garden HTLC
                      </p>
                    </div>

                    {/* Garden withdraw quote */}
                    {gardenWithdraw.isQuoting && selectedNote && (
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Fetching withdrawal quote...
                      </div>
                    )}

                    {gardenWithdraw.quote && !gardenWithdraw.isQuoting && (
                      <div className="rounded-xl bg-orange-500/[0.04] border border-orange-500/10 p-3.5 space-y-2">
                        <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
                          <Globe className="w-3.5 h-3.5 text-orange-400" />
                          Garden Withdrawal Quote
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <p className="text-[10px] text-gray-600 uppercase tracking-wider">Fee</p>
                            <p className="text-sm font-mono text-white">
                              {(Number(gardenWithdraw.quote.fee) / 1e8).toFixed(8)}
                            </p>
                            <p className="text-[10px] text-gray-600">wBTC</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-gray-600 uppercase tracking-wider">Receive</p>
                            <p className="text-sm font-mono text-emerald-400">
                              {(Number(gardenWithdraw.quote.destination.amount) / 1e8).toFixed(8)}
                            </p>
                            <p className="text-[10px] text-gray-600">BTC</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-gray-600 uppercase tracking-wider">Est. Time</p>
                            <p className="text-sm font-mono text-white">
                              ~{Math.ceil(gardenWithdraw.quote.estimated_time / 60)}
                            </p>
                            <p className="text-[10px] text-gray-600">min</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Gasless toggle */}
                    <div className="flex items-center justify-between rounded-xl bg-surface-dark/30 border border-surface-border/20 p-3">
                      <div className="flex items-center gap-2">
                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                        <div>
                          <p className="text-xs text-white font-medium">Gasless (SNIP-12)</p>
                          <p className="text-[10px] text-gray-600">Sign typed data instead of paying gas</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setUseGasless(!useGasless)}
                        className={cn(
                          "w-10 h-5 rounded-full transition-colors duration-200 relative",
                          useGasless ? "bg-orange-500/60" : "bg-surface-dark/60 border border-surface-border/30"
                        )}
                      >
                        <div className={cn(
                          "w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform duration-200",
                          useGasless ? "translate-x-5" : "translate-x-0.5"
                        )} />
                      </button>
                    </div>

                    {gardenWithdraw.error && (
                      <div className="flex items-center gap-2 text-xs text-red-400/80">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>{gardenWithdraw.error}</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Merkle proof warning */}
              {selectedNote && !selectedNoteHasMerkle && (
                <div className="flex items-center gap-2 rounded-xl bg-amber-500/[0.06] border border-amber-500/15 p-3 text-xs text-amber-400/90">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    Merkle inclusion proof not yet available. The relayer may reject this withdrawal until
                    proof indexing is enabled (relayer v2).
                  </span>
                </div>
              )}

              {/* Garden withdraw progress (BTC L1 destination) */}
              {withdrawDest === "btc_l1" && gardenWithdraw.progress && (
                <GardenBridgeProgress
                  progress={gardenWithdraw.progress}
                  orderId={gardenWithdraw.orderId ?? undefined}
                  network={network}
                  onCopy={handleCopy}
                  copied={copied}
                />
              )}

              {/* Withdraw progress pipeline (VM31 stage) */}
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

              {/* Withdraw button — Starknet destination */}
              {withdrawDest === "starknet" && vault.state.phase === "idle" && (
                <button
                  onClick={handleWithdrawClick}
                  disabled={selectedNoteIdx === null || !isConnected}
                  className={cn(
                    "w-full py-3.5 rounded-xl font-medium text-sm transition-all duration-200",
                    selectedNoteIdx !== null && isConnected
                      ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 shadow-lg shadow-orange-500/20 active:scale-[0.99]"
                      : "bg-surface-dark/40 text-gray-600 cursor-not-allowed border border-surface-border/20"
                  )}
                >
                  {!isConnected
                    ? "Connect Wallet"
                    : selectedNote !== null
                      ? `Withdraw ${formatBtcAmount(BigInt(selectedNote.amount))} ${currentAsset.symbol}`
                      : "Select a Note to Withdraw"}
                </button>
              )}

              {/* Withdraw button — BTC L1 destination */}
              {withdrawDest === "btc_l1" && vault.state.phase === "idle" && !gardenWithdraw.orderId && (
                <button
                  onClick={async () => {
                    setShowWithdrawConfirm(false);
                    // First: VM31 withdraw (shielded note → wBTC on Starknet)
                    // Then: Garden swap (wBTC → BTC via HTLC)
                    if (!selectedNote) return;
                    try {
                      // Execute the VM31 withdraw first
                      await executeWithdraw();
                      // Then execute Garden bridge swap to BTC L1
                      await executeGardenWithdraw();
                    } catch {
                      // Error handled by hooks
                    }
                  }}
                  disabled={
                    selectedNoteIdx === null ||
                    !isConnected ||
                    !isWithdrawBtcAddressValid ||
                    !gardenWithdraw.quote ||
                    gardenWithdraw.isExecuting
                  }
                  className={cn(
                    "w-full py-3.5 rounded-xl font-medium text-sm transition-all duration-200",
                    selectedNoteIdx !== null && isConnected && isWithdrawBtcAddressValid && gardenWithdraw.quote
                      ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 shadow-lg shadow-orange-500/20 active:scale-[0.99]"
                      : "bg-surface-dark/40 text-gray-600 cursor-not-allowed border border-surface-border/20"
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
                            : `Withdraw to BTC L1`}
                </button>
              )}
            </div>
          )}

          {/* ══════════ TRANSFER TAB ══════════ */}
          {activeTab === "transfer" && (
            <div className="space-y-4">
              <div className="glass-card p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-orange-400" />
                  <span className="text-sm font-medium text-white">Private Transfer</span>
                </div>

                {/* Recipient VM31 Pubkey */}
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">
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
                        className="w-full bg-surface-dark/50 border border-surface-border/30 rounded-lg px-2.5 py-2.5 text-white text-xs font-mono text-center focus:outline-none focus:border-orange-500/40 transition-colors placeholder:text-gray-700"
                      />
                    ))}
                  </div>
                </div>

                {/* Amount */}
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">
                    Transfer Amount
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00000000"
                      value={transferAmount}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9.]/g, "");
                        if (v.split(".").length <= 2) setTransferAmount(v);
                      }}
                      className="w-full bg-surface-dark/50 border border-surface-border/30 rounded-xl px-4 py-3.5 text-white text-lg font-mono focus:outline-none focus:border-orange-500/40 transition-colors placeholder:text-gray-700"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-600">
                      {currentAsset.symbol}
                    </span>
                  </div>
                </div>

                {/* 2-in/2-out info */}
                <div className="rounded-xl bg-indigo-500/[0.04] border border-indigo-500/10 p-3.5">
                  <div className="flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-indigo-400/70 mt-0.5 shrink-0" />
                    <div className="text-[11px] text-gray-500 leading-relaxed">
                      <p>
                        Private transfers use a <span className="text-gray-400">2-input / 2-output</span> structure.
                        Input notes are consumed and nullified. Two new notes are created: one for the
                        recipient and a change note back to you.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Note auto-selection */}
                {unspentNotes.length > 0 && (
                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-wider mb-2 block">
                      Input Notes (auto-selected)
                    </label>
                    <div className="space-y-1.5">
                      {unspentNotes.slice(0, 2).map((note, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between rounded-lg bg-surface-dark/30 border border-surface-border/20 p-2.5"
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded bg-orange-500/10 flex items-center justify-center text-[9px] font-mono text-orange-400">
                              {i + 1}
                            </div>
                            <span className="text-xs font-mono text-white">
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
                <div className="flex items-center gap-2 text-xs text-red-400/80">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Each pubkey field must be a valid u32 (0 to 2,147,483,647)</span>
                </div>
              )}

              {/* Insufficient shielded balance warning */}
              {parsedTransferAmount > 0n && parsedTransferAmount > shieldedBalance && (
                <div className="flex items-center gap-2 text-xs text-amber-400/80">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Transfer amount exceeds shielded balance ({formatBtcAmount(shieldedBalance)} {currentAsset.symbol})</span>
                </div>
              )}

              {/* Merkle proof warning for input notes */}
              {unspentNotes.length >= 2 && unspentNotes.slice(0, 2).some((n) => !n.merkleProofAvailable) && (
                <div className="flex items-center gap-2 rounded-xl bg-amber-500/[0.06] border border-amber-500/15 p-3 text-xs text-amber-400/90">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    Input notes lack merkle inclusion proofs. The relayer may reject this transfer
                    until proof indexing is enabled (relayer v2).
                  </span>
                </div>
              )}

              {/* Transfer progress pipeline */}
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
                  disabled={
                    unspentNotes.length < 2 ||
                    !isRecipientValid ||
                    parsedTransferAmount === 0n ||
                    !isConnected
                  }
                  className={cn(
                    "w-full py-3.5 rounded-xl font-medium text-sm transition-all duration-200",
                    unspentNotes.length >= 2 && isRecipientValid && parsedTransferAmount > 0n && isConnected
                      ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 shadow-lg shadow-orange-500/20 active:scale-[0.99]"
                      : "bg-surface-dark/40 text-gray-600 cursor-not-allowed border border-surface-border/20"
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
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs text-gray-500 uppercase tracking-wider font-medium">Vault Statistics</h3>
          <button
            onClick={() => balanceQuery.refetch?.()}
            className="text-gray-700 hover:text-gray-400 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            {
              label: "Shielded",
              value: formatBtcAmount(shieldedBalance),
              unit: currentAsset.symbol,
              icon: Bitcoin,
              color: "text-orange-400",
            },
            {
              label: "Notes",
              value: unspentNotes.length.toString(),
              unit: "active",
              icon: Shield,
              color: "text-emerald-400",
            },
            {
              label: "Queue",
              value: vault.relayerStatus?.pendingTransactions.toString() ?? "—",
              unit: "txs",
              icon: Clock,
              color: "text-blue-400",
            },
            {
              label: "Prover",
              value: "STWO",
              unit: "STARK",
              icon: Zap,
              color: "text-amber-400",
            },
            {
              label: "Set Size",
              value: vault.poolDeployed ? "Active" : "—",
              unit: "",
              icon: Users,
              color: "text-purple-400",
            },
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="rounded-xl bg-surface-dark/30 border border-surface-border/15 p-3 text-center"
              >
                <Icon className={cn("w-3.5 h-3.5 mx-auto mb-1.5", stat.color)} style={{ opacity: 0.6 }} />
                <p className="text-sm font-mono text-white leading-none">{stat.value}</p>
                <p className="text-[9px] text-gray-600 mt-1 uppercase tracking-wider">
                  {stat.unit ? `${stat.label} (${stat.unit})` : stat.label}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── How It Works ── */}
      <div className="glass-card overflow-hidden">
        <button
          onClick={() => setShowInfo(!showInfo)}
          className="w-full p-4 flex items-center justify-between hover:bg-white/[0.01] transition-colors"
        >
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-orange-400/60" />
            <span className="text-sm font-medium text-gray-400">How BTC Privacy Vaults Work</span>
          </div>
          <ChevronDown className={cn("w-4 h-4 text-gray-600 transition-transform duration-200", showInfo && "rotate-180")} />
        </button>

        <AnimatePresence>
          {showInfo && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-3">
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
                  <div key={item.step} className="flex items-start gap-3">
                    <span className="w-5 h-5 rounded-md bg-orange-500/10 flex items-center justify-center text-[10px] font-mono text-orange-400 shrink-0 mt-0.5">
                      {item.step}
                    </span>
                    <p className="text-[11px] text-gray-500 leading-relaxed">
                      <span className="text-gray-300 font-medium">{item.title}:</span>{" "}
                      {item.desc}
                    </p>
                  </div>
                ))}
                <div className="mt-1 pt-2 border-t border-surface-border/20">
                  <p className="text-[10px] text-gray-700 leading-relaxed">
                    The VM31 system is fully asset-agnostic — the same prover and circuits handle all token types.
                    BTC variants are registered as new asset IDs in the pool.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── External Link ── */}
      <div className="text-center pb-4">
        <a
          href="https://starkgate.starknet.io"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] text-gray-600 hover:text-orange-400 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Get wBTC on Starknet via StarkGate
        </a>
      </div>

      {/* ── Deposit Confirm Modal (Starknet ERC20) ── */}
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

      {/* ── Bridge Deposit Confirm Modal (BTC L1 → Starknet → VM31) ── */}
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

      {/* ── Withdraw Confirm Modal ── */}
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

      {/* ── Transfer Confirm Modal ── */}
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
    </div>
  );
}
