"use client";

import { useCallback, useEffect, useState } from "react";

import { CHAPTERS, chapterLabel } from "../../../lib/v2/chapters";
import { ui } from "../../theme";

type Entry = {
  wallet_pubkey: string;
  role: string;
  country: string | null;
  removed_at: string | null;
};
type RosterStat = { country: string; record_count: number | null };

const ERRORS: Record<string, string> = {
  invalid_wallet: "That doesn't look like a Solana wallet address.",
  invalid_role: "Pick Global Admin or Local Ambassador.",
  country_required: "Local Ambassadors need a chapter.",
  invalid_chapter: "Pick a chapter from the list.",
  already_exists: "That wallet is already on the allowlist.",
  insert_failed: "Couldn't add the wallet. Try again.",
  forbidden: "Only a super admin can do this.",
};

const box: React.CSSProperties = {
  border: `1px solid ${ui.panelBorder}`,
  background: ui.panel,
  borderRadius: 12,
  padding: 16,
  marginTop: 16,
};
const input: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: `1px solid ${ui.panelBorder}`,
  background: "#0d2a17",
  color: ui.ivory,
};

export function AdminPanel({ role }: { role: string }) {
  const isSuper = role === "super_admin";
  const [entries, setEntries] = useState<Entry[]>([]);
  const [stats, setStats] = useState<RosterStat[]>([]);
  const [total, setTotal] = useState(0);
  const [wallet, setWallet] = useState("");
  const [newRole, setNewRole] = useState<"ambassador" | "global_admin">("ambassador");
  const [country, setCountry] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (isSuper) {
      const r = await fetch("/api/v2/admin/allowlist");
      if (r.ok) setEntries((await r.json()).entries ?? []);
    }
    const s = await fetch("/api/v2/admin/stats");
    if (s.ok) {
      const j = await s.json();
      setStats(j.rosters ?? []);
      setTotal(j.total ?? 0);
    }
  }, [isSuper]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    setMsg(null);
    setBusy(true);
    try {
      const r = await fetch("/api/v2/admin/allowlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet_pubkey: wallet, role: newRole, country }),
      });
      if (r.ok) {
        setWallet("");
        setCountry("");
        setMsg("✓ Added.");
        await load();
      } else {
        const e = await r.json().catch(() => ({}));
        setMsg(ERRORS[e.error] ?? "Couldn't add the wallet.");
      }
    } finally {
      setBusy(false);
    }
  }

  const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

  async function remove(wallet: string, force = false) {
    const r = await fetch("/api/v2/admin/allowlist", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet_pubkey: wallet, force }),
    });
    if (r.ok) {
      await load();
      return;
    }
    const e = await r.json().catch(() => ({}));
    if (e.error === "last_ambassador") {
      if (
        confirm(
          "This is the last active ambassador of the chapter. Remove anyway? A global admin could still recover it, but ideally add a replacement first.",
        )
      ) {
        await remove(wallet, true);
      }
    } else {
      setMsg(e.error === "cannot_remove_super_admin" ? "Can't remove a super admin." : "Couldn't remove the wallet.");
    }
  }

  return (
    <section style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px 40px", color: ui.ivory }}>
      <h2 style={{ fontSize: 20, fontWeight: 800, marginTop: 28 }}>Admin</h2>

      {/* Counts WITHOUT faces */}
      <div style={box}>
        <strong>Roster counts</strong>{" "}
        <span style={{ color: ui.textDim, fontSize: 13 }}>
          (how many monkes per country — face data stays encrypted)
        </span>
        <div style={{ marginTop: 10, fontSize: 14 }}>
          {stats.length === 0 ? (
            <span style={{ color: ui.textDim }}>No rosters yet.</span>
          ) : (
            stats.map((s) => (
              <div key={s.country} style={{ display: "flex", gap: 10 }}>
                <span style={{ width: 60 }}>{s.country}</span>
                <span>{s.record_count ?? 0} monkes</span>
              </div>
            ))
          )}
          <div style={{ marginTop: 6, color: ui.accent }}>Total: {total}</div>
        </div>
      </div>

      {isSuper && (
        <>
          {/* Onboard a global admin or ambassador */}
          <div style={box}>
            <strong>Add a wallet</strong>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center" }}>
              <input
                style={{ ...input, flex: "1 1 320px" }}
                placeholder="Solana wallet address"
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
              />
              <select
                style={input}
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as "ambassador" | "global_admin")}
              >
                <option value="ambassador">Local Ambassador</option>
                <option value="global_admin">Global Admin</option>
              </select>
              {newRole === "ambassador" && (
                <select style={input} value={country} onChange={(e) => setCountry(e.target.value)}>
                  <option value="">— chapter —</option>
                  {CHAPTERS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.flag} {c.label}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={add}
                disabled={busy}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  fontWeight: 700,
                  background: ui.accent,
                  color: ui.accentText,
                  cursor: "pointer",
                }}
              >
                Add
              </button>
            </div>
            {msg && <p style={{ marginTop: 8, color: msg.startsWith("✓") ? ui.good : "#ff6b6b" }}>{msg}</p>}
          </div>

          {/* Current allowlist */}
          <div style={box}>
            <strong>Allowlist ({entries.filter((e) => !e.removed_at).length})</strong>
            <div style={{ marginTop: 10, fontSize: 14 }}>
              {entries.map((e) => (
                <div
                  key={e.wallet_pubkey}
                  style={{ display: "flex", gap: 10, padding: "4px 0", alignItems: "center", opacity: e.removed_at ? 0.4 : 1 }}
                >
                  <span style={{ fontFamily: "monospace" }}>{short(e.wallet_pubkey)}</span>
                  <span style={{ color: ui.accent }}>{e.role}</span>
                  {e.country && <span style={{ color: ui.textDim }}>{chapterLabel(e.country)}</span>}
                  {e.removed_at ? (
                    <span style={{ color: ui.textDim, marginLeft: "auto", fontSize: 12 }}>removed</span>
                  ) : (
                    e.role !== "super_admin" && (
                      <button
                        onClick={() => remove(e.wallet_pubkey)}
                        style={{
                          marginLeft: "auto",
                          fontSize: 12,
                          padding: "2px 8px",
                          borderRadius: 6,
                          border: `1px solid ${ui.panelBorder}`,
                          background: "transparent",
                          color: "#ff8a8a",
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
