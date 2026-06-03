"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useState } from "react";

import { b64decode, b64encode } from "./bytes";
import { decrypt, deriveKEK, encrypt, generateDataKey, unwrapKey, wrapKey } from "./crypto";
import { emptyRoster, findMatch, upsertEntry, type Roster, type RosterEntry } from "./roster";
import { KEK_DERIVATION_MESSAGE } from "./siws";

// The shape returned by useVault, so consumers (RosterBar, the dashboard) can take
// the shared instance as a prop without re-deriving the type.
export type VaultApi = {
  unlock: () => Promise<void>;
  saveEntry: (embedding: number[], monke: string) => Promise<void>;
  match: (embedding: number[]) => RosterEntry | null;
  busy: boolean;
  locked: boolean;
  count: number;
  canUnlock: boolean;
};

// The ambassador's vault: unlock with one wallet signature (derives the KEK, then
// unwraps — or first-time generates — the per-country key CK), load + decrypt the
// roster, and save entries (re-encrypt + persist). The CK lives only in memory.
export function useVault(): VaultApi {
  const { signMessage } = useWallet();
  const [ck, setCk] = useState<CryptoKey | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [busy, setBusy] = useState(false);

  const unlock = useCallback(async () => {
    if (!signMessage) throw new Error("wallet_not_connected");
    setBusy(true);
    try {
      const sig = await signMessage(new TextEncoder().encode(KEK_DERIVATION_MESSAGE));
      const kek = await deriveKEK(sig);

      // Get the wrapped country key, or generate + persist it on first use.
      let key = (await fetch("/api/v2/roster/key").then((r) => r.json())).key;
      let countryKey: CryptoKey;
      if (key) {
        countryKey = await unwrapKey(kek, b64decode(key.wrapped_key), b64decode(key.iv));
      } else {
        countryKey = await generateDataKey();
        const { iv, wrapped } = await wrapKey(kek, countryKey);
        const put = await fetch("/api/v2/roster/key", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wrapped_key: b64encode(wrapped), iv: b64encode(iv) }),
        });
        if (!put.ok) {
          // Lost a race — re-read and unwrap whoever won.
          key = (await fetch("/api/v2/roster/key").then((r) => r.json())).key;
          countryKey = await unwrapKey(kek, b64decode(key.wrapped_key), b64decode(key.iv));
        }
      }
      setCk(countryKey);

      // Load + decrypt the roster blob.
      const blob = (await fetch("/api/v2/roster").then((r) => r.json())).roster;
      if (blob) {
        const plain = await decrypt(countryKey, b64decode(blob.ciphertext), b64decode(blob.iv));
        setRoster(JSON.parse(new TextDecoder().decode(plain)));
      } else {
        setRoster(emptyRoster());
      }
    } finally {
      setBusy(false);
    }
  }, [signMessage]);

  const persist = useCallback(async (next: Roster) => {
    if (!ck) throw new Error("locked");
    const { iv, ciphertext } = await encrypt(ck, new TextEncoder().encode(JSON.stringify(next)));
    await fetch("/api/v2/roster", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ciphertext: b64encode(ciphertext),
        iv: b64encode(iv),
        record_count: next.entries.length,
      }),
    });
  }, [ck]);

  const saveEntry = useCallback(
    async (embedding: number[], monke: string) => {
      if (!ck || !roster) throw new Error("locked");
      const entry: RosterEntry = { person_id: crypto.randomUUID(), embedding, monke };
      const next = upsertEntry(roster, entry);
      setRoster(next);
      await persist(next);
    },
    [ck, roster, persist],
  );

  const match = useCallback(
    (embedding: number[]) => (roster ? findMatch(embedding, roster) : null),
    [roster],
  );

  return {
    unlock,
    saveEntry,
    match,
    busy,
    locked: ck === null,
    count: roster?.entries.length ?? 0,
    canUnlock: !!signMessage,
  };
}
