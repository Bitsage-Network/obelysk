import { StarknetProvider } from "@/lib/starknet/provider";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <StarknetProvider>{children}</StarknetProvider>;
}
