"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { useState } from "react";

import { b64decode, b64encode } from "../../../lib/v2/bytes";
import { chapterLabel, chaptersInCountry, countryLabel } from "../../../lib/v2/chapters";
import { decrypt, importAesKey } from "../../../lib/v2/crypto";
import { deriveEncKeypair, openSealedSecret } from "../../../lib/v2/global";
import type { BoxKeypair } from "../../../lib/v2/sealedbox";
import { identityBindingMessage, MEMBER_ENC_IDENTITY_MESSAGE } from "../../../lib/v2/siws";
import { ui } from "../../theme";

const box: React.CSSProperties = {
  border: `1px solid ${ui.panelBorder}`,
  background: ui.panel,
  borderRadius: 12,
  padding: 16,
  marginTop: 16,
};
const btn: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "none",
  fontWeight: 700,
  background: ui.accent,
  color: ui.accentText,
  cursor: "pointer",
};

// A country ambassador reads every chapter in their country. "Enable access" registers
// their identity (so chapters seal their key to them); then each chapter can be opened
// and its roster decrypted. The country ambassador never uploads — they only read.
export function CountryPanel({ country }: { country: string }) {
  const { signMessage } = useWallet();
  const [encKp, setEncKp] = useState<BoxKeypair | null>(null);
  const [counts, setCounts] = useState<Record<string, number | "locked">>({});
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chapters = chaptersInCountry(country);

  async function identity(): Promise<BoxKeypair> {
    if (encKp) return encKp;
    if (!signMessage) throw new Error("wallet_not_connected");
    const kp = await deriveEncKeypair(await signMessage(new TextEncoder().encode(MEMBER_ENC_IDENTITY_MESSAGE)));
    setEncKp(kp);
    return kp;
  }

  async function enableAccess() {
    setErr(null);
    setNote(null);
    setBusy(true);
    try {
      const kp = await identity();
      const encB64 = b64encode(kp.publicKey);
      const bindSig = await signMessage!(new TextEncoder().encode(identityBindingMessage(encB64)));
      const r = await fetch("/api/v2/member/identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enc_public_key: encB64, identity_sig: bs58.encode(bindSig) }),
      });
      if (!r.ok) throw new Error("register_failed");
      setNote("Access enabled — chapters in your country will seal their key to you when their ambassadors next unlock.");
    } catch {
      setErr("Couldn't enable access.");
    } finally {
      setBusy(false);
    }
  }

  async function readChapter(code: string) {
    setErr(null);
    setNote(null);
    setBusy(true);
    try {
      const kp = await identity();
      const { grant, records } = await fetch(`/api/v2/country?chapter=${code}`).then((r) => r.json());
      if (!grant) {
        setCounts((c) => ({ ...c, [code]: "locked" }));
        setNote(`No key for ${chapterLabel(code)} yet — its ambassadors haven't unlocked since you enabled access.`);
        return;
      }
      const ck = openSealedSecret(grant.sealed_key, kp);
      if (!ck) {
        setErr("Couldn't open your key for this chapter.");
        return;
      }
      const key = await importAesKey(ck);
      let ok = 0;
      for (const rec of records as { ciphertext: string; iv: string }[]) {
        try {
          await decrypt(key, b64decode(rec.ciphertext), b64decode(rec.iv));
          ok += 1;
        } catch {
          /* skip */
        }
      }
      setCounts((c) => ({ ...c, [code]: ok }));
    } catch {
      setErr("Couldn't read that chapter.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px 8px", color: ui.ivory }}>
      <h2 style={{ fontSize: 20, fontWeight: 800, marginTop: 28 }}>Country roster — {countryLabel(country)}</h2>
      <div style={box}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ color: ui.textDim, fontSize: 13 }}>
            You can read every chapter in your country (read-only — you don&apos;t upload).
          </span>
          <button onClick={enableAccess} disabled={busy || !signMessage} style={{ ...btn, marginLeft: "auto" }}>
            🛟 Enable access
          </button>
        </div>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {chapters.map((c) => {
            const n = counts[c.code];
            return (
              <div key={c.code} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                <span style={{ flex: 1 }}>{chapterLabel(c.code)}</span>
                {n === "locked" ? (
                  <span style={{ color: ui.textDim }}>no key yet</span>
                ) : typeof n === "number" ? (
                  <span style={{ color: ui.accent }}>
                    {n} {n === 1 ? "person" : "people"}
                  </span>
                ) : null}
                <button onClick={() => readChapter(c.code)} disabled={busy} style={btn}>
                  Read
                </button>
              </div>
            );
          })}
        </div>
        {note && <p style={{ color: ui.accent, margin: "8px 0 0" }}>{note}</p>}
        {err && <p style={{ color: "#ff6b6b", margin: "8px 0 0" }}>{err}</p>}
      </div>
    </section>
  );
}
