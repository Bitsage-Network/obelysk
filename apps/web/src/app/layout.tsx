import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { StarknetProvider } from "@/lib/starknet/provider";
import { QueryProvider } from "@/lib/providers/QueryProvider";
import { ToastProvider } from "@/lib/providers/ToastProvider";

const network = (process.env.NEXT_PUBLIC_STARKNET_NETWORK || "sepolia") as "devnet" | "sepolia" | "mainnet";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "Obelysk Protocol - Privacy-First DeFi on Starknet",
  description: "The privacy and financial layer for the BitSage ecosystem. Private wallet, dark pool trading, and stealth addresses powered by ElGamal encryption and ZK proofs.",
  keywords: ["privacy", "wallet", "DeFi", "trading", "dark pool", "ElGamal", "ZK proofs", "Starknet", "SAGE", "BitSage", "Obelysk"],
  icons: {
    icon: "/favicon.svg",
    apple: "/obelysk-logo.svg",
  },
  openGraph: {
    title: "Obelysk Protocol - Privacy-First DeFi",
    description: "Trade Bitcoin and crypto assets with complete privacy. Dark pool orderbook, encrypted transactions, and zero-knowledge proofs.",
    siteName: "Obelysk Protocol",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Obelysk Protocol - Privacy-First DeFi",
    description: "Trade Bitcoin and crypto assets with complete privacy on Starknet.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}>
        <QueryProvider>
          <StarknetProvider network={network}>
            <ToastProvider>
              {children}
            </ToastProvider>
          </StarknetProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
