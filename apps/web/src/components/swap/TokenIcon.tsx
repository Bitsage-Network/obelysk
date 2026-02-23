import { cn } from "@/lib/utils";

export const TOKEN_COLORS: Record<string, { from: string; to: string; text: string }> = {
  ETH: { from: "from-blue-500/30", to: "to-indigo-600/20", text: "text-blue-300" },
  STRK: { from: "from-orange-500/30", to: "to-amber-600/20", text: "text-orange-300" },
  SAGE: { from: "from-violet-500/30", to: "to-fuchsia-600/20", text: "text-violet-300" },
  USDC: { from: "from-sky-500/30", to: "to-blue-600/20", text: "text-sky-300" },
  wBTC: { from: "from-amber-500/30", to: "to-orange-600/20", text: "text-amber-300" },
};

const TOKEN_LOGOS: Record<string, string> = {
  ETH: "/tokens/eth.svg",
  STRK: "/tokens/strk.svg",
  SAGE: "/tokens/sage.svg",
  USDC: "/tokens/usdc.svg",
  wBTC: "/tokens/btc.svg",
};

export function TokenIcon({ symbol, size = "md" }: { symbol: string; size?: "sm" | "md" | "lg" }) {
  const colors = TOKEN_COLORS[symbol] || TOKEN_COLORS.ETH;
  const logo = TOKEN_LOGOS[symbol];
  const dims = size === "sm" ? "w-6 h-6" : size === "lg" ? "w-10 h-10" : "w-8 h-8";
  const textDims = size === "sm" ? "w-6 h-6 text-[10px]" : size === "lg" ? "w-10 h-10 text-sm" : "w-8 h-8 text-xs";

  if (logo) {
    return (
      <img
        src={logo}
        alt={symbol}
        className={cn(dims, "rounded-full shrink-0")}
      />
    );
  }

  return (
    <div className={cn(
      textDims,
      "rounded-full bg-gradient-to-br border border-white/10 flex items-center justify-center font-bold shrink-0",
      colors.from, colors.to, colors.text
    )}>
      {symbol.charAt(0)}
    </div>
  );
}
