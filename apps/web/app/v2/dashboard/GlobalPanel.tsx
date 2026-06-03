"use client";

import { useCallback, useEffect, useState } from "react";

import { chapterLabel } from "../../../lib/v2/chapters";
import { useGlobalVault } from "../../../lib/v2/useGlobalVault";
import { ui } from "../../theme";

type Stats = {
  total: number;
  by_country: { country: string; count: number }[];
  initialised: boolean;
};

const box: React.CSSProperties = {
  border: `1px solid ${ui.panelBorder}`,
  background: ui.panel,
  borderRadius: 12,
  padding: 16,
  marginTop: 16,
};
const btn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 8,
  border: "none",
  fontWeight: 700,
  background: ui.accent,
  color: ui.accentText,
  cursor: "pointer",
};

// Global registry view. Counts are plaintext (visible to super_admin + global_admin,
// no faces). The crypto controls (initialise / unlock + read) are global_admin only —
// they are the sole holders of the secret key.
export function GlobalPanel({ role }: { role: string }) {
  const isGlobalAdmin = role === "global_admin";
  const vault = useGlobalVault();
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/v2/global/stats");
    if (r.ok) setStats(await r.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function initialise() {
    setErr(null);
    try {
      await vault.initialise();
      await load();
    } catch (e) {
      const m = (e as Error).message;
      setErr(m === "already_initialised" ? "The registry is already initialised." : "Couldn't initialise.");
    }
  }

  async function unlock() {
    setErr(null);
    try {
      await vault.unlock();
    } catch (e) {
      const m = (e as Error).message;
      setErr(
        m === "no_grant"
          ? "Your wallet isn't enrolled to read the global registry yet."
          : m === "wallet_not_connected"
            ? "Connect your wallet first."
            : "Couldn't unlock the global registry.",
      );
    }
  }

  return (
    <section style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px 8px", color: ui.ivory }}>
      <h2 style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>Global registry</h2>
      <div style={box}>
        <strong>Global counts</strong>{" "}
        <span style={{ color: ui.textDim, fontSize: 13 }}>
          (sealed face↔monke entries per chapter — faces stay encrypted to global admins)
        </span>
        <div style={{ marginTop: 10, fontSize: 14 }}>
          {!stats || stats.total === 0 ? (
            <span style={{ color: ui.textDim }}>No global entries yet.</span>
          ) : (
            stats.by_country.map((s) => (
              <div key={s.country} style={{ display: "flex", gap: 10 }}>
                <span style={{ width: 160 }}>{chapterLabel(s.country)}</span>
                <span>{s.count}</span>
              </div>
            ))
          )}
          {stats && <div style={{ marginTop: 6, color: ui.accent }}>Total: {stats.total}</div>}
        </div>

        {isGlobalAdmin && (
          <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {stats && !stats.initialised ? (
              <button onClick={initialise} disabled={vault.busy || !vault.canSign} style={btn}>
                {vault.busy ? "Initialising…" : "🔐 Initialise global registry"}
              </button>
            ) : vault.locked ? (
              <button onClick={unlock} disabled={vault.busy || !vault.canSign} style={btn}>
                {vault.busy ? "Unlocking…" : "🔓 Unlock & read"}
              </button>
            ) : (
              <span style={{ fontSize: 14 }}>
                🔓 Unlocked · read access verified on <strong>{vault.openedCount}</strong>{" "}
                {vault.openedCount === 1 ? "entry" : "entries"}
                {vault.failedCount > 0 && (
                  <span style={{ color: "#ff6b6b" }}> · ⚠️ {vault.failedCount} unreadable</span>
                )}
              </span>
            )}
          </div>
        )}
        {err && <p style={{ color: "#ff6b6b", margin: "8px 0 0" }}>{err}</p>}
      </div>
    </section>
  );
}
