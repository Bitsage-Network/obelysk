"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Layers,
  EyeOff,
  Bitcoin,
  Shield,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

const vaultTabs = [
  {
    title: "Privacy Pool",
    href: "/vault/privacy-pool",
    icon: Layers,
    color: "teal",
    description: "Deposit & withdraw with ZK proofs",
  },
  {
    title: "Stealth",
    href: "/vault/stealth",
    icon: EyeOff,
    color: "indigo",
    description: "One-time stealth addresses",
  },
  {
    title: "BTC Vault",
    href: "/vault/btc-vault",
    icon: Bitcoin,
    color: "orange",
    description: "Shield Bitcoin in VM31 notes",
  },
] as const;

export default function VaultLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const activeIndex = vaultTabs.findIndex(
    (tab) => pathname === tab.href || pathname.startsWith(tab.href + "/")
  );

  return (
    <div className="space-y-6">
      {/* Vault Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/20 flex items-center justify-center">
            <Shield className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              Privacy Vault
            </h1>
            <p className="text-xs text-gray-500">
              Shield, receive, and manage private assets
            </p>
          </div>
        </div>
        <Link
          href="/home"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Portfolio
        </Link>
      </div>

      {/* Sub-Tab Navigation */}
      <div className="relative">
        <div className="flex gap-1 p-1 rounded-xl bg-surface-card/60 border border-surface-border backdrop-blur-sm">
          {vaultTabs.map((tab, index) => {
            const isActive = index === activeIndex;

            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "relative flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                  isActive
                    ? "text-white"
                    : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]"
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="vault-tab-bg"
                    className="absolute inset-0 rounded-lg bg-white/[0.08] border border-white/[0.08]"
                    transition={{
                      type: "spring",
                      stiffness: 400,
                      damping: 30,
                    }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  <tab.icon
                    className={cn(
                      "w-4 h-4 transition-colors",
                      isActive ? `text-${tab.color}-400` : ""
                    )}
                  />
                  <span className="hidden sm:inline">{tab.title}</span>
                  <span className="sm:hidden">{tab.title.split(" ")[0]}</span>
                </span>
              </Link>
            );
          })}
        </div>

        {/* Active tab description */}
        {activeIndex >= 0 && (
          <motion.p
            key={activeIndex}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs text-gray-600 mt-2 text-center"
          >
            {vaultTabs[activeIndex].description}
          </motion.p>
        )}
      </div>

      {/* Page Content */}
      {children}
    </div>
  );
}
