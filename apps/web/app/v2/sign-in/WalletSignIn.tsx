"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { performSignIn } from "../../../lib/v2/signin-flow";
import { ui } from "../../theme";

const MESSAGES: Record<string, string> = {
  non_deterministic:
    "This wallet produces non-deterministic signatures and can't be used with MonkeMask v2. Please use Phantom, Solflare, or Backpack.",
  not_allowlisted:
    "Your wallet is not on the MonkeMask v2 allowlist. Contact the operator to be added.",
  error: "Couldn't sign you in. Please try again.",
};

export function WalletSignIn() {
  const { publicKey, signMessage, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSignIn() {
    setError(null);
    if (!connected || !publicKey || !signMessage) {
      setVisible(true); // open the wallet-adapter modal to connect first
      return;
    }
    setBusy(true);
    try {
      const out = await performSignIn({ pubkey: publicKey.toBase58(), signMessage });
      if (out.ok) router.push("/v2/dashboard");
      else setError(MESSAGES[out.reason]);
    } catch {
      setError(MESSAGES.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      <button
        onClick={onSignIn}
        disabled={busy}
        style={{
          padding: "13px 26px",
          borderRadius: 12,
          fontWeight: 700,
          border: "none",
          cursor: busy ? "default" : "pointer",
          background: ui.accent,
          color: ui.accentText,
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? "Signing in…" : connected ? "Sign in" : "Connect wallet"}
      </button>
      {error && (
        <p style={{ marginTop: 14, color: "#ff6b6b", maxWidth: 480 }}>{error}</p>
      )}
    </div>
  );
}
