"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useAccount, useDisconnect } from "@starknet-react/core";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wallet,
  LogOut,
  ChevronDown,
  Copy,
  ExternalLink,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function ConnectWalletButton() {
  const { address, status } = useAccount();
  const { disconnect } = useDisconnect();
  const [showMenu, setShowMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isConnected = status === "connected";

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setShowMenu(false);
  };

  if (!isConnected) {
    return (
      <Link
        href="/connect"
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white hover:bg-gray-100 text-gray-900 text-sm font-medium transition-colors"
      >
        <Wallet className="w-4 h-4" />
        <span className="hidden sm:inline">Connect Wallet</span>
        <span className="sm:hidden">Connect</span>
      </Link>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg transition-all border",
          showMenu
            ? "bg-surface-elevated border-surface-border"
            : "bg-surface-card border-surface-border hover:border-white/20"
        )}
      >
        {/* Avatar */}
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
          <span className="text-[10px] font-bold text-white">
            {address ? address.slice(2, 4).toUpperCase() : "??"}
          </span>
        </div>

        {/* Address */}
        <span className="text-sm font-medium text-white hidden sm:block">
          {address ? formatAddress(address) : "Connected"}
        </span>

        <ChevronDown
          className={cn(
            "w-4 h-4 text-gray-400 transition-transform",
            showMenu && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {showMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-64 bg-surface-card border border-surface-border rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50"
          >
            {/* Header */}
            <div className="p-4 border-b border-surface-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
                  <span className="text-sm font-bold text-white">
                    {address ? address.slice(2, 4).toUpperCase() : "??"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {address ? formatAddress(address) : "Connected"}
                  </p>
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="text-xs text-emerald-400">Connected</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="p-2">
              <button
                onClick={copyAddress}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-elevated transition-colors text-gray-300 hover:text-white w-full"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                <span className="text-sm">{copied ? "Copied!" : "Copy Address"}</span>
              </button>

              <a
                href={`https://sepolia.voyager.online/contract/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-elevated transition-colors text-gray-300 hover:text-white w-full"
              >
                <ExternalLink className="w-4 h-4" />
                <span className="text-sm">View on Explorer</span>
              </a>
            </div>

            {/* Disconnect */}
            <div className="p-2 border-t border-surface-border">
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg w-full transition-colors text-red-400 hover:bg-red-500/10"
              >
                <LogOut className="w-4 h-4" />
                <span className="text-sm">Disconnect</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
