"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Wallet,
  ArrowUpDown,
  Landmark,
  Send,
  ExternalLink,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";

const navItems = [
  {
    title: "Wallet",
    href: "/wallet",
    icon: Wallet,
    description: "Privacy wallet",
  },
  {
    title: "Trade",
    href: "/trade",
    icon: ArrowUpDown,
    description: "Dark pool",
  },
  {
    title: "Stake",
    href: "/stake",
    icon: Landmark,
    description: "Earn rewards",
  },
  {
    title: "Send",
    href: "/send",
    icon: Send,
    description: "Private transfer",
  },
  {
    title: "Validator",
    href: "https://validator.bitsage.network",
    icon: ExternalLink,
    description: "Run a validator",
    external: true,
  },
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-surface-dark">
      {/* Header */}
      <header className="border-b border-surface-border/60 sticky top-0 bg-surface-dark/95 backdrop-blur-xl z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              {/* Logo */}
              <Link href="/" className="flex items-center gap-3 group">
                <Image
                  src="/obelysk-logo.svg"
                  alt="Obelysk"
                  width={36}
                  height={36}
                  className="rounded-lg"
                />
                <div className="hidden xs:block">
                  <span className="font-semibold text-white text-lg leading-none">Obelysk</span>
                  <span className="text-[11px] text-emerald-400 font-medium uppercase tracking-wider block">Protocol</span>
                </div>
              </Link>

              {/* Navigation */}
              <nav className="hidden md:flex items-center gap-1">
                {navItems.map((item) => {
                  const isExternal = "external" in item && item.external;
                  const isActive = !isExternal && pathname.startsWith(item.href);

                  if (isExternal) {
                    return (
                      <a
                        key={item.href}
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all text-gray-400 hover:text-white hover:bg-white/5"
                      >
                        {item.title}
                        <item.icon className="w-3.5 h-3.5" />
                      </a>
                    );
                  }

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                        isActive
                          ? "bg-white/10 text-white border border-white/10"
                          : "text-gray-400 hover:text-white hover:bg-white/5"
                      )}
                    >
                      <item.icon className="w-4 h-4" />
                      {item.title}
                    </Link>
                  );
                })}
              </nav>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-3">
              {/* Privacy Mode Badge */}
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs text-emerald-400 font-medium">Privacy Mode</span>
              </div>

              {/* Wallet Connect Button */}
              <ConnectWalletButton />
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        <div className="md:hidden border-t border-surface-border/60">
          <nav className="flex items-center justify-around px-2 py-2">
            {navItems.map((item) => {
              const isExternal = "external" in item && item.external;
              const isActive = !isExternal && pathname.startsWith(item.href);

              if (isExternal) {
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-xs transition-all text-gray-500 hover:text-gray-300"
                  >
                    <item.icon className="w-5 h-5" />
                    {item.title}
                  </a>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-xs transition-all",
                    isActive
                      ? "text-white bg-white/10"
                      : "text-gray-500 hover:text-gray-300"
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  {item.title}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  );
}
