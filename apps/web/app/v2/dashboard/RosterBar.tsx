"use client";

import { useEffect, useState } from "react";

import { chapterLabel } from "../../../lib/v2/chapters";
import { type VaultApi } from "../../../lib/v2/useVault";
import { ui } from "../../theme";

const bar: React.CSSProperties = {
  maxWidth: 760,
  margin: "16px auto 0",
  padding: "12px 16px",
  border: `1px solid ${ui.panelBorder}`,
  background: ui.panel,
  borderRadius: 12,
  color: ui.ivory,
  display: "flex",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap",
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

// Consent gate + vault unlock + roster count for ambassadors. The deep auto-match /
// auto-save into the anonymizer hooks off the returned vault (next step).
export function RosterBar({
  country,
  vault,
}: {
  country: string | null;
  vault: VaultApi;
}) {
  const [consent, setConsent] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v2/consent")
      .then((r) => r.json())
      .then((j) => setConsent(!!j.granted))
      .catch(() => setConsent(false));
  }, []);

  async function accept() {
    await fetch("/api/v2/consent", { method: "POST" });
    setConsent(true);
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
          "You're registered for this chapter. Ask an ambassador who already has the roster to grant you access, then unlock again.",
        );
      } else {
        setErr(
          m === "wallet_not_connected"
            ? "Connect your wallet first."
            : m === "grant_unreadable"
              ? "Your access couldn't be opened (it may need re-issuing)."
              : "Couldn't unlock the vault.",
        );
      }
    }
  }

  async function enroll() {
    setErr(null);
    setNote(null);
    try {
      const n = await vault.enrollPending();
      setNote(
        n === 0 ? "No chapter ambassadors are waiting for access." : `Granted access to ${n} ambassador${n > 1 ? "s" : ""}.`,
      );
    } catch {
      setErr("Couldn't grant pending ambassadors.");
    }
  }

  if (consent === null) return null; // loading

  if (!consent) {
    return (
      <div style={{ ...bar, alignItems: "flex-start", flexDirection: "column" }}>
        <strong>Before you build your country roster</strong>
        <p style={{ color: ui.textDim, margin: "4px 0", fontSize: 14, maxWidth: 620 }}>
          Using this runs face matching on the people in your photos and contributes
          their monke association to the shared MonkeDAO registry. By continuing you
          confirm you have their consent.
        </p>
        <button onClick={accept} style={btn}>
          I understand &amp; have consent
        </button>
      </div>
    );
  }

  return (
    <div style={bar}>
      <strong style={{ color: ui.accent }}>Roster {chapterLabel(country)}</strong>
      {vault.locked ? (
        <>
          <span style={{ color: ui.textDim, fontSize: 14 }}>Locked — unlock to load known faces.</span>
          <button onClick={unlock} disabled={vault.busy || !vault.canUnlock} style={{ ...btn, marginLeft: "auto" }}>
            {vault.busy ? "Unlocking…" : "🔓 Unlock vault"}
          </button>
        </>
      ) : (
        <>
          <span style={{ marginLeft: "auto", fontSize: 14 }}>
            🔓 Unlocked · <strong>{vault.count}</strong> known {vault.count === 1 ? "person" : "people"}
          </span>
          <button onClick={enroll} disabled={vault.busy} style={btn} title="grant chapter mates who are waiting">
            👥 Grant pending
          </button>
        </>
      )}
      {note && <p style={{ width: "100%", color: ui.accent, margin: "4px 0 0" }}>{note}</p>}
      {err && <p style={{ width: "100%", color: "#ff6b6b", margin: "4px 0 0" }}>{err}</p>}
    </div>
  );
}
