"use client";

import { useState, useMemo } from "react";
import {
  Eye,
  EyeOff,
  Search,
  Clock,
  CheckCircle2,
  Copy,
  Check,
  Download,
  QrCode,
  Wallet,
  ArrowDownToLine,
  RefreshCw,
  Loader2,
  Info,
  Key,
  Lock,
  Send,
  AlertCircle,
  ChevronDown,
  Filter,
  Scan,
  Fingerprint,
  Shield,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useAccount } from "@starknet-react/core";
import { useStealthOnChain, type ClaimParams } from "@/lib/hooks/useStealthOnChain";
import { usePrivacyKeys } from "@/lib/hooks/usePrivacyKeys";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TIME_RANGES = [
  { id: "1h", label: "Last Hour" },
  { id: "24h", label: "Last 24 Hours" },
  { id: "7d", label: "Last 7 Days" },
  { id: "30d", label: "Last 30 Days" },
  { id: "all", label: "All Time" },
];

// Stagger animation
const stagger = {
  container: { animate: { transition: { staggerChildren: 0.06 } } },
  item: {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function StealthAddressesPage() {
  const { address } = useAccount();
  const { hasKeys, initializeKeys, unlockKeys } = usePrivacyKeys();
  const [showSpendingKey, setShowSpendingKey] = useState(false);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState(TIME_RANGES[1]);
  const [selectedPayments, setSelectedPayments] = useState<string[]>([]);
  const [showQRCode, setShowQRCode] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [filterStatus, setFilterStatus] = useState<"all" | "unclaimed" | "claimed">("all");
  const [claimError, setClaimError] = useState<string | null>(null);

  const {
    metaAddress: metaAddressData,
    payments,
    unclaimedCount,
    totalUnclaimedValue,
    isLoading,
    scan,
    isScanning,
    claim,
    isClaiming,
    register,
    isRegistering,
    registryDeployed,
    refetch,
  } = useStealthOnChain(address);

  const isRegistered = !!metaAddressData;

  const metaAddress = {
    spendingPubKey: metaAddressData?.spending_pub_key || (address ? "Not registered" : "Connect wallet to view"),
    viewingPubKey: metaAddressData?.viewing_pub_key || (address ? "Not registered" : "Connect wallet to view"),
  };

  const [registerError, setRegisterError] = useState<string | null>(null);

  const handleRegister = async () => {
    if (!address) return;
    setRegisterError(null);
    try {
      // Pre-flight: check on-chain if already registered to avoid RPC error
      const { RpcProvider } = await import("starknet");
      const provider = new RpcProvider({ nodeUrl: "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/demo" });
      try {
        const existing = await provider.callContract({
          contractAddress: "0x0515da02daf6debb3807f1706d1f3675000bb06b14fe0e2a07627d15594920d5",
          entrypoint: "get_meta_address",
          calldata: [address],
        });
        const data: string[] = Array.isArray(existing) ? existing : [];
        if (data.length >= 4 && BigInt(data[0] || "0") !== 0n) {
          // Already registered — just refetch to update UI
          refetch();
          return;
        }
      } catch {
        // get_meta_address reverted — user is not registered, proceed
      }

      // Initialize keys if not done yet
      if (!hasKeys) {
        await initializeKeys();
      }
      // Unlock privacy keys to get the keypair
      const keyPair = await unlockKeys();
      if (!keyPair) {
        setRegisterError("Failed to unlock privacy keys. Please try again.");
        return;
      }
      // Derive spending + viewing public keys from the private key
      const { scalarMult, getGenerator } = await import("@/lib/crypto");
      const G = getGenerator();
      const spendingPubKey = scalarMult(keyPair.privateKey, G);
      const viewingPubKey = scalarMult(keyPair.privateKey, G);

      await register({ spendingPubKey, viewingPubKey });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // If already registered, refetch to pick up existing on-chain data
      if (msg.includes("Already registered") || msg.includes("already registered")) {
        refetch();
        return;
      }
      setRegisterError(msg);
    }
  };

  const handleCopy = (value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedValue(value);
    setTimeout(() => setCopiedValue(null), 2000);
  };

  const handleScan = async () => {
    if (!address) return;
    setScanProgress(0);
    scan({ address, timeRange: selectedTimeRange.id });
    const progressInterval = setInterval(() => {
      setScanProgress(prev => {
        if (prev >= 90) { clearInterval(progressInterval); return 90; }
        return prev + 10;
      });
    }, 200);
  };

  useMemo(() => {
    if (!isScanning && scanProgress > 0) {
      setScanProgress(100);
      setTimeout(() => setScanProgress(0), 500);
    }
  }, [isScanning, scanProgress]);

  const handleClaimSelected = async () => {
    if (selectedPayments.length === 0 || !address) return;
    setClaimError(null);
    try {
      const keyPair = await unlockKeys();
      if (!keyPair) {
        setClaimError("Failed to unlock stealth keys. Please set up privacy keys first.");
        return;
      }
      claim({ address, paymentIds: selectedPayments, spendingKey: keyPair.privateKey, viewingKey: keyPair.privateKey });
      setSelectedPayments([]);
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Failed to claim");
    }
  };

  const handleClaimSingle = async (paymentId: string) => {
    if (!address) return;
    setClaimError(null);
    try {
      const keyPair = await unlockKeys();
      if (!keyPair) {
        setClaimError("Failed to unlock stealth keys. Please set up privacy keys first.");
        return;
      }
      claim({ address, paymentIds: [paymentId], spendingKey: keyPair.privateKey, viewingKey: keyPair.privateKey });
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Failed to claim");
    }
  };

  const togglePaymentSelection = (paymentId: string) => {
    if (selectedPayments.includes(paymentId)) {
      setSelectedPayments(selectedPayments.filter(id => id !== paymentId));
    } else {
      if (selectedPayments.length < 20) {
        setSelectedPayments([...selectedPayments, paymentId]);
      }
    }
  };

  const filteredPayments = useMemo(() => {
    return payments.filter(payment => {
      if (filterStatus === "unclaimed") return !payment.claimed;
      if (filterStatus === "claimed") return payment.claimed;
      return true;
    });
  }, [payments, filterStatus]);

  const unclaimedPayments = payments.filter(p => !p.claimed);
  const totalUnclaimed = parseFloat(totalUnclaimedValue) / 1e18;
  const hasEncryptedAmounts = payments.length > 0 && totalUnclaimedValue === "0";

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <motion.div
      variants={stagger.container}
      initial="initial"
      animate="animate"
      className="max-w-6xl mx-auto space-y-6 px-4 sm:px-6 pb-24 lg:pb-8 relative"
    >
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute top-0 left-1/3 w-[500px] h-[250px] bg-indigo-500/[0.03] rounded-full blur-[120px]" />
        <div className="absolute bottom-1/3 right-0 w-[400px] h-[300px] bg-fuchsia-500/[0.02] rounded-full blur-[100px]" />
      </div>

      {/* ── Header ── */}
      <motion.div variants={stagger.item} className="relative flex items-center justify-between pt-2">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/15 border border-indigo-500/20 flex items-center justify-center shadow-lg shadow-indigo-500/10">
              <EyeOff className="w-7 h-7 text-indigo-400" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-surface-dark border-2 border-surface-card flex items-center justify-center">
              <Shield className="w-2.5 h-2.5 text-indigo-400" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Stealth Addresses</h1>
            <p className="text-[13px] text-gray-500 mt-0.5">
              Receive private payments with one-time stealth addresses
            </p>
          </div>
        </div>
        <Link
          href="/vault"
          className="text-[10px] text-gray-600 hover:text-indigo-400 transition-colors uppercase tracking-[0.2em] font-medium"
        >
          Vault
        </Link>
      </motion.div>

      {/* ── Registry Status ── */}
      {registryDeployed && (
        <motion.div
          variants={stagger.item}
          className="relative overflow-hidden rounded-xl border border-white/[0.04] bg-black/20 px-4 py-3 flex items-center justify-between text-xs"
        >
          <div className="flex items-center gap-3">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <span className="text-gray-500 font-medium">Stealth Registry</span>
            <span className="text-emerald-400/70 font-mono">Live on Sepolia</span>
          </div>
          <span className="text-[10px] text-gray-600 font-mono">STRK</span>
        </motion.div>
      )}

      {/* ── Stats Overview ── */}
      <motion.div variants={stagger.item} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          {
            label: "Unclaimed Payments",
            value: isLoading ? null : unclaimedCount.toString(),
            icon: ArrowDownToLine,
            color: "text-indigo-400",
            glow: "bg-indigo-500/8",
          },
          {
            label: "Total Unclaimed Value",
            value: isLoading ? null : hasEncryptedAmounts ? "Encrypted" : `${totalUnclaimed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} STRK`,
            icon: hasEncryptedAmounts ? Lock : Wallet,
            color: "text-emerald-400",
            glow: "bg-emerald-500/8",
          },
          {
            label: "Total Claimed",
            value: isLoading ? null : payments.filter(p => p.claimed).length.toString(),
            icon: CheckCircle2,
            color: "text-fuchsia-400",
            glow: "bg-fuchsia-500/8",
          },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="relative overflow-hidden rounded-2xl border border-white/[0.05] bg-surface-card/80 p-4"
            >
              <div className="flex items-center gap-3.5">
                <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center", stat.glow)}>
                  <Icon className={cn("w-5 h-5", stat.color)} />
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-medium">{stat.label}</p>
                  <p className="text-lg font-bold text-white mt-0.5">
                    {stat.value === null ? (
                      <Loader2 className="w-4 h-4 animate-spin inline text-gray-600" />
                    ) : stat.value === "Encrypted" ? (
                      <span className="flex items-center gap-1.5 text-indigo-400">
                        <Lock className="w-4 h-4" /> Encrypted
                      </span>
                    ) : (
                      stat.value
                    )}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </motion.div>

      {/* ── Main Content Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-5">

          {/* ── Meta Address Display ── */}
          <motion.div
            variants={stagger.item}
            className="relative overflow-hidden rounded-2xl border border-white/[0.05] bg-gradient-to-br from-surface-card via-surface-card to-indigo-950/10 p-6 space-y-5"
          >
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/[0.04] rounded-full blur-3xl pointer-events-none" />

            <div className="relative flex items-center justify-between">
              <h3 className="text-lg font-bold text-white tracking-tight">Your Stealth Meta-Address</h3>
              <button
                onClick={() => setShowQRCode(!showQRCode)}
                className={cn(
                  "p-2.5 rounded-xl border transition-all",
                  showQRCode
                    ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
                    : "bg-white/[0.03] border-white/[0.04] text-gray-500 hover:text-white hover:border-white/[0.08]"
                )}
              >
                <QrCode className="w-4.5 h-4.5" />
              </button>
            </div>

            <p className="text-[13px] text-gray-500 leading-relaxed">
              Share this meta-address to receive private payments. Senders will derive a unique one-time address for each payment.
            </p>

            {/* Registration prompt when connected but not registered */}
            {address && !isRegistered && !isLoading && (
              <div className="rounded-xl border border-indigo-500/15 bg-indigo-500/[0.04] p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <Key className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-white">Register Your Stealth Meta-Address</p>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      Publish your stealth keys on-chain so others can send you private payments. This requires privacy keys to be initialized.
                    </p>
                  </div>
                </div>
                {registerError && (
                  <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/[0.06] border border-red-500/10 rounded-lg px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {registerError}
                  </div>
                )}
                <button
                  onClick={handleRegister}
                  disabled={isRegistering}
                  className={cn(
                    "w-full py-2.5 rounded-xl text-sm font-medium transition-all",
                    "bg-indigo-600 hover:bg-indigo-500 text-white",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    "flex items-center justify-center gap-2"
                  )}
                >
                  {isRegistering ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Registering...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Register Meta-Address
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Viewing Key */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Eye className="w-3.5 h-3.5 text-indigo-400" />
                <label className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-medium">Viewing Public Key</label>
              </div>
              <div className="flex items-center gap-2 p-3.5 rounded-xl bg-black/30 border border-white/[0.06]">
                <code className={cn("text-[13px] flex-1 font-mono truncate", isRegistered ? "text-gray-300" : "text-gray-600 italic")}>
                  {metaAddress.viewingPubKey}
                </code>
                {isRegistered && (
                  <button
                    onClick={() => handleCopy(metaAddress.viewingPubKey)}
                    className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors shrink-0"
                  >
                    {copiedValue === metaAddress.viewingPubKey ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-gray-500" />
                    )}
                  </button>
                )}
              </div>
              <p className="text-[10px] text-gray-600 pl-0.5">
                Safe to share — allows scanning for incoming payments
              </p>
            </div>

            {/* Spending Key */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="w-3.5 h-3.5 text-fuchsia-400" />
                  <label className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-medium">Spending Public Key</label>
                </div>
                <button
                  onClick={() => setShowSpendingKey(!showSpendingKey)}
                  className="text-[10px] text-indigo-400/80 hover:text-indigo-400 flex items-center gap-1.5 transition-colors"
                >
                  {showSpendingKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {showSpendingKey ? "Hide" : "Show"}
                </button>
              </div>
              <div className="flex items-center gap-2 p-3.5 rounded-xl bg-black/30 border border-white/[0.06]">
                <code className="text-[13px] text-gray-300 flex-1 font-mono truncate">
                  {showSpendingKey ? metaAddress.spendingPubKey : "••••••••••••••••••••••••••••••••••••••••••••"}
                </code>
                <button
                  onClick={() => handleCopy(metaAddress.spendingPubKey)}
                  className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors shrink-0"
                >
                  {copiedValue === metaAddress.spendingPubKey ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-gray-500" />
                  )}
                </button>
              </div>
              <p className="text-[10px] text-gray-600 pl-0.5">
                Required for receiving — keep this secure
              </p>
            </div>

            {/* QR Code */}
            <AnimatePresence>
              {showQRCode && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, height: 0 }}
                  animate={{ opacity: 1, scale: 1, height: "auto" }}
                  exit={{ opacity: 0, scale: 0.95, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="p-6 rounded-xl bg-white mx-auto w-fit">
                    <QRCodeSVG
                      value={`st:starknet:${metaAddress.spendingPubKey}:${metaAddress.viewingPubKey}`}
                      size={192}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#000000"
                    />
                    <p className="text-center text-gray-600 text-[11px] mt-2 font-medium">Scan to get meta-address</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* ── Payment Scanner ── */}
          <motion.div
            variants={stagger.item}
            className="rounded-2xl border border-white/[0.05] bg-surface-card/90 p-6 space-y-5"
          >
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                  <Scan className="w-4 h-4 text-indigo-400" />
                </div>
                <h3 className="text-lg font-bold text-white tracking-tight">Payment Scanner</h3>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <select
                    value={selectedTimeRange.id}
                    onChange={(e) => {
                      const range = TIME_RANGES.find(r => r.id === e.target.value);
                      if (range) setSelectedTimeRange(range);
                    }}
                    className="appearance-none pl-3 pr-8 py-2.5 rounded-xl bg-black/30 border border-white/[0.06] text-xs text-white focus:outline-none focus:border-indigo-500/30 transition-all"
                  >
                    {TIME_RANGES.map((range) => (
                      <option key={range.id} value={range.id}>{range.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600 pointer-events-none" />
                </div>

                <button
                  onClick={handleScan}
                  disabled={isScanning || !address}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200",
                    isScanning || !address
                      ? "bg-white/[0.03] text-gray-600 cursor-not-allowed border border-white/[0.04]"
                      : "bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25 border border-indigo-500/20 active:scale-[0.98]"
                  )}
                >
                  {isScanning ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Scanning ({scanProgress}%)
                    </>
                  ) : (
                    <>
                      <Search className="w-3.5 h-3.5" />
                      {address ? "Scan" : "Connect Wallet"}
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Scanning Progress */}
            {isScanning && (
              <div className="space-y-2">
                <div className="h-1.5 rounded-full bg-white/[0.03] overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${scanProgress}%` }}
                    transition={{ duration: 0.2 }}
                  />
                </div>
                <p className="text-[11px] text-gray-500">
                  Scanning blockchain for payments using your viewing key...
                </p>
              </div>
            )}

            {/* Filter Tabs */}
            <div className="flex items-center gap-2.5">
              <Filter className="w-3.5 h-3.5 text-gray-600" />
              <div className="flex gap-1 p-1 rounded-xl bg-black/20 border border-white/[0.04]">
                {(["all", "unclaimed", "claimed"] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => setFilterStatus(status)}
                    className={cn(
                      "px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 capitalize",
                      filterStatus === status
                        ? "bg-indigo-500/12 text-indigo-400 border border-indigo-500/15"
                        : "text-gray-600 hover:text-gray-300 border border-transparent"
                    )}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>

            {/* Payment List */}
            <div className="space-y-2">
              {isLoading ? (
                <div className="text-center py-12">
                  <Loader2 className="w-8 h-8 text-indigo-400/40 mx-auto mb-3 animate-spin" />
                  <p className="text-sm text-gray-500">Loading payments...</p>
                </div>
              ) : filteredPayments.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-14 h-14 rounded-2xl bg-white/[0.02] border border-white/[0.04] flex items-center justify-center mx-auto mb-4">
                    <Search className="w-7 h-7 text-gray-700" />
                  </div>
                  <p className="text-sm text-gray-400 font-medium">No payments found</p>
                  <p className="text-xs text-gray-600 mt-1">
                    {!address ? "Connect your wallet to view payments" : "Try scanning with a different time range"}
                  </p>
                </div>
              ) : (
                filteredPayments.map((payment) => (
                  <motion.div
                    key={payment.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "flex items-center gap-4 p-4 rounded-xl border transition-all duration-200 group",
                      payment.claimed
                        ? "bg-black/10 border-white/[0.03] opacity-60"
                        : "bg-black/20 border-white/[0.05] hover:border-indigo-500/20 hover:bg-white/[0.02]"
                    )}
                  >
                    {!payment.claimed && (
                      <button
                        onClick={() => togglePaymentSelection(payment.id)}
                        className={cn(
                          "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all shrink-0",
                          selectedPayments.includes(payment.id)
                            ? "bg-indigo-500 border-indigo-500"
                            : "border-gray-600 hover:border-gray-400"
                        )}
                      >
                        {selectedPayments.includes(payment.id) && (
                          <Check className="w-3 h-3 text-white" />
                        )}
                      </button>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span className="font-semibold text-white text-sm tracking-tight">
                          {payment.amount_formatted} {payment.token_symbol}
                        </span>
                        {payment.claimed && (
                          <span className="text-[9px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/15 uppercase tracking-wider font-medium">
                            Claimed
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[10px] text-gray-500 truncate max-w-[200px] font-mono">
                          {payment.stealth_address}
                        </span>
                        <span className="text-[10px] text-gray-600 font-mono">
                          Tag: {payment.view_tag}
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-[11px] text-gray-500 font-mono">{formatTimeAgo(payment.timestamp * 1000)}</p>
                      {!payment.claimed && (
                        <button
                          onClick={() => handleClaimSingle(payment.id)}
                          disabled={isClaiming}
                          className="mt-1.5 text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold uppercase tracking-wider transition-colors"
                        >
                          {isClaiming ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Claim"}
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))
              )}
            </div>

            {/* Claim Error */}
            {claimError && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-500/[0.05] border border-red-500/15">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-400/80">{claimError}</p>
              </div>
            )}

            {/* Keys Required Notice */}
            {!hasKeys && unclaimedPayments.length > 0 && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-500/[0.05] border border-amber-500/12">
                <Key className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-400/80">
                  Privacy keys required to claim payments. Your wallet will prompt you to sign a message to derive your stealth keys.
                </p>
              </div>
            )}

            {/* Batch Claim Bar */}
            <AnimatePresence>
              {selectedPayments.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="flex items-center justify-between p-4 rounded-xl bg-indigo-500/[0.06] border border-indigo-500/15"
                >
                  <div>
                    <p className="font-semibold text-white text-sm tracking-tight">
                      {selectedPayments.length} payment{selectedPayments.length > 1 ? "s" : ""} selected
                    </p>
                    <p className="text-[10px] text-gray-500 mt-0.5">Max 20 payments per batch claim</p>
                  </div>
                  <button
                    onClick={handleClaimSelected}
                    disabled={isClaiming}
                    className={cn(
                      "flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200",
                      isClaiming
                        ? "bg-white/[0.03] text-gray-600 cursor-not-allowed"
                        : "bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25 border border-indigo-500/20 active:scale-[0.98]"
                    )}
                  >
                    {isClaiming ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Claiming...</>
                    ) : (
                      <><ArrowDownToLine className="w-3.5 h-3.5" /> Claim Selected</>
                    )}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* ── Right Column ── */}
        <div className="space-y-5">

          {/* Detection Key Export */}
          <motion.div
            variants={stagger.item}
            className="rounded-2xl border border-white/[0.05] bg-surface-card/80 p-5 space-y-4"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                <Download className="w-4 h-4 text-indigo-400" />
              </div>
              <h3 className="text-sm font-bold text-white tracking-tight">Detection Key Export</h3>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              Export your viewing key for third-party scanning services. This allows servers to detect payments on your behalf without access to spending authority.
            </p>

            <div className="p-3.5 rounded-xl bg-amber-500/[0.04] border border-amber-500/10">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-400/70 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] font-medium text-amber-300/90">Privacy Note</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    Sharing your viewing key allows detecting your payments but not spending them.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                if (!metaAddressData?.viewing_pub_key) return;
                const payload = {
                  version: 1,
                  type: "stealth-detection-key",
                  network: "starknet",
                  viewingPublicKey: metaAddressData.viewing_pub_key,
                  generatedAt: new Date().toISOString(),
                  note: "This key allows detecting stealth payments but NOT spending them.",
                };
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                const prefix = metaAddressData.viewing_pub_key.slice(0, 10);
                a.download = `stealth-detection-key-${prefix}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              disabled={!metaAddressData?.viewing_pub_key}
              className={cn(
                "w-full flex items-center justify-center gap-2 py-3 rounded-xl border text-xs font-semibold transition-all",
                metaAddressData?.viewing_pub_key
                  ? "bg-white/[0.03] border-white/[0.06] text-white hover:bg-white/[0.06] hover:border-white/[0.08]"
                  : "bg-white/[0.01] border-white/[0.03] text-gray-600 cursor-not-allowed"
              )}
            >
              <Download className="w-3.5 h-3.5" />
              Export Detection Key
            </button>
          </motion.div>

          {/* FMD Info */}
          <motion.div
            variants={stagger.item}
            className="rounded-2xl border border-white/[0.05] bg-surface-card/80 p-5 space-y-4"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-fuchsia-500/10 flex items-center justify-center">
                <Fingerprint className="w-4 h-4 text-fuchsia-400" />
              </div>
              <h3 className="text-sm font-bold text-white tracking-tight">Fuzzy Message Detection</h3>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              Your scanning uses FMD with view tags for efficient detection. Configure your detection precision in wallet settings.
            </p>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between p-3 rounded-xl bg-black/20 border border-white/[0.04]">
                <span className="text-xs text-gray-400">Detection Precision</span>
                <span className="text-xs font-mono text-white font-semibold">16 bits</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-black/20 border border-white/[0.04]">
                <span className="text-xs text-gray-400">False Positive Rate</span>
                <span className="text-xs font-mono text-white font-semibold">~0.0015%</span>
              </div>
            </div>
          </motion.div>

          {/* Info Card */}
          <motion.div
            variants={stagger.item}
            className="rounded-2xl border border-white/[0.04] bg-surface-card/60 p-4"
          >
            <div className="flex items-start gap-3">
              <Info className="w-4 h-4 text-indigo-400/60 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  <span className="text-gray-300 font-semibold">Stealth Addresses</span> enable receiving payments where each sender creates a unique one-time address. Only you can detect and claim these payments.
                </p>
                <Link href="/docs/stealth-addresses" className="text-indigo-400/80 text-[11px] hover:text-indigo-400 mt-2 inline-block transition-colors">
                  Learn more →
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
