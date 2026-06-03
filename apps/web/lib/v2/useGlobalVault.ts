"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useState } from "react";

import { b64encode } from "./bytes";
import {
  deriveEncKeypair,
  newGlobalKeypair,
  openEntry,
  openSealedSecret,
  sealSecretToAdmin,
  type GlobalEntry,
} from "./global";
import { keypairFromSecret, type BoxKeypair } from "./sealedbox";
import { GLOBAL_ENC_IDENTITY_MESSAGE } from "./siws";

// The global_admin side of the registry. A single wallet signature derives the admin's
// encryption identity; from there: initialise (seal the secret to yourself), unlock
// (open your sealed grant), or enroll pending admins (seal the secret to their pubkeys).
// Keys live only in memory.
export function useGlobalVault() {
  const { signMessage } = useWallet();
  const [kp, setKp] = useState<BoxKeypair | null>(null); // the global box keypair when unlocked
  const [entries, setEntries] = useState<GlobalEntry[] | null>(null);
  const [failedCount, setFailedCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const deriveIdentity = useCallback(async () => {
    if (!signMessage) throw new Error("wallet_not_connected");
    const sig = await signMessage(new TextEncoder().encode(GLOBAL_ENC_IDENTITY_MESSAGE));
    return deriveEncKeypair(sig);
  }, [signMessage]);

  const registerIdentity = useCallback(async (enc: BoxKeypair) => {
    await fetch("/api/v2/global/identity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enc_public_key: b64encode(enc.publicKey) }),
    });
  }, []);

  const loadEntries = useCallback(async (keypair: BoxKeypair) => {
    const raw: { sealed_blob: string }[] = (await fetch("/api/v2/global/entries").then((r) => r.json())).entries ?? [];
    const opened: GlobalEntry[] = [];
    let failed = 0;
    for (const e of raw) {
      const o = openEntry(e.sealed_blob, keypair);
      if (o) opened.push(o);
      else failed++; // unopenable/poisoned entry — surfaced, not swallowed
    }
    setEntries(opened);
    setFailedCount(failed);
  }, []);

  // First global_admin: generate the keypair, seal the secret to your own identity.
  const initialise = useCallback(async () => {
    setBusy(true);
    try {
      const enc = await deriveIdentity();
      await registerIdentity(enc);
      const keypair = newGlobalKeypair();
      const sealed = sealSecretToAdmin(keypair.secretKey, b64encode(enc.publicKey));
      const r = await fetch("/api/v2/global/key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ box_public_key: b64encode(keypair.publicKey), sealed_secret: sealed }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "init_failed");
      setKp(keypair);
      setEntries([]);
    } finally {
      setBusy(false);
    }
  }, [deriveIdentity, registerIdentity]);

  // Existing admin: open your sealed grant → the global secret → read the registry.
  // A newcomer with no grant gets their identity registered and is told they're pending.
  const unlock = useCallback(async () => {
    setBusy(true);
    try {
      const enc = await deriveIdentity();
      const { grant } = await fetch("/api/v2/global/key").then((r) => r.json());
      if (!grant) {
        await registerIdentity(enc); // become enrollable
        throw new Error("pending_enrollment");
      }
      const secret = openSealedSecret(grant.sealed_secret, enc);
      if (!secret) throw new Error("grant_unreadable");
      const keypair = keypairFromSecret(secret);
      setKp(keypair);
      await loadEntries(keypair);
    } finally {
      setBusy(false);
    }
  }, [deriveIdentity, registerIdentity, loadEntries]);

  // Enrolled admin: seal the global secret to every pending admin's registered pubkey.
  const enrollPending = useCallback(async (): Promise<number> => {
    if (!kp) throw new Error("locked");
    setBusy(true);
    try {
      const pending: { global_admin_wallet: string; enc_public_key: string }[] =
        (await fetch("/api/v2/global/grants").then((r) => r.json())).pending ?? [];
      const grants = pending.map((p) => ({
        global_admin_wallet: p.global_admin_wallet,
        sealed_secret: sealSecretToAdmin(kp.secretKey, p.enc_public_key),
      }));
      if (grants.length === 0) return 0;
      const r = await fetch("/api/v2/global/grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grants }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "grant_failed");
      return (await r.json()).granted ?? grants.length;
    } finally {
      setBusy(false);
    }
  }, [kp]);

  return {
    initialise,
    unlock,
    enrollPending,
    busy,
    locked: kp === null,
    openedCount: entries?.length ?? 0,
    failedCount,
    canSign: !!signMessage,
  };
}
