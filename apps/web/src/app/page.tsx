"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Wallet,
  ArrowUpDown,
  Landmark,
  Send,
  Eye,
  EyeOff,
  Lock,
  Zap,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Activity,
  TrendingUp,
  TrendingDown,
  Layers,
  Bitcoin,
  ArrowDownUp,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Menu,
  X,
  Globe,
  Server,
  BookOpen,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedGridBackground } from "@/components/AnimatedGridBackground";

// Ecosystem projects
const ecosystemProjects = [
  {
    name: "BitSage Network",
    description: "Main ecosystem hub",
    href: "https://bitsage.network",
    icon: "/bitsage-logo.svg",
    active: false,
  },
  {
    name: "GPU Marketplace",
    description: "AI/ML compute cloud",
    href: "https://marketplace.bitsage.network",
    icon: Cpu,
    active: false,
  },
  {
    name: "Obelysk Protocol",
    description: "Privacy-first DeFi",
    href: "/",
    icon: Shield,
    active: true,
  },
  {
    name: "Validator Network",
    description: "STARK proof validation",
    href: "https://validator.bitsage.network",
    icon: Server,
    active: false,
  },
];


const features = [
  {
    icon: Lock,
    title: "Dark Pool Trading",
    description: "Execute large trades without market impact. Orders are encrypted with ElGamal and matched using ZK proofs—no one sees your strategy.",
    benefits: ["Zero slippage on large orders", "Hidden order flow", "MEV protection"],
    href: "/trade",
    tech: "ElGamal + STARK Proofs",
    gradient: "from-cyan-500/20 to-emerald-500/20",
    accentColor: "cyan",
    status: "live",
  },
  {
    icon: Wallet,
    title: "Privacy Wallets",
    description: "Fully encrypted wallet infrastructure. Your balances and transaction history remain private while maintaining auditability.",
    benefits: ["Encrypted balances", "Private transaction history", "Selective disclosure"],
    href: "/wallet",
    tech: "Homomorphic Encryption",
    gradient: "from-emerald-500/20 to-teal-500/20",
    accentColor: "emerald",
    status: "live",
  },
  {
    icon: Landmark,
    title: "Private Staking",
    description: "Earn yield without revealing your stake. Anonymous participation in network validation with verifiable rewards.",
    benefits: ["Hidden stake amounts", "Anonymous yield", "Governance participation"],
    href: "/stake",
    tech: "Pedersen Commitments",
    gradient: "from-amber-500/20 to-orange-500/20",
    accentColor: "amber",
    status: "coming",
  },
  {
    icon: Send,
    title: "Confidential Transfers",
    description: "Send tokens with full privacy over the Stark Curve. Recipients, amounts, and timing are all encrypted end-to-end.",
    benefits: ["Hidden recipients", "Encrypted amounts", "Provable transfers"],
    href: "/send",
    tech: "Same-Encryption Proofs",
    gradient: "from-violet-500/20 to-purple-500/20",
    accentColor: "violet",
    status: "live",
  },
];

const stats = [
  { label: "Network", value: "Starknet", icon: Layers },
  { label: "Privacy Model", value: "ElGamal + STARK", icon: Shield },
  { label: "Settlement", value: "On-chain", icon: Activity },
  { label: "Status", value: "Beta", icon: CheckCircle2 },
];

const supportedAssets = [
  { name: "Bitcoin (Wrapped)", symbol: "wBTC", logo: "/tokens/btc.svg" },
  { name: "Ethereum", symbol: "ETH", logo: "/tokens/eth.svg" },
  { name: "Starknet", symbol: "STRK", logo: "/tokens/strk.svg" },
  { name: "BitSage", symbol: "SAGE", logo: "/tokens/sage.svg" },
  { name: "USDC", symbol: "USDC", logo: "/tokens/usdc.svg" },
];

export default function HomePage() {
  const [showEcosystem, setShowEcosystem] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const ecosystemRef = useRef<HTMLDivElement>(null);

  // Close ecosystem dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ecosystemRef.current && !ecosystemRef.current.contains(event.target as Node)) {
        setShowEcosystem(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="min-h-screen bg-surface-dark text-white">
      {/* Top Status Bar */}
      <div className="bg-surface-card/50 border-b border-surface-border/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-9 flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2 text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Beta
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-4 text-gray-500">
            <a href="https://docs.bitsage.network/obelysk" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Docs</a>
            <a href="https://validator.bitsage.network" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Validator</a>
            <a href="https://discord.gg/bitsage" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Discord</a>
          </div>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="sticky top-0 z-50 bg-surface-dark/95 backdrop-blur-xl border-b border-surface-border/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            {/* Left: Obelysk Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <div className="relative">
                <Image
                  src="/obelysk-logo.svg"
                  alt="Obelysk"
                  width={36}
                  height={36}
                  className="rounded-lg"
                />
              </div>
              <div className="hidden xs:block">
                <h1 className="font-semibold text-white text-lg leading-none tracking-tight">Obelysk</h1>
                <span className="text-[11px] text-emerald-400 font-medium uppercase tracking-wider">Protocol</span>
              </div>
            </Link>

            {/* Center: Nav Links (Desktop) */}
            <div className="hidden lg:flex items-center gap-1">
              <Link
                href="/wallet"
                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                Wallet
              </Link>
              <Link
                href="/trade"
                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                Trade
              </Link>
              <Link
                href="/stake"
                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                Stake
              </Link>
              <Link
                href="/send"
                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                Send
              </Link>
              <a
                href="https://docs.bitsage.network/obelysk"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors flex items-center gap-1.5"
              >
                Docs
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Right: Ecosystem + Launch App + Mobile Menu */}
            <div className="flex items-center gap-3">
              {/* BitSage Ecosystem Dropdown */}
              <div className="relative" ref={ecosystemRef}>
                <button
                  onClick={() => setShowEcosystem(!showEcosystem)}
                  className={cn(
                    "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all",
                    showEcosystem
                      ? "bg-surface-elevated border-surface-border-hover"
                      : "bg-transparent border-transparent hover:bg-surface-card hover:border-surface-border"
                  )}
                >
                  <Image
                    src="/bitsage-logo.svg"
                    alt="BitSage"
                    width={24}
                    height={24}
                    className="rounded-md"
                  />
                  <span className="hidden sm:inline text-sm text-gray-400 font-medium">Ecosystem</span>
                  <ChevronDown className={cn(
                    "w-3.5 h-3.5 text-gray-500 transition-transform duration-200",
                    showEcosystem && "rotate-180"
                  )} />
                </button>

                {/* Ecosystem Dropdown Menu */}
                <AnimatePresence>
                  {showEcosystem && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.96 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 mt-2 w-72 bg-surface-card border border-surface-border rounded-xl shadow-2xl shadow-black/50 overflow-hidden"
                    >
                      {/* Header */}
                      <div className="px-4 py-3 border-b border-surface-border">
                        <div className="flex items-center gap-3">
                          <Image
                            src="/bitsage-logo.svg"
                            alt="BitSage"
                            width={28}
                            height={28}
                            className="rounded-lg"
                          />
                          <div>
                            <h3 className="font-semibold text-white text-sm">BitSage Network</h3>
                            <p className="text-xs text-gray-500">Ecosystem Products</p>
                          </div>
                        </div>
                      </div>

                      {/* Projects List */}
                      <div className="p-2">
                        {ecosystemProjects.map((project) => (
                          <a
                            key={project.name}
                            href={project.href}
                            target={project.href.startsWith("http") ? "_blank" : undefined}
                            rel={project.href.startsWith("http") ? "noopener noreferrer" : undefined}
                            onClick={() => setShowEcosystem(false)}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all",
                              project.active
                                ? "bg-white/5"
                                : "hover:bg-surface-elevated"
                            )}
                          >
                            <div className={cn(
                              "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                              project.active ? "bg-surface-elevated" : "bg-surface-card"
                            )}>
                              {typeof project.icon === "string" ? (
                                <Image
                                  src={project.icon}
                                  alt=""
                                  width={20}
                                  height={20}
                                  className="rounded"
                                />
                              ) : (
                                <project.icon className="w-4 h-4 text-gray-400" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  "font-medium text-sm",
                                  project.active ? "text-white" : "text-gray-300"
                                )}>{project.name}</span>
                                {project.active && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                )}
                              </div>
                              <p className="text-xs text-gray-500">{project.description}</p>
                            </div>
                            {project.href.startsWith("http") && (
                              <ExternalLink className="w-3.5 h-3.5 text-gray-600" />
                            )}
                          </a>
                        ))}
                      </div>

                      {/* Footer Links */}
                      <div className="px-4 py-3 border-t border-surface-border bg-surface-dark/50">
                        <a
                          href="https://bitsage.network"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between text-xs text-gray-500 hover:text-white transition-colors"
                        >
                          <span>Visit bitsage.network</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Divider */}
              <div className="hidden sm:block h-5 w-px bg-surface-border" />

              {/* Launch App Button */}
              <Link
                href="/wallet"
                className="hidden sm:flex items-center gap-2 px-4 py-2 bg-white hover:bg-gray-100 text-gray-900 text-sm font-medium rounded-lg transition-all"
              >
                Launch App
              </Link>

              {/* Mobile Menu Button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                {mobileMenuOpen ? (
                  <X className="w-6 h-6" />
                ) : (
                  <Menu className="w-6 h-6" />
                )}
              </button>
            </div>
          </div>

          {/* Mobile Menu */}
          <AnimatePresence>
            {mobileMenuOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="lg:hidden overflow-hidden border-t border-surface-border"
              >
                <div className="py-4 space-y-1">
                  <Link
                    href="/wallet"
                    className="block px-4 py-3 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Wallet
                  </Link>
                  <Link
                    href="/trade"
                    className="block px-4 py-3 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Trade
                  </Link>
                  <Link
                    href="/stake"
                    className="block px-4 py-3 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Stake
                  </Link>
                  <Link
                    href="/send"
                    className="block px-4 py-3 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Send
                  </Link>
                  <a
                    href="https://docs.bitsage.network/obelysk"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-4 py-3 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                  >
                    Documentation
                  </a>

                  <div className="pt-3 mt-3 border-t border-surface-border">
                    <p className="px-4 text-xs text-gray-500 uppercase tracking-wider mb-2">Ecosystem</p>
                    {ecosystemProjects.filter(p => !p.active).map((project) => (
                      <a
                        key={project.name}
                        href={project.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-400 hover:text-white transition-colors"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {typeof project.icon === "string" ? (
                          <Image src={project.icon} alt="" width={20} height={20} className="rounded" />
                        ) : (
                          <project.icon className="w-4 h-4" />
                        )}
                        {project.name}
                        <ExternalLink className="w-3 h-3 ml-auto" />
                      </a>
                    ))}
                  </div>

                  <div className="pt-3">
                    <Link
                      href="/wallet"
                      className="flex items-center justify-center gap-2 mx-4 py-3 bg-white hover:bg-gray-100 text-gray-900 text-sm font-medium rounded-lg transition-all"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Launch App
                    </Link>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-[80vh] flex items-center overflow-hidden">
        {/* Layer 1: Base gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-surface-dark via-[#0a0a12] to-surface-dark" />

        {/* Layer 2: Animated orbs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <motion.div
            className="absolute top-1/4 -left-32 w-96 h-96 bg-emerald-500/15 rounded-full blur-3xl"
            animate={{
              x: [0, 50, 0],
              y: [0, 30, 0],
              scale: [1, 1.1, 1],
            }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute bottom-1/4 -right-32 w-96 h-96 bg-cyan-500/15 rounded-full blur-3xl"
            animate={{
              x: [0, -50, 0],
              y: [0, -30, 0],
              scale: [1, 1.2, 1],
            }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-3xl"
            animate={{
              scale: [1, 1.3, 1],
              opacity: [0.05, 0.15, 0.05],
            }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        {/* Layer 3: Animated Grid with traveling pulses */}
        <div className="absolute inset-0 z-[1]">
          <AnimatedGridBackground />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-24">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-8"
            >
              <Shield className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-medium text-emerald-400">Privacy-First DeFi on Starknet</span>
            </motion.div>

            <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight">
              <span className="text-white">Your Wealth,</span>
              <br />
              <span className="text-white">Your </span>
              <span className="text-emerald-400">Privacy</span>
            </h1>

            <p className="text-xl md:text-2xl text-gray-400 max-w-3xl mx-auto mb-10 leading-relaxed">
              Trade Bitcoin and crypto assets with complete privacy. Dark pool orderbook,
              encrypted transactions, and zero-knowledge proofs.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/wallet">
                <button className="px-8 py-4 bg-white hover:bg-gray-100 text-gray-900 font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 w-full sm:w-auto">
                  <Wallet className="w-5 h-5" />
                  Launch App
                </button>
              </Link>
              <a href="#demo">
                <button className="px-8 py-4 bg-transparent hover:bg-white/5 border border-white/20 hover:border-white/30 text-white font-medium rounded-xl transition-all duration-200 flex items-center justify-center gap-2 w-full sm:w-auto">
                  View Demo
                  <ArrowRight className="w-5 h-5" />
                </button>
              </a>
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="mt-14 flex flex-wrap items-center justify-center gap-8 text-sm text-gray-500"
            >
              <div className="flex items-center gap-2">
                <Bitcoin className="w-4 h-4 text-orange-500" />
                <span>Private BTC Trading</span>
              </div>
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-gray-400" />
                <span>Stark Curve Cryptography</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-gray-400" />
                <span>Zero-Knowledge Proofs</span>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Stats Grid */}
      <section className="py-10 relative overflow-hidden border-y border-surface-border/30">
        {/* Subtle background */}
        <div className="absolute inset-0 bg-surface-card/20" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            {stats.map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1, duration: 0.5 }}
                whileHover={{ y: -2, transition: { duration: 0.2 } }}
                className="group relative"
              >
                {/* Compact card */}
                <div className="relative bg-surface-card/60 backdrop-blur-sm border border-surface-border/80 rounded-xl px-4 py-4 hover:border-emerald-500/30 transition-all duration-300 overflow-hidden">
                  {/* Top accent line */}
                  <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                  <div className="relative flex items-center gap-3">
                    {/* Icon */}
                    <div className="w-8 h-8 rounded-lg bg-surface-elevated/80 border border-surface-border/50 flex items-center justify-center flex-shrink-0 group-hover:border-emerald-500/30 group-hover:bg-emerald-500/10 transition-all duration-300">
                      <stat.icon className="w-4 h-4 text-gray-500 group-hover:text-emerald-400 transition-colors duration-300" />
                    </div>

                    <div className="min-w-0">
                      {/* Value */}
                      <div className="text-xl md:text-2xl font-bold text-white tracking-tight">
                        {stat.value}
                      </div>
                      {/* Label */}
                      <div className="text-xs text-gray-500 group-hover:text-gray-400 transition-colors truncate">
                        {stat.label}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Private Bitcoin Trading Section */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-orange-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-full bg-orange-500/20 border border-orange-500/30 mb-6">
              <Bitcoin className="w-5 h-5 text-orange-500" />
              <span className="text-sm font-bold text-orange-300">TRADE BITCOIN PRIVATELY</span>
            </div>

            <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
              Your Bitcoin. Your Privacy.
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              Finally trade BTC without exposing your wallet, balance, or trading history to the world.
            </p>
          </motion.div>

          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left: Benefits */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="space-y-6"
            >
              {[
                {
                  icon: EyeOff,
                  title: "Hidden Order Flow",
                  description: "Your buy and sell orders are encrypted. No one can front-run or copy your trades.",
                },
                {
                  icon: Shield,
                  title: "Wallet Privacy",
                  description: "Your BTC balance and transaction history remain completely private on-chain.",
                },
                {
                  icon: ArrowDownUp,
                  title: "Anonymous Swaps",
                  description: "Swap BTC for stablecoins or other assets without linking your identity.",
                },
                {
                  icon: Lock,
                  title: "Institutional Grade",
                  description: "Execute large orders without market impact. Perfect for whales and institutions.",
                },
              ].map((item, index) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="flex gap-4 p-4 rounded-xl bg-surface-card/50 border border-surface-border hover:border-orange-500/30 transition-all"
                >
                  <div className="w-12 h-12 rounded-lg bg-orange-500/20 flex items-center justify-center flex-shrink-0">
                    <item.icon className="w-6 h-6 text-orange-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">{item.title}</h3>
                    <p className="text-gray-400 text-sm">{item.description}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>

            {/* Right: Supported Assets */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="bg-surface-card rounded-2xl border border-surface-border p-8">
                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-cyan-400" />
                  Supported Assets
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {supportedAssets.map((asset, index) => (
                    <motion.div
                      key={asset.symbol}
                      initial={{ opacity: 0, y: 10 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: index * 0.05 }}
                      className="flex items-center gap-3 p-3 rounded-xl bg-surface-elevated border border-surface-border hover:border-white/20 transition-all group cursor-pointer"
                    >
                      <Image
                        src={asset.logo}
                        alt={asset.name}
                        width={32}
                        height={32}
                        className="rounded-full"
                      />
                      <div>
                        <div className="font-medium text-white text-sm">{asset.name}</div>
                        <div className="text-xs text-gray-500">{asset.symbol}</div>
                      </div>
                    </motion.div>
                  ))}
                </div>
                <div className="mt-6 p-4 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                  <p className="text-sm text-cyan-300">
                    <span className="font-semibold">Coming soon:</span> Cross-chain private bridges for BTC from Bitcoin mainnet.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* True Dark Pool - ZK Privacy Visualization */}
      <section id="demo" className="py-24 bg-surface-card/30 relative scroll-mt-20 overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-cyan-500/5 rounded-full blur-3xl" />
          {/* Floating encrypted particles */}
          {[...Array(12)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute text-[10px] font-mono text-cyan-500/20"
              style={{
                left: `${5 + (i * 8)}%`,
                top: `${10 + (i % 4) * 25}%`,
              }}
              animate={{
                y: [0, -30, 0],
                opacity: [0.1, 0.3, 0.1],
              }}
              transition={{
                duration: 4 + (i % 3),
                delay: i * 0.5,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            >
              {["0x7f3a", "0xb2c9", "0xe4d1", "0x9abc", "0x2f8e", "0x6c3b", "0x8d2e", "0xa1f4", "0x3e7f", "0xc5d8", "0x1b9a", "0xf2e6"][i]}...
            </motion.div>
          ))}
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/20 mb-6">
              <Lock className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-medium text-cyan-400">Zero-Knowledge Dark Pool</span>
            </div>

            <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">
              True Privacy. No Visible Orderbook.
            </h2>
            <p className="text-xl text-gray-400 max-w-3xl mx-auto">
              Unlike traditional exchanges, our dark pool has <span className="text-white font-semibold">no public orderbook</span>.
              All orders are encrypted with ElGamal encryption and matched using zero-knowledge proofs.
            </p>
          </motion.div>

          {/* Main Dark Pool Visualization */}
          <div className="grid lg:grid-cols-2 gap-8 mb-16">

            {/* Left: The Dark Pool "Black Box" */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="bg-surface-dark rounded-2xl border border-surface-border overflow-hidden h-full">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Bitcoin className="w-5 h-5 text-orange-500" />
                      <span className="font-bold text-white">BTC/USDC</span>
                    </div>
                    <div className="px-2 py-1 rounded bg-surface-elevated text-xs text-gray-400">Dark Pool</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs text-gray-500">Live</span>
                  </div>
                </div>

                {/* Reference Price */}
                <div className="px-6 py-4 border-b border-surface-border bg-surface-card/30">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-500">Oracle Reference Price</div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-white font-mono">—</span>
                      <span className="text-xs text-gray-400 bg-white/5 px-2 py-1 rounded">Live</span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-600 mt-1">via Pragma Oracle • Connect wallet for live prices</div>
                </div>

                {/* Encrypted Liquidity Visualization */}
                <div className="p-6">
                  <div className="text-sm text-gray-400 mb-4 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-cyan-400" />
                    Encrypted Order Pool
                  </div>

                  {/* The "Black Box" */}
                  <div className="relative">
                    {/* Encrypted orders visualization */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* Buy Orders */}
                      <motion.div
                        className="relative bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-5 overflow-hidden"
                        whileHover={{ borderColor: "rgba(16, 185, 129, 0.4)" }}
                      >
                        {/* Animated encryption particles flowing in */}
                        <div className="absolute inset-0 overflow-hidden">
                          {[...Array(8)].map((_, i) => (
                            <motion.div
                              key={i}
                              className="absolute w-1 h-1 rounded-full bg-emerald-400/60"
                              style={{ left: `${(i * 12.5) + 3}%` }}
                              initial={{ top: "-10%", opacity: 0 }}
                              animate={{
                                top: ["0%", "100%"],
                                opacity: [0, 0.8, 0],
                              }}
                              transition={{
                                duration: 2.2 + (i * 0.15),
                                delay: i * 0.4,
                                repeat: Infinity,
                                ease: "linear"
                              }}
                            />
                          ))}
                        </div>

                        {/* Encrypted hex codes */}
                        <div className="absolute inset-0 opacity-30">
                          {[...Array(6)].map((_, i) => (
                            <motion.div
                              key={i}
                              className="absolute text-[10px] font-mono text-emerald-500/50"
                              style={{ left: `${10 + (i % 3) * 30}%`, top: `${20 + Math.floor(i / 3) * 40}%` }}
                              animate={{ opacity: [0.2, 0.7, 0.2] }}
                              transition={{ duration: 2, delay: i * 0.3, repeat: Infinity }}
                            >
                              {["0x7f3a", "0x9bc2", "0xe4d1", "0x2af8", "0x6c3b", "0x8d2e"][i]}
                            </motion.div>
                          ))}
                        </div>

                        <div className="relative">
                          <div className="flex items-center gap-2 mb-3">
                            <Lock className="w-4 h-4 text-emerald-400" />
                            <span className="text-emerald-400 font-medium">Buy Orders</span>
                          </div>
                          <motion.div
                            className="text-4xl font-bold text-white mb-1"
                            animate={{ opacity: [1, 0.7, 1] }}
                            transition={{ duration: 3, repeat: Infinity }}
                          >
                            ••
                          </motion.div>
                          <div className="text-sm text-gray-500">encrypted orders</div>
                          <div className="mt-3 flex items-center gap-2 text-xs text-emerald-400/70">
                            <EyeOff className="w-3 h-3" />
                            <span>Prices & amounts hidden</span>
                          </div>
                        </div>
                      </motion.div>

                      {/* Sell Orders */}
                      <motion.div
                        className="relative bg-red-500/5 border border-red-500/20 rounded-xl p-5 overflow-hidden"
                        whileHover={{ borderColor: "rgba(239, 68, 68, 0.4)" }}
                      >
                        {/* Animated encryption particles flowing in */}
                        <div className="absolute inset-0 overflow-hidden">
                          {[...Array(8)].map((_, i) => (
                            <motion.div
                              key={i}
                              className="absolute w-1 h-1 rounded-full bg-red-400/60"
                              style={{ left: `${(i * 11) + 7}%` }}
                              initial={{ top: "-10%", opacity: 0 }}
                              animate={{
                                top: ["0%", "100%"],
                                opacity: [0, 0.8, 0],
                              }}
                              transition={{
                                duration: 2.3 + (i * 0.12),
                                delay: i * 0.4 + 0.2,
                                repeat: Infinity,
                                ease: "linear"
                              }}
                            />
                          ))}
                        </div>

                        {/* Encrypted hex codes */}
                        <div className="absolute inset-0 opacity-30">
                          {[...Array(6)].map((_, i) => (
                            <motion.div
                              key={i}
                              className="absolute text-[10px] font-mono text-red-500/50"
                              style={{ left: `${10 + (i % 3) * 30}%`, top: `${20 + Math.floor(i / 3) * 40}%` }}
                              animate={{ opacity: [0.2, 0.7, 0.2] }}
                              transition={{ duration: 2, delay: i * 0.3 + 0.5, repeat: Infinity }}
                            >
                              {["0x3e7f", "0xb1c4", "0x5d9a", "0xf2e6", "0x8a4c", "0x1d7b"][i]}
                            </motion.div>
                          ))}
                        </div>

                        <div className="relative">
                          <div className="flex items-center gap-2 mb-3">
                            <Lock className="w-4 h-4 text-red-400" />
                            <span className="text-red-400 font-medium">Sell Orders</span>
                          </div>
                          <motion.div
                            className="text-4xl font-bold text-white mb-1"
                            animate={{ opacity: [1, 0.7, 1] }}
                            transition={{ duration: 3, delay: 0.5, repeat: Infinity }}
                          >
                            ••
                          </motion.div>
                          <div className="text-sm text-gray-500">encrypted orders</div>
                          <div className="mt-3 flex items-center gap-2 text-xs text-red-400/70">
                            <EyeOff className="w-3 h-3" />
                            <span>Prices & amounts hidden</span>
                          </div>
                        </div>
                      </motion.div>
                    </div>

                    {/* Liquidity Confidence Indicator */}
                    <div className="mt-4 p-4 rounded-xl bg-surface-card/50 border border-surface-border">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm text-gray-400">Liquidity Depth</div>
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-400 text-sm font-medium">Active</span>
                          <div className="flex gap-0.5">
                            {[1, 2, 3, 4, 5].map((i) => (
                              <motion.div
                                key={i}
                                className={`w-1.5 h-4 rounded-full ${i <= 4 ? 'bg-emerald-500' : 'bg-gray-700'}`}
                                animate={i <= 4 ? { opacity: [0.5, 1, 0.5] } : {}}
                                transition={{ duration: 2, delay: i * 0.1, repeat: Infinity }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500">
                        Liquidity sourced from on-chain pools. Trade sizes may be limited during beta.
                      </div>
                    </div>

                    {/* ZK Matching Engine - Enhanced */}
                    <motion.div
                      className="mt-4 p-4 rounded-xl bg-gradient-to-r from-cyan-500/10 to-emerald-500/10 border border-cyan-500/20 relative overflow-hidden"
                      animate={{ borderColor: ["rgba(34, 211, 238, 0.2)", "rgba(16, 185, 129, 0.3)", "rgba(34, 211, 238, 0.2)"] }}
                      transition={{ duration: 4, repeat: Infinity }}
                    >
                      {/* Scanning line effect */}
                      <motion.div
                        className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent"
                        animate={{ top: ["0%", "100%", "0%"] }}
                        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                      />

                      <div className="flex items-center justify-between relative">
                        <div className="flex items-center gap-3">
                          <motion.div
                            className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 flex items-center justify-center relative"
                            animate={{ scale: [1, 1.05, 1] }}
                            transition={{ duration: 2, repeat: Infinity }}
                          >
                            {/* Orbiting particles */}
                            <motion.div
                              className="absolute w-full h-full"
                              animate={{ rotate: 360 }}
                              transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                            >
                              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-cyan-400" />
                              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            </motion.div>
                            <Zap className="w-5 h-5 text-cyan-400" />
                          </motion.div>
                          <div>
                            <div className="text-sm font-semibold text-white">ZK Matching Engine</div>
                            <div className="text-xs text-gray-500">Verifying proofs & matching commitments</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <motion.div
                            className="text-xs text-cyan-400 font-mono font-bold"
                            animate={{ opacity: [1, 0.5, 1] }}
                            transition={{ duration: 1, repeat: Infinity }}
                          >
                            ACTIVE
                          </motion.div>
                          <div className="text-[10px] text-gray-600 mt-0.5">STWO prover</div>
                        </div>
                      </div>

                      {/* Proof verification animation */}
                      <div className="mt-3 flex items-center gap-2">
                        <div className="text-[10px] text-gray-500 font-mono">Latest proof:</div>
                        <motion.div
                          className="text-[10px] text-cyan-400/70 font-mono"
                          animate={{ opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                        >
                          0x7f3a9b2c...e4d1 ✓
                        </motion.div>
                      </div>
                    </motion.div>
                  </div>
                </div>

                {/* Footer with live activity */}
                <div className="px-6 py-4 border-t border-surface-border bg-surface-card/20">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 text-gray-500">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        <span>No front-running</span>
                      </div>
                      <div className="flex items-center gap-2 text-gray-500">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        <span>MEV protected</span>
                      </div>
                    </div>
                    <motion.div
                      className="flex items-center gap-2 text-cyan-400"
                      animate={{ opacity: [0.7, 1, 0.7] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <Activity className="w-3 h-3" />
                      <span>Matching orders...</span>
                    </motion.div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Right: Your Private View (Simulated logged-in state) */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="bg-surface-dark rounded-2xl border border-surface-border overflow-hidden h-full">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center">
                      <Eye className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div>
                      <div className="font-semibold text-white text-sm">Your Private View</div>
                      <div className="text-xs text-gray-500">Only you can see this</div>
                    </div>
                  </div>
                  <div className="px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
                    Demo Mode
                  </div>
                </div>

                {/* Encryption Animation Demo */}
                <div className="px-6 py-4 border-b border-surface-border bg-gradient-to-r from-cyan-500/5 to-transparent">
                  <div className="flex items-center gap-3">
                    <motion.div
                      className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center"
                      animate={{ rotate: [0, 360] }}
                      transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                    >
                      <Lock className="w-4 h-4 text-cyan-400" />
                    </motion.div>
                    <div className="flex-1">
                      <div className="text-xs text-gray-400 mb-1">Encrypting your order data...</div>
                      <div className="flex items-center gap-2 text-[10px] font-mono">
                        <span className="text-gray-600">{"{ price: ••••, amount: •.•• }"}</span>
                        <motion.span
                          animate={{ opacity: [0, 1, 0] }}
                          transition={{ duration: 1, repeat: Infinity }}
                        >
                          →
                        </motion.span>
                        <motion.span
                          className="text-cyan-400"
                          animate={{ opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                        >
                          0x7f3a9b2c...
                        </motion.span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Your Orders */}
                <div className="p-6 border-b border-surface-border">
                  <div className="text-sm text-gray-400 mb-4 flex items-center gap-2">
                    <Lock className="w-4 h-4 text-cyan-400" />
                    Your Active Orders (Decrypted for you)
                  </div>

                  <div className="space-y-3">
                    {/* Order 1 - with live status animation */}
                    <motion.div
                      className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 relative overflow-hidden"
                      initial={{ opacity: 0, y: 10 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                    >
                      {/* Searching for match indicator */}
                      <motion.div
                        className="absolute top-0 left-0 h-full w-1 bg-gradient-to-b from-emerald-400 to-transparent"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />

                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded bg-emerald-500/20 flex items-center justify-center">
                            <TrendingUp className="w-3 h-3 text-emerald-400" />
                          </div>
                          <span className="font-medium text-emerald-400">BUY</span>
                        </div>
                        <motion.div
                          className="px-2 py-1 rounded bg-amber-500/10 text-xs text-amber-400 flex items-center gap-1"
                          animate={{ opacity: [0.7, 1, 0.7] }}
                          transition={{ duration: 2, repeat: Infinity }}
                        >
                          <motion.div
                            className="w-1.5 h-1.5 rounded-full bg-amber-400"
                            animate={{ scale: [1, 1.3, 1] }}
                            transition={{ duration: 1, repeat: Infinity }}
                          />
                          Searching...
                        </motion.div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <div className="text-gray-500 text-xs mb-1">Amount</div>
                          <div className="font-mono text-white">•.•••• ETH</div>
                        </div>
                        <div>
                          <div className="text-gray-500 text-xs mb-1">Limit Price</div>
                          <div className="font-mono text-white">••••.•• STRK</div>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-emerald-500/10 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <Lock className="w-3 h-3 text-cyan-400" />
                          <span className="font-mono text-cyan-400/70">encrypted</span>
                        </div>
                        <div className="text-[10px] text-gray-600">Pending commit</div>
                      </div>
                    </motion.div>

                    {/* Order 2 */}
                    <motion.div
                      className="p-4 rounded-xl bg-red-500/5 border border-red-500/20 relative overflow-hidden"
                      initial={{ opacity: 0, y: 10 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.1 }}
                    >
                      <motion.div
                        className="absolute top-0 left-0 h-full w-1 bg-gradient-to-b from-red-400 to-transparent"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 2, delay: 0.5, repeat: Infinity }}
                      />

                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded bg-red-500/20 flex items-center justify-center">
                            <TrendingDown className="w-3 h-3 text-red-400" />
                          </div>
                          <span className="font-medium text-red-400">SELL</span>
                        </div>
                        <motion.div
                          className="px-2 py-1 rounded bg-amber-500/10 text-xs text-amber-400 flex items-center gap-1"
                          animate={{ opacity: [0.7, 1, 0.7] }}
                          transition={{ duration: 2, delay: 0.5, repeat: Infinity }}
                        >
                          <motion.div
                            className="w-1.5 h-1.5 rounded-full bg-amber-400"
                            animate={{ scale: [1, 1.3, 1] }}
                            transition={{ duration: 1, delay: 0.5, repeat: Infinity }}
                          />
                          Searching...
                        </motion.div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <div className="text-gray-500 text-xs mb-1">Amount</div>
                          <div className="font-mono text-white">••.•• STRK</div>
                        </div>
                        <div>
                          <div className="text-gray-500 text-xs mb-1">Limit Price</div>
                          <div className="font-mono text-white">•.•••• ETH</div>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-red-500/10 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <Lock className="w-3 h-3 text-cyan-400" />
                          <span className="font-mono text-cyan-400/70">encrypted</span>
                        </div>
                        <div className="text-[10px] text-gray-600">Pending commit</div>
                      </div>
                    </motion.div>
                  </div>
                </div>

                {/* Your Fills */}
                <div className="p-6">
                  <div className="text-sm text-gray-400 mb-4 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    Your Recent Fills
                  </div>

                  <div className="space-y-2">
                    <motion.div
                      className="flex items-center justify-between p-3 rounded-lg bg-surface-card/50 border border-emerald-500/10"
                      initial={{ opacity: 0, x: 20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div>
                          <div className="text-sm text-white">Bought <span className="font-mono text-emerald-400">•.•• ETH</span></div>
                          <div className="text-xs text-gray-500">Encrypted fill</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-emerald-400 flex items-center gap-1 justify-end">
                          <Lock className="w-3 h-3" />
                          Private
                        </div>
                        <div className="text-[10px] text-gray-600 font-mono">tx: encrypted</div>
                      </div>
                    </motion.div>

                    <motion.div
                      className="flex items-center justify-between p-3 rounded-lg bg-surface-card/50 border border-red-500/10"
                      initial={{ opacity: 0, x: 20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.1 }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div>
                          <div className="text-sm text-white">Sold <span className="font-mono text-red-400">••.• STRK</span></div>
                          <div className="text-xs text-gray-500">Encrypted fill</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-emerald-400 flex items-center gap-1 justify-end">
                          <Lock className="w-3 h-3" />
                          Private
                        </div>
                        <div className="text-[10px] text-gray-600 font-mono">tx: encrypted</div>
                      </div>
                    </motion.div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Cryptographic Flow Visualization */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-16"
          >
            <div className="text-center mb-8">
              <h3 className="text-2xl font-bold text-white mb-2">How ZK Dark Pool Works</h3>
              <p className="text-gray-400">End-to-end encrypted trading with zero-knowledge proofs</p>
            </div>

            <div className="relative">
              {/* Connection lines */}
              <div className="hidden md:block absolute top-1/2 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent -translate-y-1/2 z-0" />

              <div className="grid md:grid-cols-4 gap-4 relative z-10">
                {[
                  {
                    step: "1",
                    icon: Lock,
                    title: "Encrypt Order",
                    desc: "Your price & amount are encrypted using ElGamal encryption on the STARK curve",
                    tech: "ElGamal Encryption",
                    color: "cyan"
                  },
                  {
                    step: "2",
                    icon: Shield,
                    title: "Generate Proof",
                    desc: "ZK proof validates your order without revealing the actual values",
                    tech: "STARK Proofs",
                    color: "emerald"
                  },
                  {
                    step: "3",
                    icon: Zap,
                    title: "Private Match",
                    desc: "Matching engine compares encrypted commitments to find valid matches",
                    tech: "Pedersen Commitments",
                    color: "amber"
                  },
                  {
                    step: "4",
                    icon: CheckCircle2,
                    title: "Atomic Settle",
                    desc: "Confidential swap executes atomically. Only you see your fill details",
                    tech: "Confidential Swap",
                    color: "emerald"
                  },
                ].map((item, i) => (
                  <motion.div
                    key={item.step}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                    className="relative"
                  >
                    <div className={`p-6 rounded-2xl bg-surface-card border border-surface-border hover:border-${item.color}-500/30 transition-all duration-300 h-full`}>
                      {/* Step number */}
                      <div className={`w-10 h-10 rounded-xl bg-${item.color}-500/10 border border-${item.color}-500/20 flex items-center justify-center mb-4`}>
                        <item.icon className={`w-5 h-5 text-${item.color}-400`} />
                      </div>

                      {/* Content */}
                      <div className={`text-xs font-medium text-${item.color}-400 mb-2`}>Step {item.step}</div>
                      <h4 className="text-lg font-semibold text-white mb-2">{item.title}</h4>
                      <p className="text-sm text-gray-500 mb-4">{item.desc}</p>

                      {/* Tech badge */}
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-elevated border border-surface-border text-xs text-gray-400">
                        <Cpu className="w-3 h-3" />
                        {item.tech}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Security Properties */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="p-8 rounded-2xl bg-gradient-to-br from-surface-card to-surface-card/50 border border-surface-border"
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <h3 className="text-xl font-bold text-white mb-2">Cryptographic Security Guarantees</h3>
                <p className="text-gray-400 text-sm">Mathematically proven privacy properties</p>
              </div>
              <div className="flex flex-wrap gap-3">
                {[
                  { label: "Order Privacy", icon: EyeOff },
                  { label: "No Front-Running", icon: Shield },
                  { label: "MEV Protected", icon: Lock },
                  { label: "On-chain Proofs", icon: Zap },
                ].map((item, i) => (
                  <div key={item.label} className="flex items-center gap-2 px-4 py-2 rounded-full bg-surface-elevated border border-surface-border">
                    <item.icon className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm text-gray-300">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 left-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6">
              <Shield className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-medium text-emerald-400">Privacy Suite</span>
            </div>

            <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">
              Complete Privacy Stack
            </h2>
            <p className="text-xl text-gray-400 max-w-3xl mx-auto">
              Every feature built on <span className="text-white font-medium">zero-knowledge cryptography</span>.
              Your data stays yours—mathematically guaranteed.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <Link href={feature.href}>
                  <div className="h-full rounded-2xl bg-surface-card border border-surface-border hover:border-white/20 transition-all duration-300 group cursor-pointer overflow-hidden relative">
                    {/* Gradient background on hover */}
                    <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

                    {/* Top gradient line */}
                    <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-${feature.accentColor}-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

                    <div className="relative p-8">
                      {/* Header with icon and status */}
                      <div className="flex items-start justify-between mb-6">
                        <motion.div
                          className={`w-14 h-14 rounded-xl bg-gradient-to-br ${feature.gradient} border border-white/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}
                          whileHover={{ rotate: [0, -5, 5, 0] }}
                          transition={{ duration: 0.5 }}
                        >
                          <feature.icon className={`w-7 h-7 text-${feature.accentColor}-400`} />
                        </motion.div>

                        {feature.status === "live" ? (
                          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-xs font-medium text-emerald-400">Live</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                            <Sparkles className="w-3 h-3 text-amber-400" />
                            <span className="text-xs font-medium text-amber-400">Coming Soon</span>
                          </div>
                        )}
                      </div>

                      {/* Title */}
                      <h3 className="text-xl font-bold text-white mb-3 group-hover:text-emerald-400 transition-colors flex items-center gap-2">
                        {feature.title}
                        <ChevronRight className="w-5 h-5 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                      </h3>

                      {/* Description */}
                      <p className="text-gray-400 leading-relaxed mb-6 text-sm">
                        {feature.description}
                      </p>

                      {/* Benefits */}
                      <ul className="space-y-3 mb-6">
                        {feature.benefits.map((benefit, i) => (
                          <motion.li
                            key={i}
                            initial={{ opacity: 0, x: -10 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: index * 0.1 + i * 0.05 }}
                            className="flex items-center gap-3 text-gray-300 text-sm"
                          >
                            <div className={`w-5 h-5 rounded-full bg-${feature.accentColor}-500/20 flex items-center justify-center flex-shrink-0`}>
                              <CheckCircle2 className={`w-3 h-3 text-${feature.accentColor}-400`} />
                            </div>
                            {benefit}
                          </motion.li>
                        ))}
                      </ul>

                      {/* Tech badge */}
                      <div className="flex items-center justify-between pt-4 border-t border-surface-border/50">
                        <div className="flex items-center gap-2">
                          <Cpu className="w-4 h-4 text-gray-600" />
                          <span className="text-xs text-gray-500 font-mono">{feature.tech}</span>
                        </div>
                        <div className={`text-xs text-${feature.accentColor}-400 font-medium group-hover:underline`}>
                          Learn more →
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>

          {/* Bottom tech showcase */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-16 p-6 rounded-2xl bg-surface-card/50 border border-surface-border"
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <h4 className="text-lg font-semibold text-white mb-1">Powered by Cutting-Edge Cryptography</h4>
                <p className="text-sm text-gray-500">All privacy features are built on battle-tested cryptographic primitives</p>
              </div>
              <div className="flex flex-wrap gap-3">
                {[
                  { name: "STARK Proofs", icon: Shield },
                  { name: "ElGamal", icon: Lock },
                  { name: "Pedersen", icon: Layers },
                  { name: "Stark Curve", icon: Zap },
                ].map((tech) => (
                  <div
                    key={tech.name}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-elevated border border-surface-border hover:border-cyan-500/30 transition-colors"
                  >
                    <tech.icon className="w-4 h-4 text-cyan-400" />
                    <span className="text-sm text-gray-300 font-mono">{tech.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-surface-card/30 border-t border-surface-border/50 relative">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">Testnet Live</span>
            </div>

            <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">
              Ready to Trade Privately?
            </h2>
            <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
              Start using Obelysk Protocol today and take control of your financial privacy on Starknet.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/wallet">
                <button className="px-8 py-4 bg-white hover:bg-gray-100 text-gray-900 font-semibold rounded-xl transition-all flex items-center justify-center gap-2 w-full sm:w-auto">
                  Launch Obelysk
                  <ArrowRight className="w-5 h-5" />
                </button>
              </Link>
              <a href="https://docs.bitsage.network/obelysk" target="_blank" rel="noopener noreferrer">
                <button className="px-8 py-4 bg-transparent hover:bg-white/5 border border-white/20 hover:border-white/30 text-white font-medium rounded-xl transition-all w-full sm:w-auto flex items-center justify-center gap-2">
                  Documentation
                  <ExternalLink className="w-4 h-4" />
                </button>
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-surface-border bg-surface-dark">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Image
                src="/obelysk-logo.svg"
                alt="Obelysk"
                width={28}
                height={28}
                className="rounded-md"
              />
              <span className="text-sm text-gray-500">
                Obelysk Protocol
              </span>
              <span className="text-gray-700">·</span>
              <a href="https://bitsage.network" target="_blank" rel="noopener noreferrer" className="text-sm text-gray-500 hover:text-white transition-colors flex items-center gap-1">
                BitSage Ecosystem
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-500">
              <a href="https://github.com/bitsage-network" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
                GitHub
              </a>
              <a href="https://docs.bitsage.network" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
                Docs
              </a>
              <a href="https://discord.gg/bitsage" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
                Discord
              </a>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span className="hidden sm:inline">Beta</span>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
