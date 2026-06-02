import { ui } from "../../theme";

// Wallet-connect shell. The Solana wallet adapter + SIWS sign-in flow is wired in
// Task 5; this is the static page it mounts into.
export default function SignIn() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 20px", color: ui.ivory }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Sign in</h1>
      <p style={{ color: ui.textDim, marginTop: 8 }}>
        Connect your <strong>allowlisted</strong> Solana wallet to continue. Only
        approved Local Ambassador wallets can access the platform.
      </p>
      {/* Task 5: <WalletConnectButton /> mounts here. */}
    </main>
  );
}
