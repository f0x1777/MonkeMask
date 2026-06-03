"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useRef, useState } from "react";

import { b64decode, b64encode } from "./bytes";
import { decrypt, encrypt, generateKeyBytes, importAesKey } from "./crypto";
import { deriveEncKeypair, openSealedSecret, sealSecretToAdmin } from "./global";
import { emptyRoster, findMatch, type Roster, type RosterEntry } from "./roster";
import { MEMBER_ENC_IDENTITY_MESSAGE } from "./siws";

// Seal the CK to every entitled holder of this chapter who is registered but ungranted
// (chapter mates + global_admin recovery holders). Idempotent: only seals to the pending
// set the server returns. Returns how many were granted.
async function sealCkToPending(ckBytes: Uint8Array): Promise<number> {
  const pendingList: { wallet_pubkey: string; enc_public_key: string }[] =
    (await fetch("/api/v2/chapter/grants").then((r) => r.json())).pending ?? [];
  const grants = pendingList.map((p) => ({
    wallet_pubkey: p.wallet_pubkey,
    sealed_key: sealSecretToAdmin(ckBytes, p.enc_public_key),
  }));
  if (grants.length === 0) return 0;
  const r = await fetch("/api/v2/chapter/grants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grants }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "grant_failed");
  return (await r.json()).granted ?? grants.length;
}

export type VaultApi = {
  unlock: () => Promise<void>;
  saveEntry: (embedding: number[], monke: string) => Promise<void>;
  resetEntry: (personId: string) => Promise<void>;
  match: (embedding: number[]) => RosterEntry | null;
  enrollPending: () => Promise<number>;
  entries: { person_id: string; monke: string }[];
  busy: boolean;
  locked: boolean;
  pending: boolean;
  count: number;
  canUnlock: boolean;
};

// The chapter vault, multi-holder + per-record. One signature derives the ambassador's
// encryption identity; the chapter key (CK) is sealed to it (shared across the chapter's
// ambassadors). Each face<->monke is its own encrypted ROW, so concurrent saves don't
// clobber and a single person can be reset. CK lives only in memory.
export function useVault(): VaultApi {
  const { signMessage } = useWallet();
  const [ck, setCk] = useState<CryptoKey | null>(null);
  const ckBytesRef = useRef<Uint8Array | null>(null); // raw CK, to seal to chapter mates
  // rosterRef is the authoritative, always-current roster; state mirrors it for render.
  // Reading the ref (not a closed-over state value) is what prevents rapid saves from
  // each starting from a stale snapshot.
  const rosterRef = useRef<Roster>(emptyRoster());
  const [, forceRender] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);

  const setRoster = useCallback((next: Roster) => {
    rosterRef.current = next;
    forceRender((n) => n + 1);
  }, []);

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

  const loadRoster = useCallback(
    async (key: CryptoKey) => {
      const records: { id: string; person_id: string; ciphertext: string; iv: string }[] =
        (await fetch("/api/v2/roster/records").then((r) => r.json())).records ?? [];
      const entries: RosterEntry[] = [];
      for (const r of records) {
        try {
          const plain = await decrypt(key, b64decode(r.ciphertext), b64decode(r.iv));
          const { embedding, monke } = JSON.parse(new TextDecoder().decode(plain));
          entries.push({ person_id: r.person_id, embedding, monke });
        } catch {
          /* skip an unreadable record */
        }
      }
      setRoster({ version: 1, entries });
    },
    [setRoster],
  );

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
        // Reconcile: cover any newly-entitled holders (new chapter mates / global-admin
        // recovery holders) that registered after this CK was first distributed.
        void sealCkToPending(bytes).catch(() => {});
      } else if (!initialised) {
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
        // Auto-seal the CK to recovery holders (global admins) + any chapter mates, so
        // the chapter is never single-holder / unrecoverable. Best-effort.
        void sealCkToPending(bytes).catch(() => {});
      } else {
        await registerIdentity(enc.publicKey);
        setPending(true);
        throw new Error("pending_enrollment");
      }
    } finally {
      setBusy(false);
    }
  }, [deriveIdentity, registerIdentity, loadRoster, setRoster]);

  // Save one face<->monke as its own encrypted row. Reads rosterRef (current) to find a
  // matching known person, so saves never start from a stale snapshot and never clobber.
  const saveEntry = useCallback(
    async (embedding: number[], monke: string) => {
      if (!ck) throw new Error("locked");
      const cur = rosterRef.current;
      const matched = findMatch(embedding, cur);
      const personId = matched?.person_id ?? crypto.randomUUID();
      const next: Roster = {
        version: 1,
        entries: [...cur.entries.filter((e) => e.person_id !== personId), { person_id: personId, embedding, monke }],
      };
      setRoster(next); // optimistic + makes the personId visible to the next save
      const { iv, ciphertext } = await encrypt(ck, new TextEncoder().encode(JSON.stringify({ embedding, monke })));
      await fetch("/api/v2/roster/records", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ person_id: personId, ciphertext: b64encode(ciphertext), iv: b64encode(iv) }),
      });
    },
    [ck, setRoster],
  );

  // Reset a person (sold/changed their monke): delete their record everywhere.
  const resetEntry = useCallback(
    async (personId: string) => {
      const cur = rosterRef.current;
      setRoster({ version: 1, entries: cur.entries.filter((e) => e.person_id !== personId) });
      await fetch(`/api/v2/roster/records?person_id=${encodeURIComponent(personId)}`, { method: "DELETE" });
    },
    [setRoster],
  );

  const match = useCallback(
    (embedding: number[]) => findMatch(embedding, rosterRef.current),
    [],
  );

  const enrollPending = useCallback(async (): Promise<number> => {
    const bytes = ckBytesRef.current;
    if (!bytes) throw new Error("locked");
    return sealCkToPending(bytes);
  }, []);

  const roster = rosterRef.current;
  return {
    unlock,
    saveEntry,
    resetEntry,
    match,
    enrollPending,
    entries: roster.entries.map((e) => ({ person_id: e.person_id, monke: e.monke })),
    busy,
    locked: ck === null,
    pending,
    count: roster.entries.length,
    canUnlock: !!signMessage,
  };
}
