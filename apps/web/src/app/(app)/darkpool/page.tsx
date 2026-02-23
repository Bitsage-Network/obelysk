"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Shield, Loader2 } from "lucide-react";
import { PrivateAuction } from "@/components/darkpool";

export default function DarkPoolPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-gray-500 animate-spin" /></div>}>
      <DarkPoolPageInner />
    </Suspense>
  );
}

function DarkPoolPageInner() {
  const searchParams = useSearchParams();
  const initialPair = searchParams.get("pair") || undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
          <Shield className="w-6 h-6 text-cyan-400" />
          Dark Pool
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Encrypted batch auction — zero front-running, zero MEV
        </p>
      </div>
      <PrivateAuction initialPair={initialPair} />
    </div>
  );
}
