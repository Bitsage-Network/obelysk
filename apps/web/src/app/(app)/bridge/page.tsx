"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { BridgeTab } from "@/components/bridge";

export default function BridgePage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-gray-500 animate-spin" /></div>}>
      <BridgePageInner />
    </Suspense>
  );
}

function BridgePageInner() {
  const searchParams = useSearchParams();
  const initialToken = searchParams.get("token") || undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
          <ArrowLeftRight className="w-6 h-6 text-brand-400" />
          Bridge
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Cross-chain asset bridging
        </p>
      </div>
      <BridgeTab initialToken={initialToken} />
    </div>
  );
}
