"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { type ReactNode, useMemo } from "react";

import "@solana/wallet-adapter-react-ui/styles.css";

// Mounts the Solana wallet adapter for the whole /v2 tree. Phantom + Solflare are
// listed explicitly; other Wallet-Standard wallets (Backpack, etc.) are auto-detected.
// The endpoint is only needed to satisfy the provider — sign-in uses signMessage, not
// an on-chain call.
export function V2WalletProvider({ children }: { children: ReactNode }) {
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
