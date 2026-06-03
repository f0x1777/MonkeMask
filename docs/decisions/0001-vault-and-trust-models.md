# 0001. Vault and Trust Models: Closed Allowlist + Envelope-Encrypted Country/Global Keys + Client-Side Matching

**Date**: 2026-06-01
**Status**: Accepted (revised 2026-06-01 — supersedes the Proposed draft)

---

## Context

MonkeMask is evolving from a stateless ephemeral tool into a platform with two
distinct persistence capabilities:

**A — Per-country roster.** A Local Ambassador builds and maintains a database
of faces and their SMB associations for their own country. All data is
country-scoped, encrypted client-side, and readable only by ambassadors of
that country.

**B — Promoted global registry.** At multi-country events, a `super_admin` can
promote selected country data to a global registry accessible only to
`global_admin` wallets. Global admins use this for cross-country event coverage.

The original (Proposed) draft of this ADR described two separate trust models:
a zero-knowledge personal vault (per-user DEK wrapped under per-user KEK) and
a server-readable global match index using pgvector for ANN search. The key
architectural tension was: server-side ANN search requires plaintext embeddings
in the database, which cannot be zero-knowledge.

The operator has since made several decisions that reshape the model materially:

1. **Closed access.** The platform is gated to a fixed allowlist of ~20-30
   Solana wallets (Local Ambassadors). This is not open signup, not holder-
   gating, not a public community registry. The access group is known,
   vetted, and small.

2. **The closed access group resolves the pgvector trade-off.** With a small,
   closed access group, the per-country and global embedding sets are small
   (hundreds to a few thousand 512-dim float32 vectors = a few MB). A linear
   cosine-similarity scan in the browser over this dataset takes under 10ms
   on modern hardware. There is no performance justification for server-side
   ANN search, and therefore no reason to store plaintext embeddings in Postgres.
   The "plaintext embeddings in pgvector" risk documented in the prior draft is
   **eliminated** in this revision.

3. **Country-scoped encryption replaces per-user vaults.** Rather than one vault
   per user (which requires individual key management for every ambassador
   independently and does not support the "any ambassador in a country can read
   their country's data" requirement), the model uses per-country symmetric keys
   (CK) envelope-wrapped to each ambassador of that country. This is simpler:
   ~20-30 wallet keys total, N country keys (N = number of countries, likely
   2-5 at launch), and 1 global key. The server holds no plaintext at any layer.

4. **No formal DPIA gate.** The operator explicitly accepts the biometric data
   processing risk given the closed, trusted-ambassador access model and
   community context. The prior draft had a hard DPIA blocker before the global
   registry launched; this is removed.

### The determinism dependency (unchanged from prior draft)

The entire key derivation chain depends on `wallet.signMessage(message)`
producing the same 64-byte ed25519 output on every call for the same wallet
and message. RFC 8032 §5.1.6 specifies deterministic ed25519. Major browser
wallets (Phantom, Solflare, Backpack) comply. Ledger hardware wallet determinism
on the Solana app is unconfirmed as of this writing. The implementation
validates determinism explicitly before any key material is committed (sign
twice, compare byte-for-byte; block if they differ). This is the first task in
the implementation plan and is a gate for all subsequent work.

### The "removed ambassador retains data" accepted risk

CK rotation (generating a new CK, re-wrapping for remaining ambassadors,
re-encrypting the roster blob) prevents a removed ambassador from accessing
the country data after removal. However, it cannot recall data already
decrypted and held in their browser or downloaded during active sessions.
This is an accepted residual risk, appropriate for a trusted-ambassador model
where vetting occurs before allowlist addition.

---

## Decision

We implement a **single, unified encryption model** for both the per-country
roster and the global registry:

### Envelope encryption with per-country and per-global symmetric keys

- **Country Key (CK):** a random 32-byte AES-256-GCM key generated once per
  country by the `super_admin`. CK encrypts the country's roster JSON blob.
  CK is envelope-wrapped (AES-256-GCM) to each ambassador's KEK. KEK is derived
  HKDF-SHA256 from the ambassador's wallet signature over a fixed derivation
  message.

- **Global Key (GK):** a random 32-byte AES-256-GCM key generated once by the
  `super_admin`. GK encrypts the global registry blob. GK is envelope-wrapped
  to each `global_admin`'s KEK.

- **No per-user personal vaults.** The prior design had personal vaults (per-user
  DEK + wrapped DEK) that stored individual user's monke libraries and
  associations. This is replaced by the country-roster model: ambassador
  associations are stored in their country's encrypted blob. The monke library
  cache is a non-sensitive metadata table (RLS-restricted to the owning wallet)
  with no encryption requirement.

### Client-side matching exclusively

All ArcFace cosine-similarity matching happens in the browser after the key
holder (ambassador or global_admin) decrypts their scope. The server never
receives a plaintext embedding query, never stores a plaintext embedding, and
never performs a similarity computation.

This is viable because:
- The access group is ~20-30 wallets.
- Per-country embedding sets: at most a few hundred entries per country.
- Global registry: at most a few hundred to a few thousand entries across all
  countries.
- Linear scan over 1,000 × 512-float32 vectors in JavaScript: ~2ms.
- There is no scale requirement that demands server-side ANN.

### pgvector: installed but unused for v1 matching

The `pgvector` extension is installed on the Supabase project (`monkemask-v2`,
São Paulo). It is NOT used for matching in v1. The `pgvector` columns that
appeared in the prior draft's `global_embeddings` table do not exist in this
design. `pgvector` is preserved as available-but-deferred for potential future
use (e.g., deduplication tooling, model-migration analytics).

### Separation guarantee

The `/` ephemeral flow and the `/v2` platform are separate route groups in the
same Next.js application. They share no data model, no API routes, and no
encryption primitives. The ephemeral flow has no dependency on the allowlist,
wrapped_keys, or encrypted roster tables. This separation ensures the "deleted
right after" privacy promise of the ephemeral flow is not weakened by the
existence of the platform layer.

---

## Consequences

### What becomes easier

- **No plaintext biometrics in the database.** A compromised Supabase
  service-role credential, database dump, or Supabase employee with console
  access sees only opaque AES-GCM ciphertext. This is a materially stronger
  security posture than the prior draft's accepted "pgvector plaintext" risk.
- **Simpler key management.** ~20-30 wrapped-key rows total (one per
  wallet-scope combination), versus hundreds or thousands of per-user vault rows
  if the platform had open signup. Rotation is tractable: a CK rotation touches
  a handful of wrapped_keys rows and one roster blob.
- **No DPIA gate.** The closed access model allows the operator to launch without
  a formal DPIA sign-off.
- **Personal vault (ZK per-user DEK model) is removed.** This reduces codebase
  complexity and eliminates the "lose wallet = lose vault" UX problem that
  required significant mitigation in the prior design.
- **Feature A (per-country roster) and Feature B (global registry) ship under
  the same trust model.** No architectural split between "ZK personal vault"
  and "server-readable global index."

### What becomes harder

- **Key rotation on ambassador removal is a manual super_admin action.** There
  is no automated rotation on wallet removal today. Until the admin panel is
  built (Phase 4), the super_admin must perform this operation manually. A
  removed ambassador retains access until rotation completes.
- **Country blob is all-or-nothing per-country.** All ambassadors of a country
  share the same CK and see the same roster. Fine-grained per-record access
  control within a country is not provided in v1.
- **Deletion requires re-encryption of the entire roster blob.** Unlike a row
  deletion in a plaintext table, removing one association requires: decrypt the
  blob, remove the record, re-encrypt, write back. This is a more involved
  deletion SLA but is manageable at the expected data sizes.
- **The determinism dependency remains fragile.** A wallet firmware update that
  changes `signMessage` behaviour will break all key derivation for affected
  ambassadors. The determinism check on first use catches this before data is
  committed, but it is an ongoing operational concern. If an ambassador's wallet
  becomes non-deterministic after onboarding (firmware update), their CK
  becomes unrecoverable through that wallet without a super_admin re-wrap using
  a backup mechanism not yet designed.

### Risks accepted

- **A removed ambassador retains any data they already decrypted.** CK rotation
  prevents future access, but past sessions are not retractable. Acceptable for
  a vetted-ambassador model.
- **super_admin wallet compromise is catastrophic.** The super_admin wallet has
  access to all wrapped keys (or the ability to add new ones), controls the
  allowlist, and can promote data to the global registry. The super_admin wallet
  is the highest-value target. Hardware wallet (Ledger) or multi-sig for the
  super_admin role should be evaluated before Phase 4.
- **Client-side matching scale ceiling.** The design is optimal for a few hundred
  entries per scope. If the global registry grows to tens of thousands of entries,
  the linear scan may become a UX bottleneck (>100ms). At that point, a chunked
  or indexed approach would be needed. For v1 this is not a concern.
- **Informal consent for event attendees.** The subjects whose biometric data
  is most sensitive (event attendees whose faces are in photos) are not
  necessarily wallet holders and cannot self-service consent in the app. The
  operator accepts responsibility for the informal consent mechanism (event
  signage, community norms). The in-app `consent_records` table provides
  traceability.

---

## Alternatives considered

### A1 — Retain the per-user ZK vault model from the prior draft

Each ambassador has their own DEK + wrapped DEK (as in the prior draft). The
global index uses pgvector with server-readable plaintext embeddings.

**Why rejected:** (a) The personal vault model does not support the
"any ambassador in a country shares a roster" requirement — each ambassador
would have a separate vault with separate embeddings, making country-level
deduplication and sharing impossible without a new sharing mechanism.
(b) Server-readable pgvector embeddings were an accepted risk in the prior
draft, but with the closed access model, client-side matching eliminates that
risk at no cost. (c) Per-user vaults add complexity (N vault rows, N wrapped
DEKs, vault migration UX) that is unnecessary when the access group is fixed.

### A2 — Single shared symmetric key for everything (no per-country scoping)

One global CK shared by all ambassadors. Simpler key distribution; any
ambassador can read all data from all countries.

**Why rejected:** this eliminates the country-scoping requirement that is
explicit in the operator's decisions. Ambassadors should see only their own
country's data. A single shared key would give every ambassador full read
access to every other country's roster, which is not acceptable.

### A3 — Server-side encryption with operator-managed keys (no client-side crypto)

Encrypt at rest with Supabase Vault or a KMS key managed by the operator.
Matching could be server-side.

**Why rejected:** this gives the operator (and anyone with access to the KMS)
the ability to read all biometric data. The prior draft accepted this for the
global index but it was explicitly an accepted risk. With the closed access
model and small dataset, client-side encryption at no practical performance
cost is strictly better. Server-readable biometrics is not needed and not
acceptable.

### A4 — Threshold signatures or multi-party key derivation

Require M-of-N ambassador signatures to unwrap a CK (e.g., Shamir Secret
Sharing). Stronger protection against single-wallet compromise.

**Why deferred:** substantially more complex to implement and UX-unfriendly
for a tool used at live events (requiring multiple ambassadors to be online
simultaneously to decrypt). Not needed for v1 given the vetted-ambassador
trust model. Document as a post-v1 upgrade path if the operator decides
single-ambassador CK access is too risky.

### A5 — Retain pgvector for server-side matching alongside client-side encryption

Store embeddings both encrypted (client-accessible) and in pgvector (server-side
ANN search). Dual representation, maximum flexibility.

**Why rejected:** the dual representation re-introduces the plaintext biometrics
risk that the closed-allowlist + client-side design eliminates. There is no
performance need for server-side ANN at the expected dataset size. The complexity
cost of maintaining two stores outweighs any benefit.

---

## Future upgrade paths

- **Multi-sig or threshold custody for CKs:** if the vetted-ambassador model
  expands or risk tolerance decreases, M-of-N threshold unwrapping (e.g.,
  SLIP-39 or Shamir) could replace single-wallet CK wrapping.
- **TEE-based global matching:** if the global registry grows to a size where
  client-side linear scan is too slow, and server-side ANN is needed, a Trusted
  Execution Environment (AWS Nitro Enclave, Intel TDX) could host the matching
  without exposing plaintext embeddings to the operator. The current ciphertext
  storage format is compatible with this upgrade path.
- **Federated/P2P matching:** if the community later demands ZK properties even
  for event matching involving external participants, federated on-device
  matching (each ambassador's device participates in the match locally) is
  revisitable. The per-country roster model is compatible: each ambassador's
  device holds the decrypted country roster and can respond to a match query.
- **Wallet recovery for ambassadors:** if an ambassador loses their wallet
  (and therefore cannot re-derive their KEK to unwrap CK), the super_admin can
  generate a new wrapped_CK entry for the new wallet, but the lost wallet's
  previous wrapped_CK entry is revoked. A social recovery or hardware backup
  protocol should be documented in ambassador onboarding.

---

## Addendum — Global registry (sealed box) and why the key is not on-chain

The global registry lets ambassadors WRITE face↔monke associations that only
global_admins can READ. We use an anonymous public-key sealed box (nacl.box,
X25519 + XSalsa20-Poly1305):

- One global box keypair. The PUBLIC key is published; any authenticated
  ambassador seals `{embedding, monke cutout}` to it and inserts the ciphertext.
  Sealing needs no secret, so ambassadors contribute without ever being able to
  read the registry.
- The SECRET key is held only by global_admins. Each admin's copy is wrapped
  (AES-256-GCM) under a KEK derived from their wallet signature over a dedicated
  message (`GLOBAL_KEK_DERIVATION_MESSAGE`) — the same envelope pattern as the
  country vault, so "vault access with that key" is literally a wallet signature.

**Why not on-chain?** A secret cannot live on-chain — all on-chain data is
public, so an on-chain private key would be world-readable. On-chain can only
ever hold the *public* half and, optionally, the *membership set* (which wallets
are global_admins) as a tamper-evident allowlist. That is a possible future
hardening; it does not change the off-chain custody of the secret.

**super_admin sees counts, not faces.** The `country` column is plaintext, so
super_admin (and global_admins) read per-chapter COUNTS via `/api/v2/global/stats`
without holding the secret key. super_admin is deliberately excluded from the
grant and the sealed entries — it onboards admins but cannot decrypt faces.

**Least privilege:** the country CK is unwrapped NON-extractable (encrypt/decrypt
only); only the global box secret is unwrapped extractable, because its raw 32
bytes must rebuild the nacl keypair.

**Open follow-ups (tracked):**
- *Multi-admin enrollment.* A second global_admin cannot self-init (no secret).
  Enrollment uses an ephemeral sealed handshake between global_admins (newcomer
  publishes an ephemeral box public key; an existing admin seals the secret to it;
  the newcomer re-wraps under their own wallet KEK). super_admin cannot be the
  escrow because it must not read faces.
- *Re-keying* on ambassador/global_admin removal (rotate CK / box keypair, re-encrypt).

## References

- Spec: `docs/specs/member-vault-platform.md`
- RFC 8032 §5.1.6 (ed25519 determinism): https://www.rfc-editor.org/rfc/rfc8032
- RFC 5869 (HKDF): https://www.rfc-editor.org/rfc/rfc5869
- WebCrypto AES-GCM + HKDF: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto
- ArcFace embedding inversion: Shahreza & Marcel, "Face Reconstruction from
  Deep Facial Embeddings", 2022 (IJCB)
- Intel TDX confidential VMs: https://www.intel.com/content/www/us/en/developer/tools/trust-domain-extensions/overview.html
