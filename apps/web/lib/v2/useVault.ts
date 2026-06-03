"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useRef, useState } from "react";

import { b64decode, b64encode } from "./bytes";
import { decrypt, encrypt, generateKeyBytes, importAesKey } from "./crypto";
import { deriveEncKeypair, openSealedSecret, sealSecretToAdmin } from "./global";
import { emptyRoster, findMatch, upsertEntry, type Roster, type RosterEntry } from "./roster";
import { MEMBER_ENC_IDENTITY_MESSAGE } from "./siws";

export type VaultApi = {
  unlock: () => Promise<void>;
  saveEntry: (embedding: number[], monke: string) => Promise<void>;
  match: (embedding: number[]) => RosterEntry | null;
  enrollPending: () => Promise<number>;
  busy: boolean;
  locked: boolean;
  pending: boolean; // unlocked attempt but not yet granted access to the chapter
  count: number;
  canUnlock: boolean;
};

// The chapter vault, multi-holder. One signature derives the ambassador's encryption
// identity; the chapter key (CK) is SEALED to it, so every ambassador of the chapter
// shares one roster. The first ambassador initialises (CK sealed to self); later ones
// register and wait for an existing holder to enroll them. CK lives only in memory.
export function useVault(): VaultApi {
  const { signMessage } = useWallet();
  const [ck, setCk] = useState<CryptoKey | null>(null);
  const ckBytesRef = useRef<Uint8Array | null>(null); // raw CK, needed to seal to others
  const [roster, setRoster] = useState<Roster | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);

  const deriveIdentity = useCallback(async () => {
    if (!signMessage) throw new Error("wallet_not_connected");
    const sig = await signMessage(new TextEncoder().encode(MEMBER_ENC_IDENTITY_MESSAGE));
    return deriveEncKeypair(sig);
  }, [signMessage]);

  const registerIdentity = useCallback(async (encPublicKey: Uint8Array) => {
    await fetch("/api/v2/member/identity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enc_public_key: b64encode(encPublicKey) }),
    });
  }, []);

  const loadRoster = useCallback(async (key: CryptoKey) => {
    const blob = (await fetch("/api/v2/roster").then((r) => r.json())).roster;
    if (blob) {
      const plain = await decrypt(key, b64decode(blob.ciphertext), b64decode(blob.iv));
      setRoster(JSON.parse(new TextDecoder().decode(plain)));
    } else {
      setRoster(emptyRoster());
    }
  }, []);

  const unlock = useCallback(async () => {
    setBusy(true);
    setPending(false);
    try {
      const enc = await deriveIdentity();
      const { initialised, grant } = await fetch("/api/v2/chapter/key").then((r) => r.json());

      if (grant) {
        const bytes = openSealedSecret(grant.sealed_key, enc);
        if (!bytes) throw new Error("grant_unreadable");
        ckBytesRef.current = bytes;
        const key = await importAesKey(bytes);
        setCk(key);
        await loadRoster(key);
      } else if (!initialised) {
        // First ambassador of the chapter: generate the CK, seal it to yourself.
        await registerIdentity(enc.publicKey);
        const bytes = generateKeyBytes();
        const sealed = sealSecretToAdmin(bytes, b64encode(enc.publicKey));
        const r = await fetch("/api/v2/chapter/key", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sealed_key: sealed }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "init_failed");
        ckBytesRef.current = bytes;
        setCk(await importAesKey(bytes));
        setRoster(emptyRoster());
      } else {
        // Chapter exists but you have no grant yet — register and wait for enrollment.
        await registerIdentity(enc.publicKey);
        setPending(true);
        throw new Error("pending_enrollment");
      }
    } finally {
      setBusy(false);
    }
  }, [deriveIdentity, registerIdentity, loadRoster]);

  const persist = useCallback(
    async (next: Roster) => {
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
    },
    [ck],
  );

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

  // Seal the CK to every pending ambassador of this chapter (so they share the roster).
  const enrollPending = useCallback(async (): Promise<number> => {
    const bytes = ckBytesRef.current;
    if (!bytes) throw new Error("locked");
    const pendingList: { wallet_pubkey: string; enc_public_key: string }[] =
      (await fetch("/api/v2/chapter/grants").then((r) => r.json())).pending ?? [];
    const grants = pendingList.map((p) => ({
      wallet_pubkey: p.wallet_pubkey,
      sealed_key: sealSecretToAdmin(bytes, p.enc_public_key),
    }));
    if (grants.length === 0) return 0;
    const r = await fetch("/api/v2/chapter/grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grants }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "grant_failed");
    return (await r.json()).granted ?? grants.length;
  }, []);

  return {
    unlock,
    saveEntry,
    match,
    enrollPending,
    busy,
    locked: ck === null,
    pending,
    count: roster?.entries.length ?? 0,
    canUnlock: !!signMessage,
  };
}
