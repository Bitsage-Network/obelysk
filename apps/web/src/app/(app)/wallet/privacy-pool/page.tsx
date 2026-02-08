"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
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
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useAccount } from "@starknet-react/core";

// Enhanced UI Components
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
import { useAVNUPaymaster } from "@/lib/paymaster/avnuPaymaster";
import { PrivacySessionCard, PrivacyActivityFeed } from "@/components/privacy";
import {
  PrivacyTransactionReviewModal,
  usePrivacyTransactionReview,
} from "@/components/privacy/PrivacyTransactionReviewModal";
import { EXTERNAL_TOKENS, CONTRACTS, NETWORK_CONFIG, PRIVACY_POOL_FOR_TOKEN } from "@/lib/contracts/addresses";
import { useNetwork } from "@/lib/contexts/NetworkContext";
import { useGaslessPrivacyDeposit } from "@/lib/hooks/useGaslessPrivacyDeposit";

// Supported assets for privacy pools
const POOL_ASSETS = [
  { id: "SAGE", name: "SAGE Token", decimals: 18, icon: "🔮", status: "live" as const },
  { id: "ETH", name: "Ether", decimals: 18, icon: "💎", status: "live" as const },
  { id: "STRK", name: "Starknet Token", decimals: 18, icon: "⚡", status: "live" as const },
  { id: "wBTC", name: "Wrapped Bitcoin", decimals: 8, icon: "₿", status: "live" as const },
  { id: "USDC", name: "USD Coin", decimals: 6, icon: "💵", status: "live" as const },
];

// Per-asset denomination presets
const DENOMINATIONS_FOR_ASSET: Record<string, readonly number[]> = {
  SAGE: [0.1, 1, 10, 100, 1000],
  ETH: [0.001, 0.01, 0.1, 0.5, 1],
  STRK: [1, 10, 100, 500, 1000],
  wBTC: [0.0001, 0.001, 0.01, 0.05, 0.1],
  USDC: [1, 10, 100, 500, 1000],
};

// Compliance levels
const COMPLIANCE_LEVELS = [
  {
    id: "full_privacy",
    name: "Full Privacy",
    description: "Maximum anonymity, no association set requirements",
    icon: Lock,
    color: "text-accent-fuchsia",
    bg: "bg-accent-fuchsia/20",
  },
  {
    id: "association_set",
    name: "Association Set",
    description: "Privacy with ASP membership proofs for compliance",
    icon: Users,
    color: "text-brand-400",
    bg: "bg-brand-500/20",
  },
  {
    id: "auditable",
    name: "Auditable",
    description: "Privacy with optional audit key for regulators",
    icon: Eye,
    color: "text-orange-400",
    bg: "bg-orange-500/20",
  },
];

// Compliance level type for proper typing
type ComplianceLevel = typeof COMPLIANCE_LEVELS[number];

type TabType = "deposit" | "withdraw" | "ragequit";

export default function PrivacyPoolPage() {
  const { address, isConnected } = useAccount();
  const { network } = useNetwork();
  const explorerUrl = NETWORK_CONFIG[network]?.explorerUrl || "https://sepolia.starkscan.co";
  const [activeTab, setActiveTab] = useState<TabType>("deposit");
  const [selectedAsset, setSelectedAsset] = useState(POOL_ASSETS[0]);
  const [selectedDenomination, setSelectedDenomination] = useState<number>(10);
  const assetDenominations = useMemo(
    () => DENOMINATIONS_FOR_ASSET[selectedAsset.id] || DENOMINATIONS_FOR_ASSET.SAGE,
    [selectedAsset.id],
  );
  const [complianceLevel, setComplianceLevel] = useState<ComplianceLevel>(COMPLIANCE_LEVELS[0]);
  const [selectedASPs, setSelectedASPs] = useState<string[]>([]);

  // Fetch real ASP data from contract
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

  // AVNU Paymaster for gasless transactions
  const {
    executeGasless,
    checkEligibility,
    gasTokens,
  } = useAVNUPaymaster();

  // Paymaster availability - AVNU is available on Sepolia
  const paymasterAvailable = true;
  const [sponsoredGasAvailable, setSponsoredGasAvailable] = useState(false);

  // Check eligibility on mount
  useEffect(() => {
    if (address) {
      checkEligibility().then(result => {
        setSponsoredGasAvailable(result.eligible);
      });
    }
  }, [address, checkEligibility]);

  // Gas payment method state
  type GasPaymentMethod = "wallet" | "gasless-sponsored" | "gasless-strk";
  const [gasPaymentMethod, setGasPaymentMethod] = useState<GasPaymentMethod>("wallet");

  // Gasless deposit hook
  const {
    state: gaslessState,
    deposit: gaslessDeposit,
    reset: resetGaslessState,
  } = useGaslessPrivacyDeposit();

  const txReview = usePrivacyTransactionReview();

  // Audit key state for auditable compliance
  const [auditKey, setAuditKey] = useState<{ x: string; y: string } | null>(null);
  const [isGeneratingAuditKey, setIsGeneratingAuditKey] = useState(false);
  const [showAuditKey, setShowAuditKey] = useState(false);

  // Modal states
  const [showDepositConfirm, setShowDepositConfirm] = useState(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  const [showRagequitWarning, setShowRagequitWarning] = useState(false);
  const [poolDataLastUpdated, setPoolDataLastUpdated] = useState<number | null>(null);

  // Proof progress state for withdrawal — maps to actual on-chain withdrawal stages
  const [proofPhase, setProofPhase] = useState<"connecting" | "encrypting" | "loading" | "witness" | "commit" | "fri" | "query" | "finalizing" | "done">("connecting");
  const [proofPhaseProgress, setProofPhaseProgress] = useState(0);
  const withdrawProgressRef = useRef(0);

  // Privacy key management
  const {
    isInitialized: keysInitialized,
    hasKeys,
    publicKey,
    isLoading: keysLoading,
    initializeKeys,
    getSpendableNotes,
    getPrivateBalance,
  } = usePrivacyKeys();

  // Privacy pool operations
  const {
    depositState,
    withdrawState,
    poolStats: privacyPoolStats,
    availableDenominations,
    deposit,
    withdraw,
    initiateRagequit,
    executeRagequit,
    refreshPoolStats,
    resetDepositState,
  } = usePrivacyPool();

  // Cancel ragequit hook
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

  // State for cancel ragequit modal
  const [showCancelModal, setShowCancelModal] = useState(false);

  // Use real contract data
  const { data: isInitialized } = usePrivacyPoolsIsInitialized();
  const { data: contractPoolStats, isLoading: isLoadingStats } = usePrivacyPoolsPoolStats();
  const { data: userDeposits, refetch: refetchDeposits } = usePrivacyPoolsUserDeposits(address);

  // Keep withdraw progress ref in sync and map to proof phases
  useEffect(() => {
    withdrawProgressRef.current = withdrawState.proofProgress;
    // Map actual withdrawal stages to UI phases:
    // 0-20: Merkle proof from chain  → "loading"
    // 20-40: Nullifier derivation    → "witness"
    // 40-60: Building calldata       → "commit"
    // 60-80: Submitting tx           → "finalizing"
    // 80-100: Confirmed              → "done"
    if (withdrawState.isWithdrawing) {
      const p = withdrawState.proofProgress;
      if (p >= 100) {
        setProofPhase("done");
      } else if (p >= 80) {
        setProofPhase("finalizing");
      } else if (p >= 60) {
        setProofPhase("commit");
      } else if (p >= 40) {
        setProofPhase("witness");
      } else if (p >= 20) {
        setProofPhase("loading");
      } else {
        setProofPhase("connecting");
      }
      setProofPhaseProgress(p);
    }
  }, [withdrawState.proofProgress, withdrawState.isWithdrawing]);

  // Load spendable notes
  useEffect(() => {
    const loadNotes = async () => {
      if (hasKeys && address) {
        const notes = await getSpendableNotes();
        setSpendableNotes(notes);
      }
    };
    loadNotes();
  }, [hasKeys, address, getSpendableNotes, depositState.txHash]);

  // Transform contract data to display format
  const poolStats = useMemo(() => {
    // Update data freshness timestamp when pool stats change
    if (contractPoolStats) {
      setPoolDataLastUpdated(Date.now());
    }

    // Parse contract pool stats if available
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
          ETH: "0.00",
          STRK: "0.00",
          wBTC: "0.00",
          USDC: "0.00",
        },
        yourDeposits: {
          SAGE: userDeposits ? (Number(userDeposits) / 1e18).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "0.00",
          ETH: "0.00",
          STRK: "0.00",
          wBTC: "0.00",
          USDC: "0.00",
        },
        pendingWithdrawals: "0.00",
        anonymitySet: stats.anonymity_set_size || stats.deposit_count || 0,
        lastDeposit: Date.now() - 3600000,
      };
    }

    // Default empty state
    return {
      totalDeposited: {
        SAGE: "0.00",
        ETH: "0.00",
        STRK: "0.00",
        wBTC: "0.00",
        USDC: "0.00",
      },
      yourDeposits: {
        SAGE: "0.00",
        ETH: "0.00",
        STRK: "0.00",
        wBTC: "0.00",
        USDC: "0.00",
      },
      pendingWithdrawals: "0.00",
      anonymitySet: 0,
      lastDeposit: Date.now(),
    };
  }, [contractPoolStats, userDeposits]);

  const handleCopy = (value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedValue(value);
    setTimeout(() => setCopiedValue(null), 2000);
  };

  // Generate audit key for auditable compliance
  const generateAuditKey = async () => {
    setIsGeneratingAuditKey(true);
    try {
      // Generate a random EC point for the audit key
      // In production, this should use the same elliptic curve as the privacy system
      const randomBytes = crypto.getRandomValues(new Uint8Array(32));
      const keyX = "0x" + Array.from(randomBytes).map(b => b.toString(16).padStart(2, "0")).join("");

      const randomBytesY = crypto.getRandomValues(new Uint8Array(32));
      const keyY = "0x" + Array.from(randomBytesY).map(b => b.toString(16).padStart(2, "0")).join("");

      const newAuditKey = { x: keyX, y: keyY };
      setAuditKey(newAuditKey);

      // Store in localStorage for persistence
      localStorage.setItem("bitsage_audit_key", JSON.stringify(newAuditKey));
    } catch (error) {
      console.error("Failed to generate audit key:", error);
    } finally {
      setIsGeneratingAuditKey(false);
    }
  };

  // Load audit key from localStorage on mount
  useEffect(() => {
    const storedKey = localStorage.getItem("bitsage_audit_key");
    if (storedKey) {
      try {
        setAuditKey(JSON.parse(storedKey));
      } catch {
        // Invalid stored key
      }
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
    if (!isConnected) return;
    setIsProcessing(true);
    try {
      const addresses = getContractAddresses("sepolia");
      // Initiate ragequit with placeholder proof (populated by backend/prover in production)
      const ragequitProof: PPRagequitProof = {
        deposit_commitment: "0",
        global_tree_proof: {
          siblings: [],
          path_indices: [],
          leaf: "0",
          root: "0",
          tree_size: 0,
        },
        exclusion_proofs: [],
        excluded_set_ids: [],
        depositor_signature: ["0", "0"],
        amount: BigInt(0),
        recipient: address || "0x0",
      };
      const call = buildPrivacyPoolRagequitCall(ragequitProof);
      await sendTransactionAsync([call]);
      setRagequitStatus("pending");
      setRagequitCountdown(24 * 60 * 60); // 24 hours in seconds
    } catch (error) {
      console.error("Ragequit initiation failed:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const [cancelError, setCancelError] = useState<string | null>(null);

  // Open cancel modal and fetch inclusion sets
  const handleCancelRagequitClick = async () => {
    setShowCancelModal(true);
    setCancelError(null);
    // Fetch available inclusion sets when modal opens
    await fetchInclusionSets();
  };

  // Execute the cancel ragequit transaction
  const handleCancelRagequit = async () => {
    if (!isConnected) return;
    setIsProcessing(true);
    setCancelError(null);

    try {
      const result = await cancelRagequit();
      console.log("Cancel ragequit tx:", result.txHash);

      // Success - reset state
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-fuchsia to-brand-600 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Privacy Pool</h1>
              <p className="text-gray-400 text-sm mt-0.5">
                Deposit assets into privacy-preserving pools with compliance options
              </p>
            </div>
          </div>
        </div>
        <Link
          href="/wallet"
          className="px-4 py-2 rounded-lg bg-surface-elevated border border-surface-border text-gray-300 hover:text-white transition-colors"
        >
          Back to Wallet
        </Link>
      </div>

      {/* Pool Stats Overview */}
      <div className="flex items-center justify-between mb-2">
        <DataFreshness
          lastUpdated={poolDataLastUpdated}
          isLoading={isLoadingStats}
          isLive={false}
          onRefresh={refreshPoolStats}
        />
        <LiveBadge
          isConnected={!!contractPoolStats}
          connectionState={isLoadingStats ? "connecting" : contractPoolStats ? "connected" : "disconnected"}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-fuchsia/20 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-accent-fuchsia" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Total Pool Value</p>
              <p className="text-lg font-bold text-white">$2.58M</p>
            </div>
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-500/20 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-brand-400" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Your Deposits</p>
              <p className="text-lg font-bold text-white">$17,500.00</p>
            </div>
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Users className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Anonymity Set</p>
              <p className="text-lg font-bold text-white">{poolStats.anonymitySet.toLocaleString()}</p>
            </div>
          </div>
        </div>
        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
              <Clock className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <p className="text-sm text-gray-400">Pending Withdrawals</p>
              <p className="text-lg font-bold text-white">{poolStats.pendingWithdrawals}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Deposit/Withdraw/Ragequit */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tab Selector */}
          <div className="flex gap-2 p-1 bg-surface-card rounded-xl border border-surface-border w-fit">
            <button
              onClick={() => setActiveTab("deposit")}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all",
                activeTab === "deposit"
                  ? "bg-gradient-to-r from-accent-fuchsia to-brand-600 text-white"
                  : "text-gray-400 hover:text-white hover:bg-surface-elevated"
              )}
            >
              <ArrowDownToLine className="w-4 h-4" />
              Deposit
            </button>
            <button
              onClick={() => setActiveTab("withdraw")}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all",
                activeTab === "withdraw"
                  ? "bg-gradient-to-r from-brand-600 to-emerald-600 text-white"
                  : "text-gray-400 hover:text-white hover:bg-surface-elevated"
              )}
            >
              <ArrowUpFromLine className="w-4 h-4" />
              Withdraw
            </button>
            <button
              onClick={() => setActiveTab("ragequit")}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all",
                activeTab === "ragequit"
                  ? "bg-gradient-to-r from-red-600 to-orange-600 text-white"
                  : "text-gray-400 hover:text-white hover:bg-surface-elevated"
              )}
            >
              <AlertTriangle className="w-4 h-4" />
              Ragequit
            </button>
          </div>

          {/* Tab Content */}
          <AnimatePresence mode="wait">
            {activeTab === "deposit" && (
              <motion.div
                key="deposit"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="glass-card p-6 space-y-6"
              >
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">Deposit to Privacy Pool</h3>
                  <p className="text-sm text-gray-400">
                    Shield your assets in a privacy-preserving pool using Pedersen commitments.
                    Fixed denominations ensure optimal anonymity.
                  </p>
                </div>

                {/* Privacy Key Setup */}
                {!hasKeys && (
                  <div className="p-4 rounded-lg bg-brand-500/10 border border-brand-500/30">
                    <div className="flex items-start gap-3">
                      <Key className="w-5 h-5 text-brand-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-brand-300">Privacy Keys Required</p>
                        <p className="text-xs text-gray-400 mt-1">
                          Generate your privacy keys to enable deposits. Keys are encrypted with your wallet signature.
                        </p>
                        <button
                          onClick={initializeKeys}
                          disabled={keysLoading}
                          className="mt-3 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
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
                  <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm text-emerald-300">Privacy keys active</span>
                      <code className="text-xs text-gray-400 ml-auto font-mono">
                        {`0x${publicKey.x.toString(16).slice(0, 8)}...`}
                      </code>
                    </div>
                  </div>
                )}

                {/* Asset Selector */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-gray-300">Select Asset</label>
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
                            // Reset denomination to first available for new asset
                            const denoms = DENOMINATIONS_FOR_ASSET[asset.id] || DENOMINATIONS_FOR_ASSET.SAGE;
                            setSelectedDenomination(denoms[2] ?? denoms[0]);
                          }}
                          disabled={!hasPool}
                          className={cn(
                            "p-2.5 rounded-lg border text-center transition-all relative",
                            selectedAsset.id === asset.id
                              ? "bg-brand-500/20 border-brand-500 text-white"
                              : hasPool
                              ? "bg-surface-elevated border-surface-border text-gray-300 hover:border-gray-500"
                              : "bg-surface-elevated/50 border-surface-border/50 text-gray-500 cursor-not-allowed"
                          )}
                        >
                          <span className="text-lg">{asset.icon}</span>
                          <p className="text-xs font-medium mt-0.5">{asset.id}</p>
                          {!isLive && (
                            <span className="absolute -top-1.5 -right-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">
                              Soon
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Denomination Selector (Fixed amounts for optimal anonymity) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-300">Select Amount</label>
                    <span className="text-xs text-gray-400">Fixed denominations for anonymity</span>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {assetDenominations.map((denom) => (
                      <button
                        key={denom}
                        onClick={() => setSelectedDenomination(denom)}
                        disabled={!hasKeys}
                        className={cn(
                          "p-3 rounded-lg border text-center transition-all",
                          selectedDenomination === denom
                            ? "bg-brand-500/20 border-brand-500 text-white"
                            : "bg-surface-elevated border-surface-border text-gray-300 hover:border-gray-500",
                          !hasKeys && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <span className="text-lg font-bold">{denom}</span>
                        <p className="text-xs text-gray-400">{selectedAsset.id}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Compliance Level */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-gray-300">Compliance Level</label>
                  <div className="grid grid-cols-1 gap-3">
                    {COMPLIANCE_LEVELS.map((level) => (
                      <button
                        key={level.id}
                        onClick={() => setComplianceLevel(level)}
                        className={cn(
                          "flex items-start gap-4 p-4 rounded-lg border transition-all text-left",
                          complianceLevel.id === level.id
                            ? "bg-brand-500/10 border-brand-500"
                            : "bg-surface-elevated border-surface-border hover:border-gray-600"
                        )}
                      >
                        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", level.bg)}>
                          <level.icon className={cn("w-5 h-5", level.color)} />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-white">{level.name}</p>
                          <p className="text-sm text-gray-400 mt-0.5">{level.description}</p>
                        </div>
                        {complianceLevel.id === level.id && (
                          <CheckCircle2 className="w-5 h-5 text-brand-400" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ASP Selection (if Association Set compliance) */}
                {complianceLevel.id === "association_set" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-300">
                        Association Set Providers (Select at least one)
                      </label>
                      {aspCount > 0 && (
                        <span className="text-xs text-gray-400">{aspCount} registered</span>
                      )}
                    </div>

                    {isLoadingASPs ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
                      </div>
                    ) : aspError ? (
                      <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                        <p className="text-sm text-red-400">Failed to load ASPs: {aspError}</p>
                        <button
                          onClick={refreshASPs}
                          className="text-xs text-red-300 hover:underline mt-2"
                        >
                          Retry
                        </button>
                      </div>
                    ) : activeASPs.length === 0 ? (
                      <div className="p-4 rounded-lg bg-surface-elevated border border-surface-border text-center">
                        <p className="text-sm text-gray-400">No active ASPs available</p>
                        <p className="text-xs text-gray-500 mt-1">
                          Association Set Providers will appear here once registered
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                              "flex items-center gap-3 p-3 rounded-lg border transition-all",
                              selectedASPs.includes(asp.aspId)
                                ? "bg-brand-500/10 border-brand-500"
                                : "bg-surface-elevated border-surface-border hover:border-gray-600"
                            )}
                          >
                            <div className={cn(
                              "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors",
                              selectedASPs.includes(asp.aspId)
                                ? "bg-brand-500 border-brand-500"
                                : "border-gray-500"
                            )}>
                              {selectedASPs.includes(asp.aspId) && (
                                <Check className="w-3 h-3 text-white" />
                              )}
                            </div>
                            <div className="flex-1 text-left">
                              <p className="text-sm font-medium text-white">{asp.displayName}</p>
                              <p className="text-xs text-gray-400">
                                {asp.totalSets} sets • {(Number(asp.stakedAmount) / 1e18).toLocaleString()} SAGE staked
                              </p>
                            </div>
                            <span className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              Active
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {selectedASPs.length > 0 && (
                      <div className="p-3 rounded-lg bg-brand-500/10 border border-brand-500/30">
                        <p className="text-sm text-brand-300">
                          {selectedASPs.length} ASP{selectedASPs.length > 1 ? "s" : ""} selected for compliance proof
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Audit Key Section (if Auditable compliance) */}
                {complianceLevel.id === "auditable" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-300">
                        Audit Key
                      </label>
                      <span className="text-xs text-gray-400">For regulatory compliance</span>
                    </div>

                    <div className="p-4 rounded-lg bg-orange-500/10 border border-orange-500/30">
                      <div className="flex items-start gap-3">
                        <Eye className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-orange-300">Auditable Transactions</p>
                          <p className="text-xs text-gray-400 mt-1">
                            Generate an audit key that allows authorized regulators to decrypt your transaction details.
                            Your funds remain private unless the key is shared.
                          </p>
                        </div>
                      </div>
                    </div>

                    {auditKey ? (
                      <div className="space-y-3">
                        <div className="p-3 rounded-lg bg-surface-elevated border border-surface-border">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-gray-400">Audit Public Key</span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setShowAuditKey(!showAuditKey)}
                                className="p-1 rounded text-gray-400 hover:text-white"
                              >
                                {showAuditKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                              <button
                                onClick={() => handleCopy(JSON.stringify(auditKey))}
                                className="p-1 rounded text-gray-400 hover:text-white"
                              >
                                {copiedValue === JSON.stringify(auditKey) ? (
                                  <Check className="w-4 h-4 text-emerald-400" />
                                ) : (
                                  <Copy className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </div>
                          <p className="font-mono text-xs text-white break-all">
                            {showAuditKey
                              ? `X: ${auditKey.x.slice(0, 20)}...${auditKey.x.slice(-8)}`
                              : "••••••••••••••••••••••••"}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-emerald-400">
                          <CheckCircle2 className="w-4 h-4" />
                          Audit key active - share with authorized auditors only
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={generateAuditKey}
                        disabled={isGeneratingAuditKey}
                        className="w-full py-3 rounded-lg bg-orange-500/20 border border-orange-500/30 text-orange-300 hover:bg-orange-500/30 transition-colors disabled:opacity-50"
                      >
                        {isGeneratingAuditKey ? (
                          <span className="flex items-center justify-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Generating...
                          </span>
                        ) : (
                          <span className="flex items-center justify-center gap-2">
                            <Key className="w-4 h-4" />
                            Generate Audit Key
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                )}

                {/* Deposit Info */}
                {hasKeys && (
                  <div className="p-4 rounded-lg bg-accent-fuchsia/10 border border-accent-fuchsia/30">
                    <div className="flex items-start gap-3">
                      <Shield className="w-5 h-5 text-accent-fuchsia flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-accent-fuchsia-light">Pedersen Commitment</p>
                        <p className="text-xs text-gray-400 mt-1">
                          Your deposit will be shielded using a cryptographic commitment.
                          A private note will be stored locally for future withdrawal.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Gas Payment Method Selector */}
                {hasKeys && depositState.phase === "idle" && (
                  <div className="space-y-3">
                    <label className="text-sm font-medium text-gray-300">Gas Payment</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setGasPaymentMethod("wallet")}
                        className={cn(
                          "p-3 rounded-lg border text-left transition-all",
                          gasPaymentMethod === "wallet"
                            ? "border-violet-500 bg-violet-500/10"
                            : "border-white/10 bg-white/5 hover:bg-white/10"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Wallet className="w-4 h-4 text-violet-400" />
                          <span className="text-sm font-medium text-white">Wallet</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">Pay gas in STRK</p>
                      </button>

                      <button
                        onClick={() => setGasPaymentMethod(sponsoredGasAvailable ? "gasless-sponsored" : "gasless-strk")}
                        disabled={!paymasterAvailable}
                        className={cn(
                          "p-3 rounded-lg border text-left transition-all",
                          gasPaymentMethod.startsWith("gasless")
                            ? "border-emerald-500 bg-emerald-500/10"
                            : "border-white/10 bg-white/5 hover:bg-white/10",
                          !paymasterAvailable && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Zap className="w-4 h-4 text-emerald-400" />
                          <span className="text-sm font-medium text-white">Gasless</span>
                          {sponsoredGasAvailable && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400">FREE</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          {paymasterAvailable
                            ? sponsoredGasAvailable
                              ? "AVNU sponsored"
                              : "Pay in any token"
                            : "Not available"}
                        </p>
                      </button>
                    </div>
                    {gasPaymentMethod.startsWith("gasless") && (
                      <p className="text-xs text-emerald-400/80 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Transaction will be submitted via AVNU Paymaster
                      </p>
                    )}
                  </div>
                )}

                {/* Deposit Progress Flow (Tongo-style) */}
                {depositState.phase !== "idle" && depositState.phase !== "error" && (
                  <div className="p-6 rounded-xl bg-gray-900/80 border border-gray-700/50">
                    <div className="flex flex-col items-center mb-6">
                      {depositState.phase === "confirmed" ? (
                        <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-3">
                          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                        </div>
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-brand-500/20 flex items-center justify-center mb-3">
                          <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
                        </div>
                      )}
                      <h3 className="text-lg font-semibold text-white">
                        {depositState.phase === "confirmed" ? "Deposit Complete" : "Sending Payment"}
                      </h3>
                    </div>

                    {/* Progress Steps */}
                    <div className="space-y-0">
                      {/* Proving */}
                      <div className="flex items-start gap-4">
                        <div className="flex flex-col items-center">
                          <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center",
                            depositState.phase === "proving"
                              ? "bg-brand-500/30 border-2 border-brand-400"
                              : "bg-emerald-500/30"
                          )}>
                            {depositState.phase === "proving" ? (
                              <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
                            ) : (
                              <Check className="w-4 h-4 text-emerald-400" />
                            )}
                          </div>
                          <div className={cn(
                            "w-0.5 h-12",
                            depositState.phase === "proving" ? "bg-gray-600" : "bg-emerald-500/50"
                          )} />
                        </div>
                        <div className="pt-1">
                          <p className={cn(
                            "font-medium",
                            depositState.phase === "proving" ? "text-white" : "text-emerald-400"
                          )}>Proving</p>
                          <p className="text-sm text-gray-400">
                            {depositState.provingTimeMs !== null
                              ? `Proved in ${depositState.provingTimeMs}ms`
                              : "Generating commitment..."}
                          </p>
                        </div>
                      </div>

                      {/* Sending */}
                      <div className="flex items-start gap-4">
                        <div className="flex flex-col items-center">
                          <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center",
                            depositState.phase === "sending"
                              ? "bg-brand-500/30 border-2 border-brand-400"
                              : depositState.phase === "proving"
                              ? "bg-gray-700"
                              : "bg-emerald-500/30"
                          )}>
                            {depositState.phase === "sending" ? (
                              <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
                            ) : depositState.phase === "proving" ? (
                              <div className="w-2 h-2 bg-gray-500 rounded-full" />
                            ) : (
                              <Check className="w-4 h-4 text-emerald-400" />
                            )}
                          </div>
                          <div className={cn(
                            "w-0.5 h-12",
                            ["confirming", "confirmed"].includes(depositState.phase) ? "bg-emerald-500/50" : "bg-gray-600"
                          )} />
                        </div>
                        <div className="pt-1">
                          <p className={cn(
                            "font-medium",
                            depositState.phase === "sending" ? "text-white"
                              : ["confirming", "confirmed"].includes(depositState.phase) ? "text-emerald-400"
                              : "text-gray-500"
                          )}>Sending</p>
                          <p className="text-sm text-gray-400">
                            {depositState.phase === "sending" ? "Submitting to network" : "Submitted to network"}
                          </p>
                        </div>
                      </div>

                      {/* Confirming */}
                      <div className="flex items-start gap-4">
                        <div className="flex flex-col items-center">
                          <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center",
                            depositState.phase === "confirming"
                              ? "bg-brand-500/30 border-2 border-brand-400"
                              : depositState.phase === "confirmed"
                              ? "bg-emerald-500/30"
                              : "bg-gray-700"
                          )}>
                            {depositState.phase === "confirming" ? (
                              <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
                            ) : depositState.phase === "confirmed" ? (
                              <Check className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <div className="w-2 h-2 bg-gray-500 rounded-full" />
                            )}
                          </div>
                          <div className={cn(
                            "w-0.5 h-12",
                            depositState.phase === "confirmed" ? "bg-emerald-500/50" : "bg-gray-600"
                          )} />
                        </div>
                        <div className="pt-1">
                          <p className={cn(
                            "font-medium",
                            depositState.phase === "confirming" ? "text-white"
                              : depositState.phase === "confirmed" ? "text-emerald-400"
                              : "text-gray-500"
                          )}>Confirming</p>
                          <p className="text-sm text-gray-400">
                            {depositState.phase === "confirming" ? "Waiting for L2 confirmation" : "Confirmed on L2"}
                          </p>
                        </div>
                      </div>

                      {/* Confirmed */}
                      <div className="flex items-start gap-4">
                        <div className="flex flex-col items-center">
                          <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center",
                            depositState.phase === "confirmed"
                              ? "bg-emerald-500/30"
                              : "bg-gray-700"
                          )}>
                            {depositState.phase === "confirmed" ? (
                              <Check className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <div className="w-2 h-2 bg-gray-500 rounded-full" />
                            )}
                          </div>
                        </div>
                        <div className="pt-1">
                          <p className={cn(
                            "font-medium",
                            depositState.phase === "confirmed" ? "text-emerald-400" : "text-gray-500"
                          )}>Confirmed</p>
                          {depositState.txHash && depositState.phase === "confirmed" && (
                            <a
                              href={`${explorerUrl}/tx/${depositState.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-brand-400 hover:underline"
                            >
                              View transaction →
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ZK Proof Details - Show when deposit is confirmed */}
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

                {/* Error Message */}
                {depositState.phase === "error" && depositState.error && (
                  <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      <span className="text-sm text-red-300">{depositState.error}</span>
                    </div>
                  </div>
                )}

                {/* Deposit Button */}
                <button
                  onClick={depositState.phase === "confirmed" ? resetDepositState : handleDepositClick}
                  disabled={depositState.isDepositing || !hasKeys}
                  className={cn(
                    "w-full py-4 rounded-xl font-semibold text-white transition-all",
                    depositState.isDepositing || !hasKeys
                      ? "bg-gray-600 cursor-not-allowed"
                      : depositState.phase === "confirmed"
                      ? "bg-gradient-to-r from-emerald-600 to-brand-600 hover:shadow-lg hover:shadow-emerald-500/25"
                      : "bg-gradient-to-r from-accent-fuchsia to-brand-600 hover:shadow-lg hover:shadow-brand-500/25"
                  )}
                >
                  {depositState.isDepositing ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Processing...
                    </span>
                  ) : depositState.phase === "confirmed" ? (
                    <span className="flex items-center justify-center gap-2">
                      <RefreshCw className="w-5 h-5" />
                      Deposit Another
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <ArrowDownToLine className="w-5 h-5" />
                      Deposit {selectedDenomination} {selectedAsset.id}
                    </span>
                  )}
                </button>
              </motion.div>
            )}

            {activeTab === "withdraw" && (
              <motion.div
                key="withdraw"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="glass-card p-6 space-y-6"
              >
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">Withdraw from Privacy Pool</h3>
                  <p className="text-sm text-gray-400">
                    Select a note to withdraw. A zero-knowledge proof will be generated using Poseidon nullifiers.
                  </p>
                </div>

                {/* Spendable Notes */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-300">Your Private Notes</label>
                    <span className="text-xs text-gray-400">{spendableNotes.length} available</span>
                  </div>

                  {spendableNotes.length === 0 ? (
                    <div className="p-4 rounded-lg bg-surface-elevated border border-surface-border text-center">
                      <p className="text-sm text-gray-400">No spendable notes found</p>
                      <p className="text-xs text-gray-500 mt-1">Deposit to the privacy pool first</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {spendableNotes.map((note) => (
                        <button
                          key={note.commitment}
                          onClick={() => setSelectedNote(note)}
                          className={cn(
                            "w-full flex items-center justify-between p-3 rounded-lg border transition-all",
                            selectedNote?.commitment === note.commitment
                              ? "bg-brand-500/20 border-brand-500"
                              : "bg-surface-elevated border-surface-border hover:border-gray-500"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xl">
                              {POOL_ASSETS.find(a => a.id === (note.tokenSymbol || "SAGE"))?.icon || "🔮"}
                            </span>
                            <div className="text-left">
                              <p className="font-medium text-white">
                                {note.denomination} {note.tokenSymbol || "SAGE"}
                              </p>
                              <p className="text-xs text-gray-400 font-mono">
                                {note.commitment.slice(0, 10)}...{note.commitment.slice(-6)}
                              </p>
                            </div>
                          </div>
                          {selectedNote?.commitment === note.commitment && (
                            <CheckCircle2 className="w-5 h-5 text-brand-400" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Selected Note Details */}
                {selectedNote && (
                  <div className="p-4 rounded-lg bg-surface-elevated border border-surface-border space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Amount:</span>
                      <span className="text-white font-medium">
                        {selectedNote.denomination} {selectedNote.tokenSymbol || "SAGE"}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Deposited:</span>
                      <span className="text-gray-300">{new Date(selectedNote.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                )}

                {/* Proof Status - Enhanced with ProofProgress component */}
                {withdrawState.isGeneratingProof ? (
                  <ProofProgress
                    phase={proofPhase}
                    progress={proofPhaseProgress}
                    mode="tee"
                    isComplete={proofPhase === "done"}
                    compact={false}
                  />
                ) : (
                  <div className="p-4 rounded-lg bg-accent-fuchsia/10 border border-accent-fuchsia/30">
                    <div className="flex items-start gap-3">
                      <Shield className="w-5 h-5 text-accent-fuchsia flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-accent-fuchsia-light">Zero-Knowledge Proof</p>
                        <p className="text-xs text-gray-400 mt-1">
                          Proof generation uses TEE-assisted STWO prover with Poseidon nullifier derivation
                          and Merkle membership proofs.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Withdraw Button */}
                <button
                  onClick={handleWithdrawClick}
                  disabled={withdrawState.isWithdrawing || !selectedNote}
                  className={cn(
                    "w-full py-4 rounded-xl font-semibold text-white transition-all",
                    withdrawState.isWithdrawing || !selectedNote
                      ? "bg-gray-600 cursor-not-allowed"
                      : "bg-gradient-to-r from-brand-600 to-emerald-600 hover:shadow-lg hover:shadow-brand-500/25"
                  )}
                >
                  {withdrawState.isWithdrawing ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {withdrawState.isGeneratingProof ? "Generating ZK Proof..." : "Submitting Transaction..."}
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <Unlock className="w-5 h-5" />
                      {selectedNote ? `Withdraw ${selectedNote.denomination} ${selectedNote.tokenSymbol || "SAGE"}` : "Select a Note"}
                    </span>
                  )}
                </button>

                {/* Success Message */}
                {withdrawState.txHash && (
                  <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm text-emerald-300">Withdrawal successful!</span>
                      <a
                        href={`${explorerUrl}/tx/${withdrawState.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brand-400 hover:underline ml-auto"
                      >
                        View tx →
                      </a>
                    </div>
                  </div>
                )}

                {/* Error Message */}
                {withdrawState.error && !withdrawState.isWithdrawing && (
                  <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-red-300">{withdrawState.error}</span>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === "ragequit" && (
              <motion.div
                key="ragequit"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="glass-card p-6 space-y-6"
              >
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">Emergency Ragequit</h3>
                  <p className="text-sm text-gray-400">
                    Withdraw all funds by revealing your deposit. Use only if normal withdrawal fails or if you lose access to generate proofs.
                  </p>
                </div>

                {/* Warning Banner */}
                <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-red-300">Privacy Warning</p>
                      <p className="text-xs text-gray-400 mt-1">
                        Ragequit will reveal your deposit publicly, breaking privacy. This action has a 24-hour waiting period
                        to prevent griefing attacks. Only use this as a last resort.
                      </p>
                    </div>
                  </div>
                </div>

                {ragequitStatus === "none" && (
                  <>
                    {/* Your Deposits Summary */}
                    <div className="space-y-3">
                      <label className="text-sm font-medium text-gray-300">Your Pool Deposits</label>
                      <div className="space-y-2">
                        {POOL_ASSETS.map((asset) => (
                          <div key={asset.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated border border-surface-border">
                            <div className="flex items-center gap-3">
                              <span className="text-xl">{asset.icon}</span>
                              <span className="font-medium text-white">{asset.id}</span>
                            </div>
                            <span className="text-gray-300">
                              {poolStats.yourDeposits[asset.id as keyof typeof poolStats.yourDeposits] || "0.00"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Initiate Ragequit Button */}
                    <button
                      onClick={handleRagequitClick}
                      disabled={isProcessing}
                      className={cn(
                        "w-full py-4 rounded-xl font-semibold text-white transition-all",
                        isProcessing
                          ? "bg-gray-600 cursor-not-allowed"
                          : "bg-gradient-to-r from-red-600 to-orange-600 hover:shadow-lg hover:shadow-red-500/25"
                      )}
                    >
                      {isProcessing ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Initiating Ragequit...
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-2">
                          <AlertTriangle className="w-5 h-5" />
                          Initiate Ragequit (24h Wait)
                        </span>
                      )}
                    </button>
                  </>
                )}

                {ragequitStatus === "pending" && (
                  <div className="space-y-6">
                    {/* Countdown Timer */}
                    <div className="text-center p-6 rounded-xl bg-orange-500/10 border border-orange-500/30">
                      <p className="text-sm text-orange-400 mb-2">Ragequit Available In</p>
                      <p className="text-4xl font-mono font-bold text-white">
                        {formatCountdown(ragequitCountdown)}
                      </p>
                      <p className="text-xs text-gray-400 mt-2">
                        You can cancel anytime before execution
                      </p>
                    </div>

                    {/* Cancel Error Message */}
                    {cancelError && (
                      <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 mb-4">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-sm text-yellow-300">{cancelError}</p>
                            <button
                              onClick={() => setCancelError(null)}
                              className="text-xs text-yellow-400/70 hover:text-yellow-400 mt-2"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-4">
                      <button
                        onClick={handleCancelRagequitClick}
                        disabled={isProcessing || cancelSubmitting}
                        className="flex-1 py-3 rounded-xl font-semibold text-white bg-surface-elevated border border-surface-border hover:bg-surface-card transition-colors disabled:opacity-50"
                        title="Cancel ragequit and rejoin an inclusion set"
                      >
                        {isProcessing || cancelSubmitting ? (
                          <span className="flex items-center justify-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Processing...
                          </span>
                        ) : (
                          "Cancel Ragequit"
                        )}
                      </button>
                      <button
                        disabled
                        className="flex-1 py-3 rounded-xl font-semibold text-gray-400 bg-gray-700 cursor-not-allowed"
                      >
                        <span className="flex items-center justify-center gap-2">
                          <Clock className="w-4 h-4" />
                          Waiting...
                        </span>
                      </button>
                    </div>
                  </div>
                )}

                {ragequitStatus === "ready" && (
                  <div className="space-y-6">
                    {/* Ready to Execute */}
                    <div className="text-center p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                      <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                      <p className="text-lg font-semibold text-white">Ragequit Ready</p>
                      <p className="text-sm text-gray-400 mt-1">
                        24-hour waiting period complete. You can now execute the ragequit.
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-4">
                      <button
                        onClick={handleCancelRagequit}
                        disabled={isProcessing}
                        className="flex-1 py-3 rounded-xl font-semibold text-white bg-surface-elevated border border-surface-border hover:bg-surface-card transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleExecuteRagequit}
                        disabled={isProcessing}
                        className={cn(
                          "flex-1 py-3 rounded-xl font-semibold text-white transition-all",
                          isProcessing
                            ? "bg-gray-600 cursor-not-allowed"
                            : "bg-gradient-to-r from-red-600 to-orange-600 hover:shadow-lg hover:shadow-red-500/25"
                        )}
                      >
                        {isProcessing ? (
                          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                        ) : (
                          "Execute Ragequit"
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Column - Pool Stats & ASP Status */}
        <div className="space-y-6">
          {/* Privacy Session Card */}
          <PrivacySessionCard />

          {/* Recent Privacy Activity */}
          <PrivacyActivityFeed
            title="Recent Pool Activity"
            compact={false}
            maxItems={10}
            options={{
              network: "sepolia",
              contractFilter: [CONTRACTS.sepolia.PRIVACY_POOLS],
              eventTypes: ["deposit", "withdrawal"],
            }}
          />

          {/* Your Deposits */}
          <div className="glass-card p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Your Pool Deposits</h3>
            <div className="space-y-3">
              {POOL_ASSETS.map((asset) => {
                const balance = poolStats.yourDeposits[asset.id as keyof typeof poolStats.yourDeposits] || "0.00";
                return (
                  <div key={asset.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{asset.icon}</span>
                      <span className="font-medium text-white">{asset.id}</span>
                    </div>
                    <span className="text-gray-300">{balance}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ASP Memberships */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">ASP Registry</h3>
              <button
                onClick={refreshASPs}
                disabled={isLoadingASPs}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-surface-elevated transition-colors"
                title="Refresh ASPs"
              >
                <RefreshCw className={cn("w-4 h-4", isLoadingASPs && "animate-spin")} />
              </button>
            </div>
            <div className="space-y-3">
              {isLoadingASPs ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
                </div>
              ) : activeASPs.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-sm text-gray-400">No active ASPs</p>
                </div>
              ) : (
                activeASPs.slice(0, 5).map((asp) => (
                  <div key={asp.aspId} className="flex items-center justify-between p-3 rounded-lg bg-surface-elevated">
                    <div>
                      <p className="text-sm font-medium text-white">{asp.displayName}</p>
                      <p className="text-xs text-gray-400">{asp.totalSets} association sets</p>
                    </div>
                    <span className={cn(
                      "flex items-center gap-1.5 text-xs px-2 py-1 rounded-full",
                      asp.status === "Active"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : asp.status === "Pending"
                        ? "bg-yellow-500/20 text-yellow-400"
                        : "bg-red-500/20 text-red-400"
                    )}>
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        asp.status === "Active"
                          ? "bg-emerald-400"
                          : asp.status === "Pending"
                          ? "bg-yellow-400"
                          : "bg-red-400"
                      )} />
                      {asp.status}
                    </span>
                  </div>
                ))
              )}
              {activeASPs.length > 5 && (
                <p className="text-xs text-gray-400 text-center mt-2">
                  +{activeASPs.length - 5} more ASPs
                </p>
              )}
            </div>
          </div>

          {/* Info Card */}
          <div className="glass-card p-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-brand-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-gray-300">
                  <strong className="text-white">Privacy Pools</strong> allow you to deposit assets into a shared pool.
                  When withdrawing, you prove membership without revealing which specific deposit is yours.
                </p>
                <Link href="/docs/privacy-pools" className="text-brand-400 text-sm hover:underline mt-2 inline-block">
                  Learn more →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modals */}
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
        description="A zero-knowledge proof will be generated to verify your note ownership without revealing which deposit is yours."
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
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => !cancelSubmitting && setShowCancelModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface-card border border-surface-border rounded-2xl max-w-lg w-full overflow-hidden"
            >
              {/* Header */}
              <div className="p-6 border-b border-surface-border">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-500/20 flex items-center justify-center">
                    <Shield className="w-5 h-5 text-brand-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-white">Cancel Ragequit</h2>
                    <p className="text-sm text-gray-400">Select an inclusion set to rejoin</p>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 space-y-4">
                {/* Info */}
                <div className="p-4 rounded-lg bg-brand-500/10 border border-brand-500/30">
                  <div className="flex items-start gap-3">
                    <Info className="w-5 h-5 text-brand-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-brand-300">
                      Canceling your ragequit will rejoin your deposit to a privacy inclusion set.
                      This requires a Merkle proof of membership.
                    </p>
                  </div>
                </div>

                {/* Loading state */}
                {cancelLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
                  </div>
                )}

                {/* Inclusion sets list */}
                {!cancelLoading && inclusionSets.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-300">Available Inclusion Sets</p>
                    {inclusionSets.map((set) => (
                      <button
                        key={set.id}
                        onClick={() => selectInclusionSet(set.id)}
                        className={cn(
                          "w-full p-4 rounded-xl border text-left transition-all",
                          selectedSetId === set.id
                            ? "border-brand-500 bg-brand-500/10"
                            : "border-surface-border hover:border-gray-600 bg-surface-elevated"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-white">{set.name}</p>
                            <p className="text-xs text-gray-400 mt-1">
                              {set.memberCount.toLocaleString()} members
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {set.isUserMember && (
                              <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400">
                                Member
                              </span>
                            )}
                            {selectedSetId === set.id && (
                              <CheckCircle2 className="w-5 h-5 text-brand-400" />
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* No sets available */}
                {!cancelLoading && inclusionSets.length === 0 && (
                  <div className="text-center py-8">
                    <AlertTriangle className="w-12 h-12 text-orange-400 mx-auto mb-3" />
                    <p className="text-gray-400">No inclusion sets available</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Unable to fetch inclusion sets from the contract
                    </p>
                  </div>
                )}

                {/* Error display */}
                {(cancelError || cancelHookError) && (
                  <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm text-red-300">{cancelError || cancelHookError}</p>
                        <button
                          onClick={() => setCancelError(null)}
                          className="text-xs text-red-400/70 hover:text-red-400 mt-2"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Success message */}
                {cancelTxHash && (
                  <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm text-emerald-300">Ragequit cancelled successfully!</p>
                        <a
                          href={`${explorerUrl}/tx/${cancelTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-emerald-400 hover:underline mt-1 inline-block"
                        >
                          View transaction
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-6 border-t border-surface-border flex gap-3">
                <button
                  onClick={() => setShowCancelModal(false)}
                  disabled={cancelSubmitting}
                  className="flex-1 py-3 rounded-xl font-semibold text-white bg-surface-elevated border border-surface-border hover:bg-surface-card transition-colors disabled:opacity-50"
                >
                  Close
                </button>
                <button
                  onClick={handleCancelRagequit}
                  disabled={cancelSubmitting || !selectedSetId || inclusionSets.length === 0}
                  className="flex-1 py-3 rounded-xl font-semibold text-white bg-brand-600 hover:bg-brand-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {cancelSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Cancelling...
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4" />
                      Cancel & Rejoin Set
                    </>
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
