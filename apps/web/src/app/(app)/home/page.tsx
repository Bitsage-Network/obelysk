"use client";

import { useState, useMemo } from "react";
import { useAccount } from "@starknet-react/core";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Shield,
  Wallet,
  Activity,
  Layers,
  Bitcoin,
  EyeOff,
  ChevronRight,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNetwork } from "@/lib/contexts/NetworkContext";
import { useAllTokenBalances } from "@/lib/contracts";
import { useTransactionHistory } from "@/lib/hooks/useTransactionHistory";
import { usePragmaPrice } from "@/lib/hooks/usePragmaOracle";
import { useCoinGeckoPrices } from "@/lib/hooks/useCoinGeckoPrices";
import { TokenCard } from "@/components/portfolio/TokenCard";
import { AssetActionPanel } from "@/components/portfolio/AssetActionPanel";
import { PrivacySessionCard } from "@/components/privacy/PrivacySessionCard";
import type { NetworkType } from "@/lib/contracts/addresses";

// Token display configuration
const TOKENS = [
  { symbol: "ETH", name: "Ethereum", pricePair: "ETH_USD" },
  { symbol: "STRK", name: "Starknet", pricePair: "STRK_USD" },
  { symbol: "USDC", name: "USD Coin", pricePair: "USDC_USD" },
  { symbol: "wBTC", name: "Wrapped Bitcoin", pricePair: "BTC_USD" },
  { symbol: "SAGE", name: "SAGE Token", pricePair: "SAGE_USD" },
] as const;

function parseU256(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.floor(value));
  if (typeof value === 'string') {
    try { return BigInt(value); } catch { return 0n; }
  }
  if (Array.isArray(value)) {
    if (value.length >= 2) {
      // starknet.js raw felt array: [low, high]
      try {
        const low = BigInt(value[0]);
        const high = BigInt(value[1]);
        return low + (high << 128n);
      } catch { /* fall through */ }
    }
    if (value.length === 1) {
      return parseU256(value[0]);
    }
  }
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    // {low, high} u256 struct
    if ('low' in v && 'high' in v) {
      try {
        const low = BigInt(v.low as any);
        const high = BigInt(v.high as any);
        return low + (high << 128n);
      } catch { return 0n; }
    }
    // Single-field wrappers
    if ('balance' in v) return parseU256(v.balance);
    if ('amount' in v) return parseU256(v.amount);
    // starknet-react Result wrapper
    if ('value' in v) return parseU256(v.value);
  }
  if (value !== undefined && value !== null) {
    console.warn('[parseU256] Unknown balance shape:', typeof value, value);
  }
  return 0n;
}

function formatBalance(raw: bigint | undefined, decimals: number): string {
  if (!raw || raw === 0n) return "0.00";
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 4);
  const trimmed = fracStr.replace(/0+$/, "") || "0";
  if (whole === 0n && raw > 0n) return `0.${fracStr}`;
  return `${whole.toLocaleString()}.${trimmed}`;
}

export default function HomePage() {
  const { address } = useAccount();
  const { network } = useNetwork();
  const balances = useAllTokenBalances(address, network as NetworkType);
  const { transactions, isLoading: txLoading } = useTransactionHistory(address, network as NetworkType);

  // Pragma oracle prices (used when oracle contract is deployed)
  const ethPrice = usePragmaPrice("ETH_USD", network as NetworkType);
  const strkPrice = usePragmaPrice("STRK_USD", network as NetworkType);
  const btcPrice = usePragmaPrice("BTC_USD", network as NetworkType);
  const sagePrice = usePragmaPrice("SAGE_USD", network as NetworkType);

  // CoinGecko fallback (always fetched, used when Pragma returns no data)
  const geckoData = useCoinGeckoPrices();

  // Use Pragma if it returned real data, otherwise fall back to CoinGecko
  const prices: Record<string, number> = useMemo(() => {
    const pragmaETH = ethPrice.data?.price ?? 0;
    const pragmaSTRK = strkPrice.data?.price ?? 0;
    const pragmaBTC = btcPrice.data?.price ?? 0;
    const pragmaSAGE = sagePrice.data?.price ?? 0;

    const hasPragmaData = pragmaETH > 0 || pragmaSTRK > 0 || pragmaBTC > 0;

    if (hasPragmaData) {
      return {
        ETH: pragmaETH,
        STRK: pragmaSTRK,
        USDC: 1,
        wBTC: pragmaBTC,
        SAGE: pragmaSAGE,
      };
    }

    // Fallback to CoinGecko
    return geckoData.prices;
  }, [ethPrice.data?.price, strkPrice.data?.price, btcPrice.data?.price, sagePrice.data?.price, geckoData.prices]);

  // Asset action panel state
  const [selectedAsset, setSelectedAsset] = useState<{
    symbol: string;
    name: string;
    balance: string;
    usdValue: string;
  } | null>(null);

  // Compute token data
  const tokenData = useMemo(() => {
    return TOKENS.map((t) => {
      const bal = balances[t.symbol as keyof typeof balances];
      const decimals = bal && typeof bal === "object" && "decimals" in bal ? (bal.decimals as number) : 18;
      const raw = bal && typeof bal === "object" && "data" in bal ? parseU256(bal.data) : 0n;
      const formatted = formatBalance(raw, decimals);
      const numBalance = Number(raw) / Math.pow(10, decimals);
      const price = prices[t.symbol] || 0;
      const usdValue = (numBalance * price).toFixed(2);
      return {
        symbol: t.symbol,
        name: t.name,
        balance: formatted,
        usdValue,
        numUsdValue: numBalance * price,
      };
    });
  }, [balances, prices]);

  const totalUsdValue = useMemo(() => {
    return tokenData.reduce((sum, t) => sum + t.numUsdValue, 0);
  }, [tokenData]);

  const recentTx = useMemo(() => transactions.slice(0, 5), [transactions]);

  return (
    <div className="space-y-6 pb-24 md:pb-6">
      {/* Portfolio Value Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-4"
      >
        <p className="text-sm text-gray-400 mb-1">Portfolio Value</p>
        {balances.isLoading ? (
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
          </div>
        ) : (
          <h1 className="text-4xl sm:text-5xl font-bold text-white font-mono">
            ${totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </h1>
        )}
        <div className="flex items-center justify-center mt-2">
          <span className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border",
            network === "mainnet"
              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
              : "bg-orange-500/15 text-orange-400 border-orange-500/25"
          )}>
            <span className={cn(
              "w-1.5 h-1.5 rounded-full",
              network === "mainnet" ? "bg-emerald-400" : "bg-orange-400 animate-pulse"
            )} />
            {network}
          </span>
        </div>
        {!address && (
          <p className="text-xs text-gray-500 mt-2">Connect wallet to view balances</p>
        )}
      </motion.div>

      {/* Token Cards Grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Assets</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {tokenData.map((token, i) => (
            <TokenCard
              key={token.symbol}
              symbol={token.symbol}
              name={token.name}
              balance={token.balance}
              usdValue={token.usdValue}
              index={i}
              onTap={() =>
                setSelectedAsset({
                  symbol: token.symbol,
                  name: token.name,
                  balance: token.balance,
                  usdValue: token.usdValue,
                })
              }
            />
          ))}
        </div>
      </div>

      {/* Quick Access Row */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Privacy Features</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Privacy Pools", href: "/vault/privacy-pool", icon: Layers, color: "text-teal-400", bg: "bg-teal-500/10 border-teal-500/20" },
            { label: "Stealth Payments", href: "/vault/stealth", icon: EyeOff, color: "text-indigo-400", bg: "bg-indigo-500/10 border-indigo-500/20" },
            { label: "BTC Vault", href: "/vault/btc-vault", icon: Bitcoin, color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20" },
            { label: "Dark Pool", href: "/trade/darkpool", icon: Shield, color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20" },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "flex items-center gap-3 p-3 rounded-xl border transition-all hover:scale-[1.02] active:scale-[0.98]",
                item.bg
              )}
            >
              <item.icon className={cn("w-4 h-4", item.color)} />
              <span className={cn("text-sm font-medium", item.color)}>{item.label}</span>
              <ChevronRight className={cn("w-3.5 h-3.5 ml-auto", item.color, "opacity-50")} />
            </Link>
          ))}
        </div>
      </div>

      {/* Privacy Session Card */}
      <PrivacySessionCard />

      {/* Recent Activity */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-3.5 h-3.5" />
            Recent Activity
          </h2>
        </div>
        <div className="glass-card overflow-hidden">
          {txLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
            </div>
          ) : recentTx.length === 0 ? (
            <div className="py-8 text-center">
              <Activity className="w-6 h-6 text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No recent transactions</p>
              <p className="text-xs text-gray-600 mt-1">Transactions will appear here</p>
            </div>
          ) : (
            <div className="divide-y divide-surface-border">
              {recentTx.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center",
                      tx.type === "receive" ? "bg-emerald-500/10" : "bg-blue-500/10"
                    )}>
                      {tx.type === "receive" ? (
                        <Wallet className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <ExternalLink className="w-4 h-4 text-blue-400" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm text-white capitalize">{tx.type}</p>
                      <p className="text-xs text-gray-500 font-mono">
                        {tx.txHash.slice(0, 8)}...{tx.txHash.slice(-6)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={cn(
                      "text-sm font-mono",
                      tx.type === "receive" ? "text-emerald-400" : "text-white"
                    )}>
                      {tx.type === "receive" ? "+" : "-"}{tx.amountFormatted}
                    </p>
                    <p className="text-xs text-gray-500">{tx.token}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Asset Action Panel */}
      {selectedAsset && (
        <AssetActionPanel
          isOpen={!!selectedAsset}
          onClose={() => setSelectedAsset(null)}
          symbol={selectedAsset.symbol}
          name={selectedAsset.name}
          balance={selectedAsset.balance}
          usdValue={selectedAsset.usdValue}
        />
      )}
    </div>
  );
}
