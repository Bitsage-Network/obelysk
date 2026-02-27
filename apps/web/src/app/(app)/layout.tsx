"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Shield,
  TrendingUp,
  Send,
  MoreHorizontal,
  Landmark,
  ArrowUpDown,
  ExternalLink,
  X,
  FlaskConical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";

// Primary nav: Portfolio, Vault, Trade, Send, More
const primaryNav = [
  { title: "Portfolio", href: "/home", icon: LayoutDashboard },
  { title: "Vault", href: "/vault", icon: Shield },
  { title: "Trade", href: "/trade", icon: TrendingUp },
  { title: "Send", href: "/send", icon: Send },
] as const;

// "More" menu items
const moreItems = [
  { title: "Stake", href: "/stake", icon: Landmark },
  { title: "Bridge", href: "/bridge", icon: ArrowUpDown },
  {
    title: "Validator",
    href: "https://validator.bitsage.network",
    icon: ExternalLink,
    external: true,
  },
] as const;

function MoreMenu({
  isOpen,
  onClose,
  pathname,
}: {
  isOpen: boolean;
  onClose: () => void;
  pathname: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (!ref.current || ref.current.offsetParent === null) return;
      if (!ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div ref={ref} className="absolute right-0 bottom-full mb-2 md:bottom-auto md:top-full md:mt-2 w-52 bg-surface-card border border-surface-border rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50">
      <div className="p-1.5">
        {moreItems.map((item) => {
          const isExternal = "external" in item && item.external;
          const isActive = !isExternal && pathname.startsWith(item.href);

          if (isExternal) {
            return (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                <item.icon className="w-4 h-4" />
                {item.title}
                <ExternalLink className="w-3 h-3 ml-auto opacity-50" />
              </a>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                isActive
                  ? "text-white bg-white/10"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              )}
            >
              <item.icon className="w-4 h-4" />
              {item.title}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function BetaBanner() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem("obelyzk-beta-dismissed") === "true");
  }, []);

  if (dismissed) return null;

  return (
    <div className="relative bg-gradient-to-r from-blue-600/90 via-indigo-600/90 to-violet-600/90 text-white text-center text-sm py-2 px-4 z-[60]">
      <div className="flex items-center justify-center gap-2">
        <FlaskConical className="w-3.5 h-3.5 shrink-0" />
        <span>
          <strong>Beta</strong> — Obelyzk Protocol is under active development. Building in public.{" "}
          <a
            href="https://x.com/Obelyzk"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-white/80 transition-colors"
          >
            Follow updates
          </a>
        </span>
      </div>
      <button
        onClick={() => {
          setDismissed(true);
          localStorage.setItem("obelyzk-beta-dismissed", "true");
        }}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/10 transition-colors"
        aria-label="Dismiss beta banner"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isMoreActive = moreItems.some(
    (item) => !("external" in item && item.external) && pathname.startsWith(item.href)
  );

  // Check active state for nav items — match on prefix for sections with sub-routes
  const isNavActive = (href: string) => {
    if (href === "/home") return pathname === "/home";
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-surface-dark">
      {/* Beta Announcement */}
      <BetaBanner />

      {/* Desktop Header */}
      <header className="border-b border-surface-border/60 sticky top-0 bg-surface-dark/95 backdrop-blur-xl z-50 hidden lg:block">
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
                <div>
                  <span className="font-semibold text-white text-lg leading-none">Obelysk</span>
                  <span className="text-[11px] text-emerald-400 font-medium uppercase tracking-wider block">Protocol</span>
                </div>
              </Link>

              {/* Desktop Navigation */}
              <nav className="flex items-center gap-1">
                {primaryNav.map((item) => {
                  const isActive = isNavActive(item.href);

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

                {/* More Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setMoreOpen(!moreOpen)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                      isMoreActive || moreOpen
                        ? "bg-white/10 text-white border border-white/10"
                        : "text-gray-400 hover:text-white hover:bg-white/5"
                    )}
                  >
                    <MoreHorizontal className="w-4 h-4" />
                    More
                  </button>
                  <MoreMenu isOpen={moreOpen} onClose={() => setMoreOpen(false)} pathname={pathname} />
                </div>
              </nav>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs text-emerald-400 font-medium">Privacy Mode</span>
              </div>
              <ConnectWalletButton />
            </div>
          </div>
        </div>
      </header>

      {/* Mobile / Tablet Header */}
      <header className="lg:hidden border-b border-surface-border/60 sticky top-0 bg-surface-dark/95 backdrop-blur-xl z-50">
        <div className="px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/obelysk-logo.svg"
              alt="Obelysk"
              width={32}
              height={32}
              className="rounded-lg"
            />
            <div>
              <span className="font-semibold text-white text-base leading-none block">Obelysk</span>
              <span className="text-[9px] text-emerald-400 font-medium uppercase tracking-wider">Protocol</span>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Shield className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] text-emerald-400 font-medium">Privacy</span>
            </div>
            <ConnectWalletButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 lg:pb-6">
        {children}
      </main>

      {/* Mobile / Tablet Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface-dark/95 backdrop-blur-xl border-t border-surface-border">
        <div className="flex items-center justify-around px-1 sm:px-4 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          {primaryNav.map((item) => {
            const isActive = isNavActive(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-2 sm:px-4 py-1.5 rounded-xl text-[10px] sm:text-[11px] font-medium transition-all min-w-0",
                  isActive
                    ? "text-white"
                    : "text-gray-500 active:text-gray-300"
                )}
              >
                <div className={cn(
                  "w-8 h-8 rounded-xl flex items-center justify-center transition-colors",
                  isActive ? "bg-white/10" : ""
                )}>
                  <item.icon className="w-5 h-5" />
                </div>
                <span className="truncate max-w-[60px]">{item.title}</span>
              </Link>
            );
          })}

          {/* More Button */}
          <div className="relative">
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              className={cn(
                "flex flex-col items-center gap-0.5 px-2 sm:px-4 py-1.5 rounded-xl text-[10px] sm:text-[11px] font-medium transition-all min-w-0",
                isMoreActive || moreOpen
                  ? "text-white"
                  : "text-gray-500 active:text-gray-300"
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-xl flex items-center justify-center transition-colors",
                isMoreActive || moreOpen ? "bg-white/10" : ""
              )}>
                <MoreHorizontal className="w-5 h-5" />
              </div>
              More
            </button>
            <MoreMenu isOpen={moreOpen} onClose={() => setMoreOpen(false)} pathname={pathname} />
          </div>
        </div>
      </nav>
    </div>
  );
}
