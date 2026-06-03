"use client";

import { useRouter } from "next/navigation";

import { chapterLabel } from "../../../lib/v2/chapters";
import { useVault } from "../../../lib/v2/useVault";
import { MonkeAnonymizer, type RosterIntegration } from "../../MonkeAnonymizer";
import { ui } from "../../theme";
import { AdminPanel } from "./AdminPanel";
import { RosterBar } from "./RosterBar";

// The ambassador dashboard = the full MonkeMask anonymizer, signed-in, with a header
// showing the session + a sign-out. Phase 2 layers persistence (save roster, library
// from holdings, auto-match known faces) on top of this same tool.
export function DashboardClient({
  wallet,
  role,
  country,
}: {
  wallet: string;
  role: string;
  country: string | null;
}) {
  const router = useRouter();
  // One vault instance, shared: RosterBar drives unlock + shows the count, while the
  // anonymizer reads it for auto-match/auto-save. Hook is called unconditionally;
  // it's only wired in for ambassadors.
  const vault = useVault();
  const roster: RosterIntegration | undefined =
    role === "ambassador"
      ? { active: !vault.locked, match: vault.match, save: vault.saveEntry }
      : undefined;

  async function signOut() {
    await fetch("/api/v2/auth/signout", { method: "POST" });
    router.push("/v2/sign-in");
  }

  return (
    <div>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: "10px 18px",
          borderBottom: `1px solid ${ui.panelBorder}`,
          background: ui.panel,
          color: ui.ivory,
          fontSize: 14,
        }}
      >
        <strong style={{ color: ui.accent }}>MonkeMask v2</strong>
        <span style={{ color: ui.textDim }}>Local Ambassador</span>
        <span style={{ marginLeft: "auto", color: ui.textDim }}>
          {role}
          {country ? ` · ${chapterLabel(country)}` : ""} · {wallet.slice(0, 4)}…{wallet.slice(-4)}
        </span>
        <button
          onClick={signOut}
          style={{
            padding: "6px 14px",
            borderRadius: 8,
            border: `1px solid ${ui.panelBorder}`,
            background: "transparent",
            color: ui.ivory,
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </header>
      {(role === "super_admin" || role === "global_admin") && <AdminPanel role={role} />}
      {role === "ambassador" && <RosterBar country={country} vault={vault} />}
      <MonkeAnonymizer roster={roster} />
    </div>
  );
}
