"use client";

import { useState } from "react";

import type { VaultApi } from "../../../lib/v2/useVault";
import { ui } from "../../theme";

// Manage the chapter roster: each known person shows their assigned monke with a Reset
// that deletes their record (use when someone sells or changes their monke). Only the
// ambassador sees this — the roster is decrypted with the chapter key they hold.
export function RosterManager({ vault }: { vault: VaultApi }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  if (vault.locked || vault.entries.length === 0) return null;

  async function reset(personId: string) {
    setBusyId(personId);
    try {
      await vault.resetEntry(personId);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section style={{ maxWidth: 760, margin: "12px auto 0", padding: "0 16px", color: ui.ivory }}>
      <div
        style={{
          border: `1px solid ${ui.panelBorder}`,
          background: ui.panel,
          borderRadius: 12,
          padding: 16,
        }}
      >
        <strong>Known people ({vault.entries.length})</strong>{" "}
        <span style={{ color: ui.textDim, fontSize: 13 }}>
          — reset a person if they sold or changed their monke (deletes their record)
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
          {vault.entries.map((e) => (
            <div
              key={e.person_id}
              style={{
                width: 84,
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
              }}
            >
              <img
                src={e.monke}
                alt="monke"
                style={{ width: 64, height: 64, objectFit: "contain", borderRadius: 9, background: ui.bg }}
              />
              <button
                onClick={() => reset(e.person_id)}
                disabled={busyId === e.person_id}
                style={{
                  fontSize: 12,
                  padding: "3px 8px",
                  borderRadius: 7,
                  border: `1px solid ${ui.panelBorder}`,
                  background: "transparent",
                  color: "#ff8a8a",
                  cursor: "pointer",
                }}
              >
                {busyId === e.person_id ? "…" : "🗑 Reset"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
