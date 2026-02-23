"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Shield, Loader2, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { PrivateAuction } from "@/components/darkpool";

const stagger = {
  container: { animate: { transition: { staggerChildren: 0.06 } } },
  item: {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } },
  },
};

export default function DarkPoolPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 text-gray-500 animate-spin" />
        </div>
      }
    >
      <DarkPoolPageInner />
    </Suspense>
  );
}

function DarkPoolPageInner() {
  const searchParams = useSearchParams();
  const initialPair = searchParams.get("pair") || undefined;

  return (
    <div className="relative min-h-screen pb-24 lg:pb-6">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute top-0 right-1/4 w-[500px] h-[280px] bg-cyan-500/[0.03] rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 left-1/3 w-[400px] h-[250px] bg-violet-500/[0.025] rounded-full blur-[100px]" />
      </div>

      <motion.div
        variants={stagger.container}
        initial="initial"
        animate="animate"
        className="relative space-y-5"
      >
        {/* Header */}
        <motion.div variants={stagger.item} className="flex items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 bg-cyan-500/20 rounded-2xl blur-xl" />
            <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
              Dark Pool
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-[10px] text-cyan-400 font-semibold uppercase tracking-wider">
                <Zap className="w-2.5 h-2.5" /> Zero MEV
              </span>
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Encrypted batch auction — zero front-running, uniform clearing price
            </p>
          </div>
        </motion.div>

        {/* Main content */}
        <motion.div variants={stagger.item}>
          <PrivateAuction initialPair={initialPair} />
        </motion.div>
      </motion.div>
    </div>
  );
}
