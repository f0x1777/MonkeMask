"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useState } from "react";

import { b64encode } from "./bytes";
import { deriveKEK } from "./crypto";
import { newGlobalKeypair, openEntry, unwrapSecret, wrapSecret, type GlobalEntry } from "./global";
import { keypairFromSecret, type BoxKeypair } from "./sealedbox";
import { GLOBAL_KEK_DERIVATION_MESSAGE } from "./siws";

// The global_admin side of the registry: initialise it once (generate the keypair,
// wrap the secret to your own wallet), or unlock it (unwrap the secret with your wallet
// signature, then open + match the sealed entries). The secret key lives only in memory.
export function useGlobalVault() {
  const { signMessage } = useWallet();
  const [kp, setKp] = useState<BoxKeypair | null>(null);
  const [entries, setEntries] = useState<GlobalEntry[] | null>(null);
  const [failedCount, setFailedCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const deriveGlobalKek = useCallback(async () => {
    if (!signMessage) throw new Error("wallet_not_connected");
    const sig = await signMessage(new TextEncoder().encode(GLOBAL_KEK_DERIVATION_MESSAGE));
    return deriveKEK(sig);
  }, [signMessage]);

  // First global_admin bootstraps the registry: generate the keypair, wrap the secret
  // under their own wallet KEK, publish the public key + self grant.
  const initialise = useCallback(async () => {
    setBusy(true);
    try {
      const kek = await deriveGlobalKek();
      const keypair = newGlobalKeypair();
      const { wrapped, iv } = await wrapSecret(kek, keypair.secretKey);
      const r = await fetch("/api/v2/global/key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ box_public_key: b64encode(keypair.publicKey), wrapped_secret: wrapped, iv }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "init_failed");
      setKp(keypair);
      setEntries([]);
    } finally {
      setBusy(false);
    }
  }, [deriveGlobalKek]);

  // Existing global_admin: unwrap the secret with the wallet KEK, then load + open the
  // sealed entries (proves read access; powers global matching).
  const unlock = useCallback(async () => {
    setBusy(true);
    try {
      const kek = await deriveGlobalKek();
      const { grant } = await fetch("/api/v2/global/key").then((r) => r.json());
      if (!grant) throw new Error("no_grant");
      const secret = await unwrapSecret(kek, grant.wrapped_secret, grant.iv);
      const keypair = keypairFromSecret(secret);
      setKp(keypair);
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
    } finally {
      setBusy(false);
    }
  }, [deriveGlobalKek]);

  return {
    initialise,
    unlock,
    busy,
    locked: kp === null,
    openedCount: entries?.length ?? 0,
    failedCount,
    canSign: !!signMessage,
  };
}
