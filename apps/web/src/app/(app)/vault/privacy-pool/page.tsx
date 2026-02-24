"use client";

import { Suspense, useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  Shield,
  Lock,
  Unlock,
  ArrowDownToLine,
  ArrowUpFromLine,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Info,
  ChevronDown,
  Loader2,
  Eye,
  EyeOff,
  Copy,
  Check,
  Users,
  TrendingUp,
  Wallet,
  RefreshCw,
  Key,
  Zap,
  ChevronLeft,
  Droplets,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { TokenIcon } from "@/components/swap/TokenIcon";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAccount } from "@starknet-react/core";

import { ProofProgress } from "@/components/ui/ProofProgress";
import { DataFreshness, LiveBadge } from "@/components/ui/DataFreshness";
import { ConfirmationModal, PrivacyWarningModal, TransactionConfirmModal } from "@/components/ui/ConfirmationModal";
import { AddressBadge } from "@/components/ui/AddressDisplay";
import {
  usePrivacyPoolsIsInitialized,
  usePrivacyPoolsPoolStats,
  usePrivacyPoolsUserDeposits,
  buildPrivacyPoolRagequitCall,
  buildExecuteRagequitCall,
  useBitSageTransaction,
  getContractAddresses,
  type PPRagequitProof,
} from "@/lib/contracts";
import { usePrivacyKeys } from "@/lib/hooks/usePrivacyKeys";
import { usePrivacyPool, type ComplianceLevelId, type WithdrawComplianceOptions, type DepositPhase, type ProofData } from "@/lib/hooks/usePrivacyPool";
import { ProofDetails } from "@/components/privacy/ProofDetails";
import { useCancelRagequit, type InclusionSet } from "@/lib/hooks/useCancelRagequit";
import { useASPRegistry, type ASPInfo } from "@/lib/hooks/useASPRegistry";
import { PRIVACY_DENOMINATIONS, type PrivacyDenomination, type PrivacyNote } from "@/lib/crypto";
import { getUnspentNotes } from "@/lib/crypto/keyStore";
import { useAVNUPaymaster } from "@/lib/paymaster/avnuPaymaster";
import { PrivacySessionCard, PrivacyActivityFeed } from "@/components/privacy";
import {
  PrivacyTransactionReviewModal,
  usePrivacyTransactionReview,
} from "@/components/privacy/PrivacyTransactionReviewModal";
import { EXTERNAL_TOKENS, CONTRACTS, NETWORK_CONFIG, PRIVACY_POOL_FOR_TOKEN } from "@/lib/contracts/addresses";
import { useNetwork } from "@/lib/contexts/NetworkContext";
import { useGaslessPrivacyDeposit } from "@/lib/hooks/useGaslessPrivacyDeposit";

/* ─── Static data ────────────────────────────────────────────────────── */

const POOL_ASSETS = [
  { id: "SAGE", name: "SAGE Token", decimals: 18, status: "live" as const },
  { id: "ETH", name: "Ether", decimals: 18, status: "live" as const },
  { id: "STRK", name: "Starknet Token", decimals: 18, status: "live" as const },
  { id: "wBTC", name: "Wrapped Bitcoin", decimals: 8, status: "live" as const },
  { id: "USDC", name: "USD Coin", decimals: 6, status: "live" as const },
];

const DENOMINATIONS_FOR_ASSET: Record<string, readonly number[]> = {
  SAGE: [0.1, 1, 10, 100, 1000],
  ETH: [0.001, 0.01, 0.1, 0.5, 1],
  STRK: [1, 10, 100, 500, 1000],
  wBTC: [0.0001, 0.001, 0.01, 0.05, 0.1],
  USDC: [1, 10, 100, 500, 1000],
};

const COMPLIANCE_LEVELS = [
  {
    id: "full_privacy",
    name: "Full Privacy",
    description: "Maximum anonymity, no association set requirements",
    icon: Lock,
    color: "text-fuchsia-400",
    bg: "bg-fuchsia-500/15",
    ring: "ring-fuchsia-500/30",
  },
  {
    id: "association_set",
    name: "Association Set",
    description: "Privacy with ASP membership proofs for compliance",
    icon: Users,
    color: "text-violet-400",
    bg: "bg-violet-500/15",
    ring: "ring-violet-500/30",
  },
  {
    id: "auditable",
    name: "Auditable",
    description: "Privacy with optional audit key for regulators",
    icon: Eye,
    color: "text-amber-400",
    bg: "bg-amber-500/15",
    ring: "ring-amber-500/30",
  },
];

type ComplianceLevel = typeof COMPLIANCE_LEVELS[number];
type TabType = "deposit" | "withdraw" | "ragequit";

/* ─── Animation config ───────────────────────────────────────────────── */

const stagger = {
  container: {
    animate: { transition: { staggerChildren: 0.06 } },
  },
  item: {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } },
  },
};

const TABS: { id: TabType; label: string; icon: typeof ArrowDownToLine }[] = [
  { id: "deposit", label: "Deposit", icon: ArrowDownToLine },
  { id: "withdraw", label: "Withdraw", icon: ArrowUpFromLine },
  { id: "ragequit", label: "Ragequit", icon: AlertTriangle },
];

/* ═════════════════════════════════════════════════════════════════════════ */

export default function PrivacyPoolPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-gray-500 animate-spin" /></div>}>
      <PrivacyPoolPageInner />
    </Suspense>
  );
}

function PrivacyPoolPageInner() {
  const searchParams = useSearchParams();
  const { address, isConnected } = useAccount();
  const { network } = useNetwork();
  const explorerUrl = NETWORK_CONFIG[network]?.explorerUrl || "https://sepolia.voyager.online";

  /* ─── Local state ────────────────────────────────────────────────── */
  const [activeTab, setActiveTab] = useState<TabType>("deposit");
  const [selectedAsset, setSelectedAsset] = useState(() => {
    const assetParam = searchParams.get("asset");
    if (assetParam) {
      const found = POOL_ASSETS.find(a => a.id === assetParam);
      if (found) return found;
    }
    return POOL_ASSETS[0];
  });
  const [selectedDenomination, setSelectedDenomination] = useState<number>(10);
  const assetDenominations = useMemo(
    () => DENOMINATIONS_FOR_ASSET[selectedAsset.id] || DENOMINATIONS_FOR_ASSET.SAGE,
    [selectedAsset.id],
  );
  const [complianceLevel, setComplianceLevel] = useState<ComplianceLevel>(COMPLIANCE_LEVELS[0]);
  const [selectedASPs, setSelectedASPs] = useState<string[]>([]);

  const {
    activeASPs,
    aspCount,
    isLoading: isLoadingASPs,
    error: aspError,
    refresh: refreshASPs,
  } = useASPRegistry({ network: "sepolia" });

  const [showNullifier, setShowNullifier] = useState(false);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [ragequitStatus, setRagequitStatus] = useState<"none" | "pending" | "ready">("none");
  const [ragequitCountdown, setRagequitCountdown] = useState(0);
  const [selectedNote, setSelectedNote] = useState<PrivacyNote | null>(null);
  const [spendableNotes, setSpendableNotes] = useState<PrivacyNote[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [amount, setAmount] = useState("");
  const [currentNullifier, setCurrentNullifier] = useState<string | null>(null);
  const [isLoadingNullifier, setIsLoadingNullifier] = useState(false);
  const { sendTransactionAsync } = useBitSageTransaction();

  /* ─── Gas / Paymaster ───────────────────────────────────────────── */
  const { executeGasless, checkEligibility, gasTokens } = useAVNUPaymaster();
  const paymasterAvailable = Object.keys(gasTokens).length > 0;
  const [sponsoredGasAvailable, setSponsoredGasAvailable] = useState(false);

  useEffect(() => {
    if (address) {
      checkEligibility().then(result => {
        setSponsoredGasAvailable(result.eligible);
      });
    }
  }, [address, checkEligibility]);

  type GasPaymentMethod = "wallet" | "gasless-sponsored" | "gasless-strk";
  const [gasPaymentMethod, setGasPaymentMethod] = useState<GasPaymentMethod>("wallet");

  const {
    state: gaslessState,
    deposit: gaslessDeposit,
    reset: resetGaslessState,
  } = useGaslessPrivacyDeposit();

  const txReview = usePrivacyTransactionReview();

  /* ─── Audit key ─────────────────────────────────────────────────── */
  const [auditKey, setAuditKey] = useState<{ x: string; y: string } | null>(null);
  const [isGeneratingAuditKey, setIsGeneratingAuditKey] = useState(false);
  const [showAuditKey, setShowAuditKey] = useState(false);

  /* ─── Modals ────────────────────────────────────────────────────── */
  const [showDepositConfirm, setShowDepositConfirm] = useState(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  const [showRagequitWarning, setShowRagequitWarning] = useState(false);
  const [poolDataLastUpdated, setPoolDataLastUpdated] = useState<number | null>(null);

  /* ─── Proof progress ────────────────────────────────────────────── */
  const [proofPhase, setProofPhase] = useState<"connecting" | "encrypting" | "loading" | "witness" | "commit" | "fri" | "query" | "finalizing" | "done">("connecting");
  const [proofPhaseProgress, setProofPhaseProgress] = useState(0);
  const withdrawProgressRef = useRef(0);

  /* ─── Privacy hooks ─────────────────────────────────────────────── */
  const {
    isInitialized: keysInitialized,
    hasKeys,
    publicKey,
    isLoading: keysLoading,
    initializeKeys,
    getSpendableNotes,
    getPrivateBalance,
  } = usePrivacyKeys();

  const {
    depositState,
    withdrawState,
    poolStats: privacyPoolStats,
    availableDenominations,
    deposit,
    withdraw,
    refreshPoolStats,
    resetDepositState,
  } = usePrivacyPool();

  const {
    isLoading: cancelLoading,
    error: cancelHookError,
    inclusionSets,
    selectedSetId,
    fetchInclusionSets,
    fetchRagequitRequest,
    selectInclusionSet,
    cancelRagequit,
    isSubmitting: cancelSubmitting,
    txHash: cancelTxHash,
  } = useCancelRagequit();

  const [showCancelModal, setShowCancelModal] = useState(false);

  /* ─── Contract reads ────────────────────────────────────────────── */
  const { data: isInitialized } = usePrivacyPoolsIsInitialized();
  const { data: contractPoolStats, isLoading: isLoadingStats } = usePrivacyPoolsPoolStats();
  const { refetch: refetchDeposits } = usePrivacyPoolsUserDeposits(address);

  /* ─── Effects ───────────────────────────────────────────────────── */
  useEffect(() => {
    withdrawProgressRef.current = withdrawState.proofProgress;
    if (withdrawState.isWithdrawing) {
      const p = withdrawState.proofProgress;
      if (p >= 100) setProofPhase("done");
      else if (p >= 80) setProofPhase("finalizing");
      else if (p >= 60) setProofPhase("commit");
      else if (p >= 40) setProofPhase("witness");
      else if (p >= 20) setProofPhase("loading");
      else setProofPhase("connecting");
      setProofPhaseProgress(p);
    }
  }, [withdrawState.proofProgress, withdrawState.isWithdrawing]);

  useEffect(() => {
    const loadNotes = async () => {
      if (hasKeys && address) {
        const notes = await getSpendableNotes();
        setSpendableNotes(notes);
      }
    };
    loadNotes();
  }, [hasKeys, address, getSpendableNotes, depositState.txHash]);

  // Compute per-asset shielded balances from local privacy notes
  const noteBalances = useMemo(() => {
    const balances: Record<string, number> = { SAGE: 0, ETH: 0, STRK: 0, wBTC: 0, USDC: 0 };
    for (const note of spendableNotes) {
      const symbol = note.tokenSymbol || "SAGE";
      if (symbol in balances) {
        balances[symbol] += note.denomination;
      }
    }
    return balances;
  }, [spendableNotes]);

  const poolStats = useMemo(() => {
    if (contractPoolStats) setPoolDataLastUpdated(Date.now());

    const formatDeposit = (val: number, decimals: number) => {
      if (val === 0) return "0.00";
      return val.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: decimals <= 8 ? 8 : 2,
      });
    };

    const yourDeposits = {
      SAGE: formatDeposit(noteBalances.SAGE, 2),
      ETH: formatDeposit(noteBalances.ETH, 4),
      STRK: formatDeposit(noteBalances.STRK, 2),
      wBTC: formatDeposit(noteBalances.wBTC, 8),
      USDC: formatDeposit(noteBalances.USDC, 2),
    };

    if (contractPoolStats && typeof contractPoolStats === "object") {
      const stats = contractPoolStats as {
        total_value_locked?: { low?: bigint };
        deposit_count?: number;
        anonymity_set_size?: number;
      };
      const tvl = Number(stats.total_value_locked?.low || 0n) / 1e18;
      return {
        totalDeposited: {
          SAGE: tvl.toLocaleString(undefined, { minimumFractionDigits: 2 }),
          ETH: "0.00", STRK: "0.00", wBTC: "0.00", USDC: "0.00",
        },
        yourDeposits,
        pendingWithdrawals: "0.00",
        anonymitySet: stats.anonymity_set_size || stats.deposit_count || 0,
        lastDeposit: Date.now() - 3600000,
      };
    }

    return {
      totalDeposited: { SAGE: "0.00", ETH: "0.00", STRK: "0.00", wBTC: "0.00", USDC: "0.00" },
      yourDeposits,
      pendingWithdrawals: "0.00",
      anonymitySet: 0,
      lastDeposit: Date.now(),
    };
  }, [contractPoolStats, noteBalances]);

  /* ─── Handlers ──────────────────────────────────────────────────── */
  const handleCopy = (value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedValue(value);
    setTimeout(() => setCopiedValue(null), 2000);
  };

  const generateAuditKey = async () => {
    setIsGeneratingAuditKey(true);
    try {
      const { generateKeyPair } = await import("@/lib/crypto/elgamal");
      const { publicKey } = generateKeyPair();
      const newAuditKey = {
        x: "0x" + publicKey.x.toString(16),
        y: "0x" + publicKey.y.toString(16),
      };
      setAuditKey(newAuditKey);
      localStorage.setItem("bitsage_audit_key", JSON.stringify(newAuditKey));
    } catch (error) {
      console.error("Failed to generate audit key:", error);
    } finally {
      setIsGeneratingAuditKey(false);
    }
  };

  useEffect(() => {
    const storedKey = localStorage.getItem("bitsage_audit_key");
    if (storedKey) {
      try { setAuditKey(JSON.parse(storedKey)); } catch { /* noop */ }
    }
  }, []);

  const handleDepositClick = () => {
    if (!isConnected || !hasKeys) return;
    txReview.review({
      operationType: "deposit",
      title: "Privacy Pool Deposit",
      description: `Deposit ${selectedDenomination} ${selectedAsset.id} into the ${selectedAsset.name} privacy pool`,
      details: [
        { label: "Amount", value: `${selectedDenomination} ${selectedAsset.id}` },
        { label: "Asset", value: selectedAsset.name },
        { label: "Gas", value: gasPaymentMethod === "gasless-sponsored" ? "Free (Sponsored)" : gasPaymentMethod === "gasless-strk" ? "STRK (Gasless)" : "Wallet (STRK)" },
        { label: "Compliance", value: complianceLevel.name },
      ],
      privacyInfo: {
        identityHidden: false,
        amountHidden: true,
        recipientHidden: false,
        proofType: "Pedersen Commitment + ElGamal Encryption",
        whatIsOnChain: ["Commitment hash", "Encrypted amount ciphertext", "Nullifier hash"],
        whatIsHidden: ["Exact deposit amount", "Blinding factor", "Private note"],
      },
      onConfirm: async () => {
        if (gasPaymentMethod === "wallet") {
          await deposit(selectedDenomination as PrivacyDenomination, selectedAsset.id);
        } else {
          const gasMethod = gasPaymentMethod === "gasless-sponsored" ? "sponsored" : "pay-strk";
          await gaslessDeposit({
            denomination: selectedDenomination as PrivacyDenomination,
            gasMethod: gasMethod as "sponsored" | "pay-strk",
          });
        }
        await refetchDeposits();
        await refreshPoolStats();
        return "";
      },
    });
  };

  const handleDeposit = async () => {
    setShowDepositConfirm(false);
    if (!isConnected || !hasKeys) return;
    try {
      if (gasPaymentMethod === "wallet") {
        await deposit(selectedDenomination as PrivacyDenomination, selectedAsset.id);
      } else {
        const gasMethod = gasPaymentMethod === "gasless-sponsored" ? "sponsored" : "pay-strk";
        await gaslessDeposit({
          denomination: selectedDenomination as PrivacyDenomination,
          gasMethod: gasMethod as "sponsored" | "pay-strk",
        });
      }
      await refetchDeposits();
      await refreshPoolStats();
    } catch (error) {
      console.error("Deposit failed:", error);
    }
  };

  const handleWithdrawClick = () => {
    if (!selectedNote || !isConnected) return;
    txReview.review({
      operationType: "withdraw",
      title: "Privacy Pool Withdrawal",
      description: `Withdraw ${selectedNote.denomination} ${selectedAsset.id} from the privacy pool`,
      details: [
        { label: "Amount", value: `${selectedNote.denomination} ${selectedAsset.id}` },
        { label: "Compliance", value: complianceLevel.name },
        ...(complianceLevel.id === "association_set" ? [{ label: "ASPs", value: `${selectedASPs.length} selected` }] : []),
      ],
      privacyInfo: {
        identityHidden: true,
        amountHidden: false,
        recipientHidden: false,
        proofType: "ZK-STARK Merkle Inclusion + Nullifier",
        whatIsOnChain: ["Nullifier hash", "Withdrawal amount", "Merkle root"],
        whatIsHidden: ["Depositor identity", "Deposit-withdrawal link", "Private note"],
      },
      onConfirm: async () => {
        setProofPhase("connecting");
        setProofPhaseProgress(0);
        const complianceOptions: WithdrawComplianceOptions = {
          complianceLevel: complianceLevel.id as ComplianceLevelId,
          selectedASPs: complianceLevel.id === "association_set" ? selectedASPs : undefined,
          auditKey: complianceLevel.id === "auditable" && auditKey ? auditKey : undefined,
        };
        await withdraw(selectedNote, undefined, complianceOptions);
        setSelectedNote(null);
        await refetchDeposits();
        await refreshPoolStats();
        return "";
      },
    });
  };

  const handleWithdraw = async () => {
    setShowWithdrawConfirm(false);
    if (!selectedNote || !isConnected) return;
    setProofPhase("connecting");
    setProofPhaseProgress(0);
    try {
      const complianceOptions: WithdrawComplianceOptions = {
        complianceLevel: complianceLevel.id as ComplianceLevelId,
        selectedASPs: complianceLevel.id === "association_set" ? selectedASPs : undefined,
        auditKey: complianceLevel.id === "auditable" && auditKey ? auditKey : undefined,
      };
      await withdraw(selectedNote, undefined, complianceOptions);
      setSelectedNote(null);
      await refetchDeposits();
      await refreshPoolStats();
    } catch (error) {
      console.error("Withdraw failed:", error);
      setProofPhase("connecting");
      setProofPhaseProgress(0);
    }
  };

  const handleRagequitClick = () => {
    if (!isConnected) return;
    setShowRagequitWarning(true);
  };

  const handleInitiateRagequit = async () => {
    setShowRagequitWarning(false);
    if (!isConnected || !address) return;
    setIsProcessing(true);
    try {
      const notes = await getUnspentNotes(address);
      if (!notes || notes.length === 0) {
        throw new Error("No unspent deposits found. You must have an active deposit to ragequit.");
      }
      throw new Error(
        "Ragequit requires a Merkle inclusion proof from the proof service, " +
        "which is not yet available. Please try again once the event indexer is deployed."
      );
    } catch (error) {
      console.error("Ragequit initiation failed:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const [cancelError, setCancelError] = useState<string | null>(null);

  const handleCancelRagequitClick = async () => {
    setShowCancelModal(true);
    setCancelError(null);
    await fetchInclusionSets();
  };

  const handleCancelRagequit = async () => {
    if (!isConnected) return;
    setIsProcessing(true);
    setCancelError(null);
    try {
      const result = await cancelRagequit();
      console.log("Cancel ragequit tx:", result.txHash);
      setRagequitStatus("none");
      setRagequitCountdown(0);
      setShowCancelModal(false);
      await refetchDeposits();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Cancel failed";
      setCancelError(errorMessage);
      console.error("Cancel ragequit error:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecuteRagequit = async () => {
    if (!isConnected) return;
    setIsProcessing(true);
    try {
      const addresses = getContractAddresses("sepolia");
      const call = buildExecuteRagequitCall(addresses.SAGE_TOKEN, 0);
      await sendTransactionAsync([call]);
      await refetchDeposits();
      setRagequitStatus("none");
      setRagequitCountdown(0);
    } catch (error) {
      console.error("Ragequit execution failed:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const formatCountdown = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  /* ═══════════════════════════════════════════════════════════════════ */
  /*  RENDER                                                            */
  /* ═══════════════════════════════════════════════════════════════════ */

  return (
    <div className="relative min-h-screen pb-24 lg:pb-6">
      {/* ── Ambient background ─────────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute top-0 left-1/4 w-[500px] h-[300px] bg-fuchsia-500/[0.04] rounded-full blur-[120px]" />
        <div className="absolute bottom-1/3 right-1/4 w-[400px] h-[250px] bg-violet-500/[0.03] rounded-full blur-[100px]" />
      </div>

      <motion.div
        variants={stagger.container}
        initial="initial"
        animate="animate"
        className="relative space-y-6"
      >
        {/* ── Header ────────────────────────────────────────────────── */}
        <motion.div variants={stagger.item} className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="absolute inset-0 bg-fuchsia-500/20 rounded-2xl blur-xl" />
              <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600 flex items-center justify-center">
                <Shield className="w-6 h-6 text-white" />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Privacy Pool</h1>
              <p className="text-sm text-gray-500 mt-0.5">Pedersen commitments with compliance options</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LiveBadge
              isConnected={!!contractPoolStats}
              connectionState={isLoadingStats ? "connecting" : contractPoolStats ? "connected" : "disconnected"}
            />
            <Link
              href="/vault"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] transition-all"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Vault
            </Link>
          </div>
        </motion.div>

        {/* ── Stats bar ─────────────────────────────────────────────── */}
        <motion.div variants={stagger.item} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Pool TVL", value: "$2.58M", icon: Droplets, color: "text-fuchsia-400", glow: "bg-fuchsia-500/10" },
            { label: "Your Deposits", value: `${poolStats.yourDeposits[selectedAsset.id as keyof typeof poolStats.yourDeposits] || "0.00"} ${selectedAsset.id}`, icon: TrendingUp, color: "text-violet-400", glow: "bg-violet-500/10" },
            { label: "Anonymity Set", value: poolStats.anonymitySet.toLocaleString(), icon: Users, color: "text-emerald-400", glow: "bg-emerald-500/10" },
            { label: "Pending", value: poolStats.pendingWithdrawals, icon: Clock, color: "text-amber-400", glow: "bg-amber-500/10" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4"
            >
              <div className="flex items-center gap-2.5 mb-2">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", stat.glow)}>
                  <stat.icon className={cn("w-4 h-4", stat.color)} />
                </div>
                <span className="text-xs text-gray-500 uppercase tracking-wider">{stat.label}</span>
              </div>
              <p className="text-lg font-bold text-white font-mono tracking-tight">{stat.value}</p>
            </div>
          ))}
        </motion.div>

        {/* ── Data freshness ────────────────────────────────────────── */}
        <motion.div variants={stagger.item} className="flex justify-end">
          <DataFreshness
            lastUpdated={poolDataLastUpdated}
            isLoading={isLoadingStats}
            isLive={false}
            onRefresh={refreshPoolStats}
          />
        </motion.div>

        {/* ── Main content grid ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ━━━ Left column: Tabs & Forms ━━━ */}
          <motion.div variants={stagger.item} className="lg:col-span-2 space-y-5">
            {/* Tab bar */}
            <div className="flex gap-1.5 p-1 rounded-xl bg-white/[0.02] border border-white/[0.06] w-fit">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "relative flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-colors",
                    activeTab === tab.id ? "text-white" : "text-gray-500 hover:text-gray-300"
                  )}
                >
                  {activeTab === tab.id && (
                    <motion.div
                      layoutId="ppActiveTab"
                      className={cn(
                        "absolute inset-0 rounded-lg",
                        tab.id === "ragequit"
                          ? "bg-gradient-to-r from-red-600/80 to-orange-600/80"
                          : tab.id === "withdraw"
                          ? "bg-gradient-to-r from-violet-600/80 to-emerald-600/80"
                          : "bg-gradient-to-r from-fuchsia-600/80 to-violet-600/80"
                      )}
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  <tab.icon className="relative z-10 w-4 h-4" />
                  <span className="relative z-10">{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Tab content */}
            <AnimatePresence mode="wait">
              {/* ━━━ DEPOSIT TAB ━━━ */}
              {activeTab === "deposit" && (
                <motion.div
                  key="deposit"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.25 }}
                  className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-6 space-y-6"
                >
                  <div>
                    <h3 className="text-lg font-semibold text-white">Deposit to Privacy Pool</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Shield your assets using Pedersen commitments. Fixed denominations for optimal anonymity.
                    </p>
                  </div>

                  {/* Privacy Key Setup */}
                  {!hasKeys && (
                    <div className="p-4 rounded-xl bg-violet-500/[0.08] border border-violet-500/20">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-lg bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                          <Key className="w-4.5 h-4.5 text-violet-400" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-violet-300">Privacy Keys Required</p>
                          <p className="text-xs text-gray-400 mt-1">
                            Generate your privacy keys to enable deposits. Keys are encrypted with your wallet signature.
                          </p>
                          <button
                            onClick={initializeKeys}
                            disabled={keysLoading}
                            className="mt-3 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
                          >
                            {keysLoading ? (
                              <span className="flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Generating...
                              </span>
                            ) : (
                              "Generate Privacy Keys"
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {hasKeys && publicKey && (
                    <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm text-emerald-300">Privacy keys active</span>
                      <code className="text-xs text-gray-500 ml-auto font-mono">
                        {`0x${publicKey.x.toString(16).slice(0, 8)}...`}
                      </code>
                    </div>
                  )}

                  {/* Asset Selector */}
                  <div className="space-y-3">
                    <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Select Asset</label>
                    <div className="grid grid-cols-5 gap-2">
                      {POOL_ASSETS.map((asset) => {
                        const isLive = asset.status === "live";
                        const poolAddr = PRIVACY_POOL_FOR_TOKEN["sepolia"]?.[asset.id];
                        const hasPool = isLive && poolAddr && poolAddr !== "0x0";
                        return (
                          <button
                            key={asset.id}
                            onClick={() => {
                              if (!hasPool) return;
                              setSelectedAsset(asset);
                              const denoms = DENOMINATIONS_FOR_ASSET[asset.id] || DENOMINATIONS_FOR_ASSET.SAGE;
                              setSelectedDenomination(denoms[2] ?? denoms[0]);
                            }}
                            disabled={!hasPool}
                            className={cn(
                              "relative p-2.5 rounded-xl border text-center transition-all",
                              selectedAsset.id === asset.id
                                ? "bg-fuchsia-500/15 border-fuchsia-500/40 text-white ring-1 ring-fuchsia-500/20"
                                : hasPool
                                ? "bg-white/[0.02] border-white/[0.06] text-gray-300 hover:border-white/[0.15]"
                                : "bg-white/[0.01] border-white/[0.03] text-gray-600 cursor-not-allowed"
                            )}
                          >
                            <TokenIcon symbol={asset.id} size="md" />
                            <p className="text-xs font-medium mt-1">{asset.id}</p>
                            {!isLive && (
                              <span className="absolute -top-1.5 -right-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                Soon
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Denomination Selector */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Amount</label>
                      <span className="text-xs text-gray-600">Fixed for anonymity</span>
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      {assetDenominations.map((denom) => (
                        <button
                          key={denom}
                          onClick={() => setSelectedDenomination(denom)}
                          disabled={!hasKeys}
                          className={cn(
                            "p-3 rounded-xl border text-center transition-all",
                            selectedDenomination === denom
                              ? "bg-fuchsia-500/15 border-fuchsia-500/40 text-white ring-1 ring-fuchsia-500/20"
                              : "bg-white/[0.02] border-white/[0.06] text-gray-300 hover:border-white/[0.15]",
                            !hasKeys && "opacity-40 cursor-not-allowed"
                          )}
                        >
                          <span className="text-base font-bold font-mono">{denom}</span>
                          <p className="text-[10px] text-gray-500 mt-0.5">{selectedAsset.id}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Compliance Level */}
                  <div className="space-y-3">
                    <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Compliance</label>
                    <div className="space-y-2">
                      {COMPLIANCE_LEVELS.map((level) => (
                        <button
                          key={level.id}
                          onClick={() => setComplianceLevel(level)}
                          className={cn(
                            "w-full flex items-start gap-4 p-4 rounded-xl border transition-all text-left",
                            complianceLevel.id === level.id
                              ? `bg-white/[0.04] border-white/[0.12] ring-1 ${level.ring}`
                              : "bg-white/[0.01] border-white/[0.06] hover:border-white/[0.12]"
                          )}
                        >
                          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0", level.bg)}>
                            <level.icon className={cn("w-4.5 h-4.5", level.color)} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-white text-sm">{level.name}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{level.description}</p>
                          </div>
                          {complianceLevel.id === level.id && (
                            <CheckCircle2 className={cn("w-4.5 h-4.5 flex-shrink-0", level.color)} />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ASP Selection */}
                  {complianceLevel.id === "association_set" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                          Association Set Providers
                        </label>
                        {aspCount > 0 && (
                          <span className="text-xs text-gray-500">{aspCount} registered</span>
                        )}
                      </div>

                      {isLoadingASPs ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
                        </div>
                      ) : aspError ? (
                        <div className="p-4 rounded-xl bg-red-500/[0.08] border border-red-500/20">
                          <p className="text-sm text-red-400">Failed to load ASPs: {aspError}</p>
                          <button onClick={refreshASPs} className="text-xs text-red-300 hover:underline mt-2">Retry</button>
                        </div>
                      ) : activeASPs.length === 0 ? (
                        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] text-center">
                          <p className="text-sm text-gray-400">No active ASPs available</p>
                          <p className="text-xs text-gray-600 mt-1">Association Set Providers will appear here once registered</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {activeASPs.map((asp) => (
                            <button
                              key={asp.aspId}
                              onClick={() => {
                                if (selectedASPs.includes(asp.aspId)) {
                                  setSelectedASPs(selectedASPs.filter(id => id !== asp.aspId));
                                } else {
                                  setSelectedASPs([...selectedASPs, asp.aspId]);
                                }
                              }}
                              className={cn(
                                "flex items-center gap-3 p-3 rounded-xl border transition-all",
                                selectedASPs.includes(asp.aspId)
                                  ? "bg-violet-500/[0.08] border-violet-500/30"
                                  : "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]"
                              )}
                            >
                              <div className={cn(
                                "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors",
                                selectedASPs.includes(asp.aspId) ? "bg-violet-500 border-violet-500" : "border-gray-600"
                              )}>
                                {selectedASPs.includes(asp.aspId) && <Check className="w-3 h-3 text-white" />}
                              </div>
                              <div className="flex-1 text-left">
                                <p className="text-sm font-medium text-white">{asp.displayName}</p>
                                <p className="text-xs text-gray-500">
                                  {asp.totalSets} sets &middot; {(Number(asp.stakedAmount) / 1e18).toLocaleString()} SAGE
                                </p>
                              </div>
                              <span className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
                                <div className="w-1 h-1 rounded-full bg-emerald-400" />
                                Active
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      {selectedASPs.length > 0 && (
                        <p className="text-xs text-violet-400">
                          {selectedASPs.length} ASP{selectedASPs.length > 1 ? "s" : ""} selected for compliance proof
                        </p>
                      )}
                    </div>
                  )}

                  {/* Audit Key Section */}
                  {complianceLevel.id === "auditable" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Audit Key</label>
                        <span className="text-xs text-gray-600">Regulatory compliance</span>
                      </div>

                      <div className="p-4 rounded-xl bg-amber-500/[0.06] border border-amber-500/20">
                        <div className="flex items-start gap-3">
                          <Eye className="w-4.5 h-4.5 text-amber-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-sm font-medium text-amber-300">Auditable Transactions</p>
                            <p className="text-xs text-gray-400 mt-1">
                              Generate an audit key allowing authorized regulators to decrypt transaction details. Funds remain private unless the key is shared.
                            </p>
                          </div>
                        </div>
                      </div>

                      {auditKey ? (
                        <div className="space-y-3">
                          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs text-gray-500">Audit Public Key</span>
                              <div className="flex items-center gap-1.5">
                                <button onClick={() => setShowAuditKey(!showAuditKey)} className="p-1 rounded text-gray-500 hover:text-white">
                                  {showAuditKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                                <button onClick={() => handleCopy(JSON.stringify(auditKey))} className="p-1 rounded text-gray-500 hover:text-white">
                                  {copiedValue === JSON.stringify(auditKey) ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>
                            <p className="font-mono text-xs text-white break-all">
                              {showAuditKey ? `X: ${auditKey.x.slice(0, 20)}...${auditKey.x.slice(-8)}` : "••••••••••••••••••••••••"}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Audit key active — share with authorized auditors only
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={generateAuditKey}
                          disabled={isGeneratingAuditKey}
                          className="w-full py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 hover:bg-amber-500/15 transition-colors disabled:opacity-50"
                        >
                          {isGeneratingAuditKey ? (
                            <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Generating...</span>
                          ) : (
                            <span className="flex items-center justify-center gap-2"><Key className="w-4 h-4" /> Generate Audit Key</span>
                          )}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Pedersen commitment info */}
                  {hasKeys && (
                    <div className="p-4 rounded-xl bg-fuchsia-500/[0.06] border border-fuchsia-500/20">
                      <div className="flex items-start gap-3">
                        <Shield className="w-4.5 h-4.5 text-fuchsia-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-fuchsia-300">Pedersen Commitment</p>
                          <p className="text-xs text-gray-400 mt-1">
                            Your deposit will be shielded using a cryptographic commitment. A private note is stored locally for future withdrawal.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Gas Payment Method */}
                  {hasKeys && depositState.phase === "idle" && (
                    <div className="space-y-3">
                      <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Gas Payment</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setGasPaymentMethod("wallet")}
                          className={cn(
                            "p-3 rounded-xl border text-left transition-all",
                            gasPaymentMethod === "wallet"
                              ? "border-violet-500/40 bg-violet-500/[0.08] ring-1 ring-violet-500/20"
                              : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <Wallet className="w-4 h-4 text-violet-400" />
                            <span className="text-sm font-medium text-white">Wallet</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">Pay gas in STRK</p>
                        </button>
                        <button
                          onClick={() => setGasPaymentMethod(sponsoredGasAvailable ? "gasless-sponsored" : "gasless-strk")}
                          disabled={!paymasterAvailable}
                          className={cn(
                            "p-3 rounded-xl border text-left transition-all",
                            gasPaymentMethod.startsWith("gasless")
                              ? "border-emerald-500/40 bg-emerald-500/[0.08] ring-1 ring-emerald-500/20"
                              : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]",
                            !paymasterAvailable && "opacity-40 cursor-not-allowed"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <Zap className="w-4 h-4 text-emerald-400" />
                            <span className="text-sm font-medium text-white">Gasless</span>
                            {sponsoredGasAvailable && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400">FREE</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {paymasterAvailable ? sponsoredGasAvailable ? "AVNU sponsored" : "Pay in any token" : "Not available"}
                          </p>
                        </button>
                      </div>
                      {gasPaymentMethod.startsWith("gasless") && (
                        <p className="text-xs text-emerald-400/70 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Transaction via AVNU Paymaster
                        </p>
                      )}
                    </div>
                  )}

                  {/* Deposit Progress */}
                  {depositState.phase !== "idle" && depositState.phase !== "error" && (
                    <div className="p-6 rounded-xl bg-black/30 border border-white/[0.06]">
                      <div className="flex flex-col items-center mb-6">
                        {depositState.phase === "confirmed" ? (
                          <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center mb-3">
                            <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                          </div>
                        ) : (
                          <div className="w-14 h-14 rounded-full bg-fuchsia-500/20 flex items-center justify-center mb-3">
                            <Loader2 className="w-7 h-7 text-fuchsia-400 animate-spin" />
                          </div>
                        )}
                        <h3 className="text-lg font-semibold text-white">
                          {depositState.phase === "confirmed" ? "Deposit Complete" : "Sending Payment"}
                        </h3>
                      </div>

                      {/* Progress steps */}
                      <div className="space-y-0">
                        {(["proving", "sending", "confirming", "confirmed"] as const).map((step, i) => {
                          const phases: DepositPhase[] = ["proving", "sending", "confirming", "confirmed"];
                          const currentIdx = phases.indexOf(depositState.phase as DepositPhase);
                          const stepIdx = i;
                          const isActive = depositState.phase === step;
                          const isDone = currentIdx > stepIdx;
                          const isFuture = currentIdx < stepIdx;

                          const labels = {
                            proving: { title: "Proving", sub: depositState.provingTimeMs ? `Proved in ${depositState.provingTimeMs}ms` : "Generating commitment..." },
                            sending: { title: "Sending", sub: isDone ? "Submitted to network" : "Submitting to network" },
                            confirming: { title: "Confirming", sub: isDone ? "Confirmed on L2" : "Waiting for L2 confirmation" },
                            confirmed: { title: "Confirmed", sub: "" },
                          };

                          return (
                            <div key={step} className="flex items-start gap-4">
                              <div className="flex flex-col items-center">
                                <div className={cn(
                                  "w-7 h-7 rounded-full flex items-center justify-center",
                                  isActive ? "bg-fuchsia-500/30 ring-2 ring-fuchsia-400/50" : isDone ? "bg-emerald-500/25" : "bg-white/[0.04]"
                                )}>
                                  {isActive ? (
                                    <Loader2 className="w-3.5 h-3.5 text-fuchsia-400 animate-spin" />
                                  ) : isDone ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <div className="w-1.5 h-1.5 bg-gray-600 rounded-full" />
                                  )}
                                </div>
                                {i < 3 && (
                                  <div className={cn("w-px h-10", isDone ? "bg-emerald-500/30" : "bg-white/[0.06]")} />
                                )}
                              </div>
                              <div className="pt-0.5">
                                <p className={cn("text-sm font-medium", isActive ? "text-white" : isDone ? "text-emerald-400" : "text-gray-600")}>{labels[step].title}</p>
                                {labels[step].sub && <p className="text-xs text-gray-500">{labels[step].sub}</p>}
                                {step === "confirmed" && depositState.txHash && isDone && (
                                  <a href={`${explorerUrl}/tx/${depositState.txHash}`} target="_blank" rel="noopener noreferrer" className="text-xs text-fuchsia-400 hover:underline">
                                    View transaction &rarr;
                                  </a>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Proof Details */}
                  {depositState.phase === "confirmed" && depositState.proofData && depositState.txHash && depositState.provingTimeMs && (
                    <ProofDetails
                      commitment={depositState.proofData.commitment}
                      amountCommitment={depositState.proofData.amountCommitment}
                      provingTimeMs={depositState.provingTimeMs}
                      leafIndex={depositState.proofData.leafIndex}
                      txHash={depositState.txHash}
                      amount={depositState.proofData.amount}
                      symbol={selectedAsset.id}
                    />
                  )}

                  {/* Error */}
                  {depositState.phase === "error" && depositState.error && (
                    <div className="p-4 rounded-xl bg-red-500/[0.08] border border-red-500/20">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                        <span className="text-sm text-red-300">{depositState.error}</span>
                      </div>
                    </div>
                  )}

                  {/* Deposit CTA */}
                  <button
                    onClick={depositState.phase === "confirmed" ? resetDepositState : handleDepositClick}
                    disabled={depositState.isDepositing || !hasKeys}
                    className={cn(
                      "relative w-full py-4 rounded-xl font-semibold text-white transition-all overflow-hidden",
                      depositState.isDepositing || !hasKeys
                        ? "bg-gray-700/50 cursor-not-allowed"
                        : depositState.phase === "confirmed"
                        ? "bg-gradient-to-r from-emerald-600 to-violet-600 hover:shadow-lg hover:shadow-emerald-500/20"
                        : "bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:shadow-lg hover:shadow-fuchsia-500/20"
                    )}
                  >
                    {!depositState.isDepositing && depositState.phase !== "confirmed" && hasKeys && (
                      <div className="absolute inset-0 overflow-hidden">
                        <div className="absolute inset-0 -translate-x-full animate-[shimmer_2.5s_infinite] bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" />
                      </div>
                    )}
                    {depositState.isDepositing ? (
                      <span className="relative flex items-center justify-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Processing...</span>
                    ) : depositState.phase === "confirmed" ? (
                      <span className="relative flex items-center justify-center gap-2"><RefreshCw className="w-5 h-5" /> Deposit Another</span>
                    ) : (
                      <span className="relative flex items-center justify-center gap-2"><ArrowDownToLine className="w-5 h-5" /> Deposit {selectedDenomination} {selectedAsset.id}</span>
                    )}
                  </button>
                </motion.div>
              )}

              {/* ━━━ WITHDRAW TAB ━━━ */}
              {activeTab === "withdraw" && (
                <motion.div
                  key="withdraw"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.25 }}
                  className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-6 space-y-6"
                >
                  <div>
                    <h3 className="text-lg font-semibold text-white">Withdraw from Privacy Pool</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Select a note to withdraw. A ZK proof will be generated using Poseidon nullifiers.
                    </p>
                  </div>

                  {/* Spendable Notes */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Your Private Notes</label>
                      <span className="text-xs text-gray-500">{spendableNotes.length} available</span>
                    </div>

                    {spendableNotes.length === 0 ? (
                      <div className="py-8 text-center rounded-xl bg-white/[0.01] border border-white/[0.04]">
                        <Shield className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">No spendable notes found</p>
                        <p className="text-xs text-gray-600 mt-1">Deposit to the privacy pool first</p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {spendableNotes.map((note) => (
                          <button
                            key={note.commitment}
                            onClick={() => setSelectedNote(note)}
                            className={cn(
                              "w-full flex items-center justify-between p-3 rounded-xl border transition-all",
                              selectedNote?.commitment === note.commitment
                                ? "bg-violet-500/[0.08] border-violet-500/30 ring-1 ring-violet-500/20"
                                : "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]"
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <TokenIcon symbol={note.tokenSymbol || "SAGE"} size="sm" />
                              <div className="text-left">
                                <p className="font-medium text-white text-sm">{note.denomination} {note.tokenSymbol || "SAGE"}</p>
                                <p className="text-xs text-gray-500 font-mono">{note.commitment.slice(0, 10)}...{note.commitment.slice(-6)}</p>
                              </div>
                            </div>
                            {selectedNote?.commitment === note.commitment && (
                              <CheckCircle2 className="w-4.5 h-4.5 text-violet-400" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Selected Note Details */}
                  {selectedNote && (
                    <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Amount</span>
                        <span className="text-white font-medium font-mono">{selectedNote.denomination} {selectedNote.tokenSymbol || "SAGE"}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Deposited</span>
                        <span className="text-gray-300">{new Date(selectedNote.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  )}

                  {/* Proof Status */}
                  {withdrawState.isGeneratingProof ? (
                    <ProofProgress
                      phase={proofPhase}
                      progress={proofPhaseProgress}
                      mode="tee"
                      isComplete={proofPhase === "done"}
                      compact={false}
                    />
                  ) : (
                    <div className="p-4 rounded-xl bg-fuchsia-500/[0.06] border border-fuchsia-500/20">
                      <div className="flex items-start gap-3">
                        <Shield className="w-4.5 h-4.5 text-fuchsia-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-fuchsia-300">Zero-Knowledge Proof</p>
                          <p className="text-xs text-gray-400 mt-1">
                            TEE-assisted STWO prover with Poseidon nullifier derivation and Merkle membership proofs.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Withdraw CTA */}
                  <button
                    onClick={handleWithdrawClick}
                    disabled={withdrawState.isWithdrawing || !selectedNote}
                    className={cn(
                      "w-full py-4 rounded-xl font-semibold text-white transition-all",
                      withdrawState.isWithdrawing || !selectedNote
                        ? "bg-gray-700/50 cursor-not-allowed"
                        : "bg-gradient-to-r from-violet-600 to-emerald-600 hover:shadow-lg hover:shadow-violet-500/20"
                    )}
                  >
                    {withdrawState.isWithdrawing ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        {withdrawState.isGeneratingProof ? "Generating ZK Proof..." : "Submitting..."}
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <Unlock className="w-5 h-5" />
                        {selectedNote ? `Withdraw ${selectedNote.denomination} ${selectedNote.tokenSymbol || "SAGE"}` : "Select a Note"}
                      </span>
                    )}
                  </button>

                  {/* Success */}
                  {withdrawState.txHash && (
                    <div className="p-3 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span className="text-sm text-emerald-300">Withdrawal successful!</span>
                        <a href={`${explorerUrl}/tx/${withdrawState.txHash}`} target="_blank" rel="noopener noreferrer" className="text-xs text-fuchsia-400 hover:underline ml-auto">
                          View tx &rarr;
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {withdrawState.error && !withdrawState.isWithdrawing && (
                    <div className="p-4 rounded-xl bg-red-500/[0.08] border border-red-500/20">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-red-300">{withdrawState.error}</span>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* ━━━ RAGEQUIT TAB ━━━ */}
              {activeTab === "ragequit" && (
                <motion.div
                  key="ragequit"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.25 }}
                  className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-6 space-y-6"
                >
                  <div>
                    <h3 className="text-lg font-semibold text-white">Emergency Ragequit</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Withdraw all funds by revealing your deposit. Only use if normal withdrawal fails.
                    </p>
                  </div>

                  {/* Warning */}
                  <div className="p-4 rounded-xl bg-red-500/[0.08] border border-red-500/20">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-red-300">Privacy Warning</p>
                        <p className="text-xs text-gray-400 mt-1">
                          Ragequit reveals your deposit publicly, breaking privacy. 24-hour waiting period to prevent griefing. Last resort only.
                        </p>
                      </div>
                    </div>
                  </div>

                  {ragequitStatus === "none" && (
                    <>
                      {/* Deposits Summary */}
                      <div className="space-y-3">
                        <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">Your Pool Deposits</label>
                        <div className="space-y-1.5">
                          {POOL_ASSETS.map((asset) => (
                            <div key={asset.id} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                              <div className="flex items-center gap-2.5">
                                <TokenIcon symbol={asset.id} size="sm" />
                                <span className="text-sm font-medium text-white">{asset.id}</span>
                              </div>
                              <span className="text-sm text-gray-300 font-mono">
                                {poolStats.yourDeposits[asset.id as keyof typeof poolStats.yourDeposits] || "0.00"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <button
                        onClick={handleRagequitClick}
                        disabled={isProcessing}
                        className={cn(
                          "w-full py-4 rounded-xl font-semibold text-white transition-all",
                          isProcessing ? "bg-gray-700/50 cursor-not-allowed" : "bg-gradient-to-r from-red-600 to-orange-600 hover:shadow-lg hover:shadow-red-500/20"
                        )}
                      >
                        {isProcessing ? (
                          <span className="flex items-center justify-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Initiating...</span>
                        ) : (
                          <span className="flex items-center justify-center gap-2"><AlertTriangle className="w-5 h-5" /> Initiate Ragequit (24h Wait)</span>
                        )}
                      </button>
                    </>
                  )}

                  {ragequitStatus === "pending" && (
                    <div className="space-y-6">
                      <div className="text-center p-6 rounded-xl bg-amber-500/[0.06] border border-amber-500/20">
                        <p className="text-xs text-amber-400 uppercase tracking-wider mb-2">Available In</p>
                        <p className="text-4xl font-mono font-bold text-white tracking-tighter">{formatCountdown(ragequitCountdown)}</p>
                        <p className="text-xs text-gray-500 mt-2">You can cancel anytime before execution</p>
                      </div>

                      {cancelError && (
                        <div className="p-4 rounded-xl bg-amber-500/[0.06] border border-amber-500/20">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="w-4.5 h-4.5 text-amber-400 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm text-amber-300">{cancelError}</p>
                              <button onClick={() => setCancelError(null)} className="text-xs text-amber-400/70 hover:text-amber-400 mt-2">Dismiss</button>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex gap-3">
                        <button
                          onClick={handleCancelRagequitClick}
                          disabled={isProcessing || cancelSubmitting}
                          className="flex-1 py-3 rounded-xl font-semibold text-white bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-colors disabled:opacity-50"
                        >
                          {isProcessing || cancelSubmitting ? (
                            <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Processing...</span>
                          ) : "Cancel Ragequit"}
                        </button>
                        <button disabled className="flex-1 py-3 rounded-xl font-semibold text-gray-500 bg-white/[0.02] border border-white/[0.04] cursor-not-allowed">
                          <span className="flex items-center justify-center gap-2"><Clock className="w-4 h-4" /> Waiting...</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {ragequitStatus === "ready" && (
                    <div className="space-y-6">
                      <div className="text-center p-6 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20">
                        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                        <p className="text-lg font-semibold text-white">Ragequit Ready</p>
                        <p className="text-sm text-gray-400 mt-1">24-hour waiting period complete.</p>
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={handleCancelRagequit}
                          disabled={isProcessing}
                          className="flex-1 py-3 rounded-xl font-semibold text-white bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleExecuteRagequit}
                          disabled={isProcessing}
                          className={cn(
                            "flex-1 py-3 rounded-xl font-semibold text-white transition-all",
                            isProcessing ? "bg-gray-700/50 cursor-not-allowed" : "bg-gradient-to-r from-red-600 to-orange-600 hover:shadow-lg hover:shadow-red-500/20"
                          )}
                        >
                          {isProcessing ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Execute Ragequit"}
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* ━━━ Right column: Sidebar ━━━ */}
          <motion.div variants={stagger.item} className="space-y-5">
            {/* Privacy Session */}
            <PrivacySessionCard />

            {/* Activity Feed */}
            <PrivacyActivityFeed
              title="Recent Pool Activity"
              compact={false}
              maxItems={10}
              options={{
                network: "sepolia",
                contractFilter: [
                  CONTRACTS.sepolia.SAGE_PRIVACY_POOL,
                  CONTRACTS.sepolia.ETH_PRIVACY_POOL,
                  CONTRACTS.sepolia.STRK_PRIVACY_POOL,
                  CONTRACTS.sepolia.WBTC_PRIVACY_POOL,
                  CONTRACTS.sepolia.USDC_PRIVACY_POOL,
                ],
                eventTypes: ["deposit", "withdrawal"],
              }}
            />

            {/* Your Deposits */}
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5">
              <h3 className="text-sm font-semibold text-white mb-4">Your Pool Deposits</h3>
              <div className="space-y-2">
                {POOL_ASSETS.map((asset) => {
                  const balance = poolStats.yourDeposits[asset.id as keyof typeof poolStats.yourDeposits] || "0.00";
                  return (
                    <div key={asset.id} className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02]">
                      <div className="flex items-center gap-2.5">
                        <TokenIcon symbol={asset.id} size="sm" />
                        <span className="text-sm font-medium text-white">{asset.id}</span>
                      </div>
                      <span className="text-sm text-gray-300 font-mono">{balance}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ASP Registry */}
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">ASP Registry</h3>
                <button
                  onClick={refreshASPs}
                  disabled={isLoadingASPs}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/[0.06] transition-colors"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", isLoadingASPs && "animate-spin")} />
                </button>
              </div>
              <div className="space-y-2">
                {isLoadingASPs ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
                  </div>
                ) : activeASPs.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">No active ASPs</p>
                ) : (
                  activeASPs.slice(0, 5).map((asp) => (
                    <div key={asp.aspId} className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02]">
                      <div>
                        <p className="text-sm font-medium text-white">{asp.displayName}</p>
                        <p className="text-xs text-gray-500">{asp.totalSets} sets</p>
                      </div>
                      <span className={cn(
                        "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full",
                        asp.status === "Active" ? "bg-emerald-500/15 text-emerald-400"
                          : asp.status === "Pending" ? "bg-amber-500/15 text-amber-400"
                          : "bg-red-500/15 text-red-400"
                      )}>
                        <div className={cn(
                          "w-1 h-1 rounded-full",
                          asp.status === "Active" ? "bg-emerald-400" : asp.status === "Pending" ? "bg-amber-400" : "bg-red-400"
                        )} />
                        {asp.status}
                      </span>
                    </div>
                  ))
                )}
                {activeASPs.length > 5 && (
                  <p className="text-xs text-gray-500 text-center">+{activeASPs.length - 5} more</p>
                )}
              </div>
            </div>

            {/* Info Card */}
            <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4">
              <div className="flex items-start gap-3">
                <Info className="w-4.5 h-4.5 text-violet-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-400">
                    <strong className="text-white">Privacy Pools</strong> let you deposit assets into a shared pool. Withdraw by proving membership without revealing which deposit is yours.
                  </p>
                  <Link href="/docs/privacy-pools" className="text-fuchsia-400 text-xs hover:underline mt-2 inline-block">
                    Learn more &rarr;
                  </Link>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* ── Modals ──────────────────────────────────────────────────── */}
      <TransactionConfirmModal
        isOpen={showDepositConfirm}
        onClose={() => setShowDepositConfirm(false)}
        onConfirm={handleDeposit}
        title="Confirm Privacy Deposit"
        description="You are about to deposit funds into the privacy pool. This will shield your assets using a Pedersen commitment."
        details={[
          { label: "Amount", value: `${selectedDenomination} ${selectedAsset.id}`, isCurrency: true },
          { label: "Asset", value: selectedAsset.name },
          { label: "Privacy Level", value: complianceLevel.name },
          { label: "Anonymity Set", value: `${poolStats.anonymitySet.toLocaleString()} deposits` },
        ]}
        estimatedGas="~0.001 STRK"
        isLoading={depositState.isDepositing}
        variant="privacy"
      />

      <TransactionConfirmModal
        isOpen={showWithdrawConfirm}
        onClose={() => setShowWithdrawConfirm(false)}
        onConfirm={handleWithdraw}
        title="Confirm Private Withdrawal"
        description="A zero-knowledge proof will verify your note ownership without revealing which deposit is yours."
        details={[
          { label: "Amount", value: selectedNote ? `${selectedNote.denomination} ${selectedNote.tokenSymbol || "SAGE"}` : "0", isCurrency: true },
          { label: "Proof Type", value: "TEE-Assisted STWO" },
          { label: "Nullifier", value: selectedNote?.commitment.slice(0, 16) || "...", isAddress: true },
        ]}
        estimatedGas="~0.002 STRK"
        isLoading={withdrawState.isWithdrawing}
        variant="privacy"
      />

      <PrivacyWarningModal
        isOpen={showRagequitWarning}
        onClose={() => setShowRagequitWarning(false)}
        onConfirm={handleInitiateRagequit}
        operation="ragequit"
        isLoading={isProcessing}
      />

      {/* Cancel Ragequit Modal */}
      <AnimatePresence>
        {showCancelModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => !cancelSubmitting && setShowCancelModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#0e0e14] border border-white/[0.08] rounded-2xl max-w-lg w-full overflow-hidden"
            >
              <div className="p-6 border-b border-white/[0.06]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-violet-500/15 flex items-center justify-center">
                    <Shield className="w-5 h-5 text-violet-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-white">Cancel Ragequit</h2>
                    <p className="text-sm text-gray-500">Select an inclusion set to rejoin</p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div className="p-4 rounded-xl bg-violet-500/[0.06] border border-violet-500/20">
                  <div className="flex items-start gap-3">
                    <Info className="w-4.5 h-4.5 text-violet-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-violet-300">
                      Canceling your ragequit will rejoin your deposit to a privacy inclusion set. This requires a Merkle proof.
                    </p>
                  </div>
                </div>

                {cancelLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
                  </div>
                )}

                {!cancelLoading && inclusionSets.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Available Sets</p>
                    {inclusionSets.map((set) => (
                      <button
                        key={set.id}
                        onClick={() => selectInclusionSet(set.id)}
                        className={cn(
                          "w-full p-4 rounded-xl border text-left transition-all",
                          selectedSetId === set.id
                            ? "border-violet-500/30 bg-violet-500/[0.08] ring-1 ring-violet-500/20"
                            : "border-white/[0.06] hover:border-white/[0.12] bg-white/[0.02]"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-white text-sm">{set.name}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{set.memberCount.toLocaleString()} members</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {set.isUserMember && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">Member</span>
                            )}
                            {selectedSetId === set.id && <CheckCircle2 className="w-4.5 h-4.5 text-violet-400" />}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {!cancelLoading && inclusionSets.length === 0 && (
                  <div className="text-center py-8">
                    <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
                    <p className="text-gray-400 text-sm">No inclusion sets available</p>
                    <p className="text-xs text-gray-600 mt-1">Unable to fetch from contract</p>
                  </div>
                )}

                {(cancelError || cancelHookError) && (
                  <div className="p-4 rounded-xl bg-red-500/[0.08] border border-red-500/20">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-4.5 h-4.5 text-red-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm text-red-300">{cancelError || cancelHookError}</p>
                        <button onClick={() => setCancelError(null)} className="text-xs text-red-400/70 hover:text-red-400 mt-2">Dismiss</button>
                      </div>
                    </div>
                  </div>
                )}

                {cancelTxHash && (
                  <div className="p-4 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm text-emerald-300">Ragequit cancelled successfully!</p>
                        <a href={`${explorerUrl}/tx/${cancelTxHash}`} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-400 hover:underline mt-1 inline-block">
                          View transaction
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-white/[0.06] flex gap-3">
                <button
                  onClick={() => setShowCancelModal(false)}
                  disabled={cancelSubmitting}
                  className="flex-1 py-3 rounded-xl font-semibold text-white bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-colors disabled:opacity-50"
                >
                  Close
                </button>
                <button
                  onClick={handleCancelRagequit}
                  disabled={cancelSubmitting || !selectedSetId || inclusionSets.length === 0}
                  className="flex-1 py-3 rounded-xl font-semibold text-white bg-violet-600 hover:bg-violet-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {cancelSubmitting ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Cancelling...</>
                  ) : (
                    <><Shield className="w-4 h-4" /> Cancel &amp; Rejoin Set</>
                  )}
                </button>
              </div>
            </motion.div>
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
