"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useState } from "react";

import { b64decode, b64encode } from "../../../lib/v2/bytes";
import { CHAPTERS, chapterLabel } from "../../../lib/v2/chapters";
import { importAesKey, decrypt } from "../../../lib/v2/crypto";
import { deriveEncKeypair, openSealedSecret } from "../../../lib/v2/global";
import { MEMBER_ENC_IDENTITY_MESSAGE } from "../../../lib/v2/siws";
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
  const { signMessage } = useWallet();
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [recoverCode, setRecoverCode] = useState("");
  const [recovering, setRecovering] = useState(false);

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
    setNote(null);
    try {
      await vault.unlock();
    } catch (e) {
      const m = (e as Error).message;
      if (m === "pending_enrollment") {
        setNote(
          "Your identity is registered. Ask an already-enrolled global admin to grant you read access, then unlock again.",
        );
      } else {
        setErr(
          m === "wallet_not_connected"
            ? "Connect your wallet first."
            : m === "grant_unreadable"
              ? "Your grant couldn't be opened (it may need re-issuing)."
              : "Couldn't unlock the global registry.",
        );
      }
    }
  }

  async function enroll() {
    setErr(null);
    setNote(null);
    try {
      const n = await vault.enrollPending();
      setNote(n === 0 ? "No admins are waiting for access." : `Granted access to ${n} admin${n > 1 ? "s" : ""}.`);
    } catch {
      setErr("Couldn't grant pending admins.");
    }
  }

  // Register a member identity so chapter ambassadors can seal their CK to you as a
  // recovery (break-glass) holder. You can already read every chapter's associations via
  // the global registry, so this adds no exposure — it just lets you recover a chapter if
  // its ambassadors lose their wallets.
  async function enableRecovery() {
    setErr(null);
    setNote(null);
    if (!signMessage) {
      setErr("Connect your wallet first.");
      return;
    }
    try {
      const sig = await signMessage(new TextEncoder().encode(MEMBER_ENC_IDENTITY_MESSAGE));
      const enc = await deriveEncKeypair(sig);
      const r = await fetch("/api/v2/member/identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enc_public_key: b64encode(enc.publicKey) }),
      });
      if (!r.ok) throw new Error("register_failed");
      setNote("Recovery enabled — chapters will seal their key to you when their ambassadors next unlock.");
    } catch {
      setErr("Couldn't enable recovery.");
    }
  }

  // Break-glass: open a chapter via the recovery grant sealed to you, proving you can
  // read it even if its ambassadors are gone.
  async function recover() {
    setErr(null);
    setNote(null);
    if (!signMessage) {
      setErr("Connect your wallet first.");
      return;
    }
    if (!recoverCode) {
      setErr("Pick a chapter to recover.");
      return;
    }
    setRecovering(true);
    try {
      const sig = await signMessage(new TextEncoder().encode(MEMBER_ENC_IDENTITY_MESSAGE));
      const enc = await deriveEncKeypair(sig);
      const { grant, records } = await fetch(`/api/v2/recovery?chapter=${recoverCode}`).then((r) => r.json());
      if (!grant) {
        setNote(
          `No recovery key for ${chapterLabel(recoverCode)} yet — its ambassadors haven't unlocked since you enabled recovery.`,
        );
        return;
      }
      const ckBytes = openSealedSecret(grant.sealed_key, enc);
      if (!ckBytes) {
        setErr("Couldn't open your recovery grant for this chapter.");
        return;
      }
      const key = await importAesKey(ckBytes);
      let ok = 0;
      let fail = 0;
      for (const rec of records as { ciphertext: string; iv: string }[]) {
        try {
          await decrypt(key, b64decode(rec.ciphertext), b64decode(rec.iv));
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      setNote(
        `Recovered ${chapterLabel(recoverCode)}: you hold the chapter key and opened ${ok} record${ok !== 1 ? "s" : ""}${fail ? ` (${fail} unreadable)` : ""}.`,
      );
    } catch {
      setErr("Recovery failed.");
    } finally {
      setRecovering(false);
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
              <>
                <span style={{ fontSize: 14 }}>
                  🔓 Unlocked · read access verified on <strong>{vault.openedCount}</strong>{" "}
                  {vault.openedCount === 1 ? "entry" : "entries"}
                  {vault.failedCount > 0 && (
                    <span style={{ color: "#ff6b6b" }}> · ⚠️ {vault.failedCount} unreadable</span>
                  )}
                </span>
                <button onClick={enroll} disabled={vault.busy} style={{ ...btn, marginLeft: "auto" }}>
                  {vault.busy ? "Granting…" : "👥 Grant pending admins"}
                </button>
              </>
            )}
            <button
              onClick={enableRecovery}
              disabled={!vault.canSign}
              style={{ ...btn, background: "transparent", color: ui.ivory, border: `1px solid ${ui.panelBorder}` }}
              title="register as a recovery holder for chapter keys"
            >
              🛟 Enable chapter recovery
            </button>
          </div>
        )}
        {note && <p style={{ color: ui.accent, margin: "8px 0 0" }}>{note}</p>}
        {err && <p style={{ color: "#ff6b6b", margin: "8px 0 0" }}>{err}</p>}
      </div>

      {isGlobalAdmin && (
        <div style={{ ...box }}>
          <strong>Break-glass recovery</strong>{" "}
          <span style={{ color: ui.textDim, fontSize: 13 }}>
            — open a chapter with the key sealed to you (use if its ambassadors lost access)
          </span>
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={recoverCode}
              onChange={(e) => setRecoverCode(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: `1px solid ${ui.panelBorder}`,
                background: "#0d2a17",
                color: ui.ivory,
              }}
            >
              <option value="">— chapter —</option>
              {CHAPTERS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.label}
                </option>
              ))}
            </select>
            <button onClick={recover} disabled={recovering || !vault.canSign} style={btn}>
              {recovering ? "Recovering…" : "🔑 Recover chapter"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
