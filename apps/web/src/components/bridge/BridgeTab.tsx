"use client";

import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDownUp,
  Wallet,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  ArrowRight,
  Clock,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccount } from "@starknet-react/core";
import { useNetwork } from "@/lib/contexts/NetworkContext";
import {
  useStarkGateBridge,
  type BridgeDepositParams,
  type WithdrawParams,
} from "@/lib/hooks/useStarkGateBridge";
import {
  TOKEN_METADATA,
  ETHEREUM_CHAIN_CONFIG,
  NETWORK_CONFIG,
  type BridgeTokenSymbol,
} from "@/lib/contracts/addresses";
import {
  type BridgeDirection,
  isValidEthereumAddress,
  getBridgeTimingEstimate,
  getMessagingFeeDisplay,
} from "@/lib/bridge/starkgateBridge";

// ============================================================================
// CONSTANTS
// ============================================================================

const BRIDGE_TOKENS: BridgeTokenSymbol[] = ["ETH", "STRK", "USDC", "wBTC"];

const TOKEN_ICONS: Record<BridgeTokenSymbol, string> = {
  ETH: "/tokens/eth.svg",
  STRK: "/tokens/strk.svg",
  USDC: "/tokens/usdc.svg",
  wBTC: "/tokens/wbtc.svg",
};

// ============================================================================
// BRIDGE TAB
// ============================================================================

export function BridgeTab() {
  const { address: l2Address } = useAccount();
  const { network, isMainnet } = useNetwork();
  const bridgeNetwork = isMainnet ? "mainnet" : "sepolia";
  const ethChainConfig = ETHEREUM_CHAIN_CONFIG[bridgeNetwork];
  const starknetExplorer = NETWORK_CONFIG[network]?.explorerUrl || "";

  const { state, ethWallet, deposit, withdraw, reset } =
    useStarkGateBridge();

  // Form state
  const [direction, setDirection] = useState<BridgeDirection>("deposit");
  const [selectedToken, setSelectedToken] = useState<BridgeTokenSymbol>("ETH");
  const [amount, setAmount] = useState("");
  const [l1Recipient, setL1Recipient] = useState("");

  const isDeposit = direction === "deposit";
  const isProcessing = state.stage !== "idle" && state.stage !== "confirmed" && state.stage !== "error";

  // Validation
  const amountValid = useMemo(() => {
    if (!amount) return false;
    const n = parseFloat(amount);
    return !isNaN(n) && n > 0;
  }, [amount]);

  const recipientValid = useMemo(() => {
    if (isDeposit) return true; // L2 recipient is the connected wallet
    return isValidEthereumAddress(l1Recipient);
  }, [isDeposit, l1Recipient]);

  const canSubmit = useMemo(() => {
    if (isProcessing) return false;
    if (!amountValid) return false;
    if (isDeposit) return !!ethWallet.address;
    return !!l2Address && recipientValid;
  }, [isProcessing, amountValid, isDeposit, ethWallet.address, l2Address, recipientValid]);

  // Actions
  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    reset();

    if (isDeposit) {
      if (!l2Address) return;
      const params: BridgeDepositParams = {
        token: selectedToken,
        amount,
        l2Recipient: l2Address,
        network: bridgeNetwork,
      };
      await deposit(params);
    } else {
      const params: WithdrawParams = {
        token: selectedToken,
        amount,
        l1Recipient,
        network: bridgeNetwork,
      };
      await withdraw(params);
    }
  }, [canSubmit, isDeposit, l2Address, selectedToken, amount, l1Recipient, bridgeNetwork, deposit, withdraw, reset]);

  const handleDirectionToggle = useCallback(
    (d: BridgeDirection) => {
      if (isProcessing) return;
      setDirection(d);
      setAmount("");
      setL1Recipient("");
      reset();
    },
    [isProcessing, reset]
  );

  return (
    <motion.div
      key="bridge"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="surface-card rounded-2xl p-4 sm:p-6 border border-surface-border">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-brand-500/20 flex items-center justify-center border border-emerald-500/20">
            <ArrowDownUp className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">StarkGate Bridge</h2>
            <p className="text-xs text-gray-400">
              Native L1 &harr; L2 bridging via StarkGate
            </p>
          </div>
        </div>

        {/* Direction Toggle */}
        <div className="flex gap-1 p-1 bg-surface-elevated rounded-xl mb-4">
          {(["deposit", "withdraw"] as BridgeDirection[]).map((d) => (
            <button
              key={d}
              onClick={() => handleDirectionToggle(d)}
              className={cn(
                "flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all",
                direction === d
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "text-gray-400 hover:text-white"
              )}
            >
              {d === "deposit" ? "Deposit (L1 → L2)" : "Withdraw (L2 → L1)"}
            </button>
          ))}
        </div>

        {/* Token Selector */}
        <div className="mb-4">
          <label className="text-xs text-gray-500 mb-2 block">Token</label>
          <div className="flex gap-2">
            {BRIDGE_TOKENS.map((t) => (
              <button
                key={t}
                onClick={() => !isProcessing && setSelectedToken(t)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all border",
                  selectedToken === t
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                    : "bg-surface-elevated text-gray-400 border-transparent hover:text-white hover:border-surface-border"
                )}
              >
                <img
                  src={TOKEN_ICONS[t]}
                  alt={t}
                  className="w-4 h-4 rounded-full"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* MetaMask Connection (deposits only) */}
        {isDeposit && (
          <div className="mb-4">
            <label className="text-xs text-gray-500 mb-2 block">
              Ethereum Wallet (L1)
            </label>
            {ethWallet.address ? (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-surface-elevated border border-surface-border">
                <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center">
                  <Wallet className="w-3.5 h-3.5 text-orange-400" />
                </div>
                <span className="text-sm text-white font-mono">
                  {ethWallet.address.slice(0, 6)}...{ethWallet.address.slice(-4)}
                </span>
                <span className="text-[10px] text-emerald-400 ml-auto">Connected</span>
              </div>
            ) : (
              <button
                onClick={ethWallet.connect}
                disabled={ethWallet.isConnecting}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 hover:bg-orange-500/20 transition-all text-sm font-medium"
              >
                {ethWallet.isConnecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wallet className="w-4 h-4" />
                )}
                Connect MetaMask
              </button>
            )}
          </div>
        )}

        {/* Amount Input */}
        <div className="mb-4">
          <label className="text-xs text-gray-500 mb-2 block">Amount</label>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                const v = e.target.value;
                if (/^\d*\.?\d*$/.test(v)) setAmount(v);
              }}
              disabled={isProcessing}
              className="w-full px-4 py-3 pr-20 rounded-xl bg-surface-elevated border border-surface-border text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 text-lg font-mono"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">
              {selectedToken}
            </span>
          </div>
          <p className="text-[10px] text-gray-600 mt-1">
            {TOKEN_METADATA[selectedToken]?.decimals ?? 18} decimals
          </p>
        </div>

        {/* L1 Recipient (withdrawals) */}
        {!isDeposit && (
          <div className="mb-4">
            <label className="text-xs text-gray-500 mb-2 block">
              Ethereum L1 Recipient
            </label>
            <input
              type="text"
              placeholder="0x..."
              value={l1Recipient}
              onChange={(e) => setL1Recipient(e.target.value.trim())}
              disabled={isProcessing}
              className={cn(
                "w-full px-4 py-3 rounded-xl bg-surface-elevated border text-white placeholder-gray-600 focus:outline-none text-sm font-mono",
                l1Recipient && !recipientValid
                  ? "border-red-500/50 focus:border-red-500/70"
                  : "border-surface-border focus:border-emerald-500/50"
              )}
            />
            {l1Recipient && !recipientValid && (
              <p className="text-[10px] text-red-400 mt-1">
                Invalid Ethereum address (must be 0x + 40 hex characters)
              </p>
            )}
          </div>
        )}

        {/* Fee + Timing Info */}
        <div className="space-y-2 mb-4">
          {isDeposit && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-surface-elevated/50 border border-surface-border">
              <span className="text-xs text-gray-500">L1→L2 messaging fee</span>
              <span className="text-xs text-gray-300 font-mono">{getMessagingFeeDisplay()}</span>
            </div>
          )}
          <div className="flex items-start gap-2 p-3 rounded-xl bg-surface-elevated/50 border border-surface-border">
            <Clock className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
            <div className="text-xs text-gray-400">
              <span className="text-gray-300 font-medium">Estimated time: </span>
              {getBridgeTimingEstimate(direction)}
            </div>
          </div>
        </div>

        {/* Info Banner */}
        <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-500/5 border border-blue-500/10 mb-4">
          <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-300/70">
            {isDeposit
              ? "Deposits go through Ethereum L1 → Starknet L2 via the official StarkGate bridge. Your tokens will appear in your Starknet wallet once the L2 message is processed."
              : "Withdrawals initiate on L2 and require a final claim on L1 via StarkGate after the proof is posted (~2-6 hours)."}
          </p>
        </div>

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold transition-all",
            canSubmit
              ? "bg-gradient-to-r from-emerald-500 to-brand-500 text-white hover:opacity-90 shadow-lg shadow-emerald-500/20"
              : "bg-surface-elevated text-gray-500 cursor-not-allowed"
          )}
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {state.message || "Processing..."}
            </>
          ) : (
            <>
              <ArrowRight className="w-4 h-4" />
              {isDeposit ? "Deposit to L2" : "Withdraw to L1"}
            </>
          )}
        </button>
      </div>

      {/* Progress Card */}
      <AnimatePresence mode="wait">
        {state.stage !== "idle" && (
          <motion.div
            key="bridge-progress"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="surface-card rounded-2xl p-4 sm:p-5 border border-surface-border"
          >
            {/* Progress Bar */}
            {isProcessing && (
              <div className="mb-3">
                <div className="w-full h-1.5 rounded-full bg-surface-elevated overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-brand-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${state.progress}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                <p className="text-[10px] text-gray-500 mt-1 text-right">
                  {state.progress}%
                </p>
              </div>
            )}

            {/* Status */}
            <div className="flex items-start gap-3">
              {state.stage === "confirmed" && (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
              )}
              {state.stage === "error" && (
                <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
              )}
              {isProcessing && (
                <Loader2 className="w-5 h-5 text-emerald-400 animate-spin mt-0.5 shrink-0" />
              )}

              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    "text-sm font-medium",
                    state.stage === "confirmed" && "text-emerald-400",
                    state.stage === "error" && "text-red-400",
                    isProcessing && "text-white"
                  )}
                >
                  {state.stage === "confirmed" && "Bridge Transaction Complete"}
                  {state.stage === "error" && "Transaction Failed"}
                  {isProcessing &&
                    (state.stage === "switching-chain"
                      ? "Switching Chain"
                      : state.stage === "connecting"
                      ? "Connecting Wallet"
                      : state.stage === "approving"
                      ? "Approving Token"
                      : state.stage === "depositing"
                      ? "Submitting Transaction"
                      : state.stage === "confirming"
                      ? "Confirming on L1"
                      : "Processing on L2")}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{state.message}</p>

                {/* Transaction links */}
                {state.l1TxHash && (
                  <a
                    href={`${ethChainConfig.explorerUrl}/tx/${state.l1TxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 mt-2"
                  >
                    <ExternalLink className="w-3 h-3" />
                    View on Etherscan
                  </a>
                )}
                {state.l2TxHash && (
                  <a
                    href={`${starknetExplorer}/tx/${state.l2TxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 mt-2 ml-3"
                  >
                    <ExternalLink className="w-3 h-3" />
                    View on Starkscan
                  </a>
                )}
              </div>
            </div>

            {/* Reset button for completed/error states */}
            {(state.stage === "confirmed" || state.stage === "error") && (
              <button
                onClick={() => {
                  reset();
                  setAmount("");
                }}
                className="mt-3 w-full py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-white bg-surface-elevated hover:bg-surface-border transition-all"
              >
                {state.stage === "error" ? "Try Again" : "New Bridge Transaction"}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Starkgate link */}
      <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500">
        <span>Powered by</span>
        <a
          href="https://starkgate.starknet.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-emerald-400/70 hover:text-emerald-400 transition-colors"
        >
          StarkGate
        </a>
      </div>
    </motion.div>
  );
}
