"use client";

import { useConnect, useAccount, Connector } from "@starknet-react/core";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import {
  Wallet,
  ArrowRight,
  Loader2,
  Play,
  Check,
  AlertCircle,
  X,
  Shield,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { LogoIcon } from "@/components/ui/Logo";

export default function ConnectPage() {
  const { connectAsync, connectors, isPending, error: connectError, reset } = useConnect();
  const { address, isConnected } = useAccount();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [connectingConnectorId, setConnectingConnectorId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Set mounted after hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  // Redirect to wallet page when connected
  useEffect(() => {
    if (isConnected && address && mounted) {
      router.push("/wallet");
    }
  }, [isConnected, address, router, mounted]);

  const handleConnect = async (connector: Connector) => {
    try {
      setConnectingConnectorId(connector.id);
      setLocalError(null);
      console.log("Connecting to:", connector.id, connector.name);

      // Set a timeout to auto-cancel stuck connections
      timeoutRef.current = setTimeout(() => {
        console.log("Connection timeout - resetting");
        setLocalError("Connection timed out. Please try again or check your wallet.");
        setConnectingConnectorId(null);
        reset();
      }, 30000); // 30 second timeout

      await connectAsync({ connector });

      // Clear timeout on success
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      console.log("Connection successful");
      // Small delay to ensure wallet state is updated
      setTimeout(() => {
        setConnectingConnectorId(null);
        router.push("/wallet");
      }, 500);
    } catch (error) {
      // Clear timeout on error
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      console.error("Connection failed:", error);
      setLocalError(error instanceof Error ? error.message : "Connection failed");
      setConnectingConnectorId(null);
    }
  };

  const handleCancelConnect = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setConnectingConnectorId(null);
    setLocalError(null);
    reset();
  };

  const handleDemoMode = () => {
    localStorage.setItem("obelysk_demo_mode", "true");
    router.push("/wallet");
  };

  const displayError = localError || (connectError?.message);

  return (
    <div className="min-h-screen bg-surface-dark flex items-center justify-center p-4">
      {/* Background gradient effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-64 h-64 sm:w-96 sm:h-96 bg-violet-500/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-64 h-64 sm:w-96 sm:h-96 bg-fuchsia-500/20 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-lg"
      >
        {/* Logo & Title */}
        <div className="text-center mb-6 sm:mb-8">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="inline-flex items-center justify-center mb-3 sm:mb-4"
          >
            <LogoIcon className="text-violet-400" size={72} />
          </motion.div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">
            Welcome to <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">Obelysk</span>
          </h1>
          <p className="text-sm sm:text-base text-gray-400 px-4">
            Connect your wallet to access private DeFi on Starknet
          </p>
        </div>

        {/* Connect Card */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4 flex items-center gap-2">
            <Wallet className="w-4 h-4 sm:w-5 sm:h-5 text-violet-400" />
            Connect Wallet
          </h2>

          {/* Connection Error */}
          {displayError && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-300">{displayError}</p>
            </div>
          )}

          {/* Already Connected */}
          {isConnected && address && (
            <div className="mb-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <Check className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-400">Wallet Connected</span>
              </div>
              <p className="text-xs text-gray-400 font-mono truncate">{address}</p>
              <motion.button
                onClick={() => router.push("/wallet")}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="mt-3 w-full py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-medium flex items-center justify-center gap-2"
              >
                Continue to Dashboard
                <ArrowRight className="w-4 h-4" />
              </motion.button>
            </div>
          )}

          {/* Wallet Connectors */}
          <div className="space-y-3">
            {!mounted && (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="w-full flex items-center justify-between p-3 sm:p-4 bg-surface-elevated border border-surface-border rounded-xl animate-pulse">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-surface-card" />
                      <div>
                        <div className="h-4 w-24 bg-surface-card rounded" />
                        <div className="h-3 w-16 bg-surface-card rounded mt-1" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {mounted && connectors.map((connector) => {
              const isThisConnecting = connectingConnectorId === connector.id;
              const isAnyConnecting = connectingConnectorId !== null;
              const isAvailable = connector.available;

              return (
                <motion.button
                  key={connector.id}
                  onClick={() => {
                    if (!isAvailable) {
                      // Open wallet download page
                      const urls: Record<string, string> = {
                        argentX: "https://www.argent.xyz/argent-x/",
                        braavos: "https://braavos.app/",
                      };
                      const url = urls[connector.id];
                      if (url) window.open(url, "_blank");
                      return;
                    }
                    handleConnect(connector);
                  }}
                  disabled={isPending || isAnyConnecting}
                  whileHover={{ scale: isAnyConnecting ? 1 : 1.02 }}
                  whileTap={{ scale: isAnyConnecting ? 1 : 0.98 }}
                  className={cn(
                    "w-full flex items-center justify-between p-3 sm:p-4 bg-surface-elevated",
                    "border rounded-xl transition-all duration-200 group",
                    isThisConnecting
                      ? "border-violet-500/50 bg-violet-500/5"
                      : "border-surface-border hover:border-violet-500/50",
                    (isPending || isAnyConnecting) && !isThisConnecting && "opacity-50 cursor-not-allowed",
                    !isAvailable && "opacity-70"
                  )}
                >
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-surface-card flex items-center justify-center">
                      {connector.icon ? (
                        <img
                          src={typeof connector.icon === 'string' ? connector.icon : connector.icon.dark}
                          alt={connector.name}
                          className="w-6 h-6"
                        />
                      ) : (
                        <Wallet className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400" />
                      )}
                    </div>
                    <div className="text-left flex-1">
                      <p className="text-sm sm:text-base font-medium text-white">{connector.name}</p>
                      <p className="text-xs sm:text-sm text-gray-500">
                        {isThisConnecting
                          ? "Check your wallet extension..."
                          : !isAvailable
                          ? "Click to install"
                          : connector.id === "argentX"
                          ? "Most Popular"
                          : "Secure Wallet"}
                      </p>
                    </div>
                    {isThisConnecting && (
                      <Loader2 className="w-4 h-4 text-violet-400 animate-spin mr-2" />
                    )}
                  </div>
                  {isThisConnecting ? (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancelConnect();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation();
                          handleCancelConnect();
                        }
                      }}
                      className="p-1 hover:bg-red-500/20 rounded-lg transition-colors cursor-pointer"
                      title="Cancel connection"
                    >
                      <X className="w-4 h-4 sm:w-5 sm:h-5 text-red-400" />
                    </div>
                  ) : (
                    <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 text-gray-500 group-hover:text-violet-400 transition-colors" />
                  )}
                </motion.button>
              );
            })}

            {mounted && connectors.length === 0 && (
              <div className="text-center py-8">
                <Wallet className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400 mb-2">No wallets detected</p>
                <p className="text-sm text-gray-500">
                  Install{" "}
                  <a
                    href="https://www.argent.xyz/argent-x/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-400 hover:underline"
                  >
                    ArgentX
                  </a>{" "}
                  or{" "}
                  <a
                    href="https://braavos.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-400 hover:underline"
                  >
                    Braavos
                  </a>{" "}
                  to continue
                </p>
              </div>
            )}

            {/* Demo Mode Divider */}
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-surface-border"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-surface-card text-gray-500">or</span>
              </div>
            </div>

            {/* Demo Mode Button */}
            <motion.button
              onClick={handleDemoMode}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-2 p-4
                       bg-gradient-to-r from-violet-600/20 to-fuchsia-600/20
                       border border-violet-500/30 rounded-xl
                       hover:border-violet-500/50 transition-all duration-200"
            >
              <Play className="w-5 h-5 text-violet-400" />
              <span className="text-white font-medium">Try Demo Mode</span>
            </motion.button>
            <p className="text-xs text-gray-500 text-center mt-2">
              Preview the app with mock data
            </p>
          </div>
        </div>

        {/* Features */}
        <div className="mt-6 sm:mt-8 grid grid-cols-3 gap-3 sm:gap-4">
          <div className="bg-surface-card/50 border border-surface-border rounded-xl p-3 sm:p-4 text-center">
            <Shield className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-400 mx-auto mb-1.5 sm:mb-2" />
            <p className="text-xs sm:text-sm text-gray-400">ZK Privacy</p>
          </div>
          <div className="bg-surface-card/50 border border-surface-border rounded-xl p-3 sm:p-4 text-center">
            <Wallet className="w-5 h-5 sm:w-6 sm:h-6 text-violet-400 mx-auto mb-1.5 sm:mb-2" />
            <p className="text-xs sm:text-sm text-gray-400">Private DeFi</p>
          </div>
          <div className="bg-surface-card/50 border border-surface-border rounded-xl p-3 sm:p-4 text-center">
            <ArrowRight className="w-5 h-5 sm:w-6 sm:h-6 text-fuchsia-400 mx-auto mb-1.5 sm:mb-2" />
            <p className="text-xs sm:text-sm text-gray-400">Gasless TX</p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs sm:text-sm text-gray-500 mt-6 sm:mt-8 px-4">
          By connecting, you agree to our{" "}
          <a href="#" className="text-violet-400 hover:underline">Terms of Service</a>
        </p>
      </motion.div>
    </div>
  );
}
