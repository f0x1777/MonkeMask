# 0001. Vault and Trust Models: ZK Personal Vault vs. Server-Readable Global Match Index

**Date**: 2026-06-01
**Status**: Proposed

---

## Context

MonkeMask is evolving from a stateless ephemeral tool into a platform with two
distinct persistence capabilities:

**A — Personal vault.** A logged-in user stores their own monke library and
named face-to-monke associations across sessions. All data is attributed to a
single user, encrypted client-side, and read back only by that user.

**B — Global match index.** At community events, opted-in members are
automatically recognised in group photos and their monke is placed without
manual pairing. This requires a similarity search over embeddings from
potentially hundreds of members simultaneously.

These two capabilities have irreconcilable privacy requirements if we attempt
to implement them under a single model. The decision being recorded here is:
**how to handle encryption and trust for each**, and **why the same model
cannot serve both**.

### The zero-knowledge option (client-side encryption, no server reads)

For feature A, a wallet-signature-derived encryption key (KEK = HKDF of the
user's ed25519 signature over a fixed message) wraps a random DEK. The DEK
encrypts the vault JSON. Only the user — possessing the wallet — can reproduce
the KEK and unlock the vault. The server stores only opaque ciphertext. This
is genuinely zero-knowledge from the server's perspective.

For feature B, zero-knowledge would mean: each member's face embedding is
encrypted under their own KEK and stored as ciphertext on the server. At
event-processing time, when a new face arrives, we need to compare it against
all enrolled members' embeddings. With each member's embedding encrypted under
their own key, the server cannot perform this comparison at all. The only
options would be:

1. Decrypt all enrolled members' embeddings server-side → not ZK.
2. Route the query to each member's device for local comparison → requires
   all members to be online simultaneously, adds P2P infrastructure, adds
   latency proportional to community size, is architecturally fragile.
3. Use cryptographic techniques that allow matching on ciphertext (homomorphic
   encryption, Private Set Intersection) → prohibitive compute cost at
   community scale in 2026.
4. Use a Trusted Execution Environment (TEE) where embeddings are decrypted
   inside a hardware-attested enclave → requires dedicated server hardware
   not available on Railway, adds attestation chain complexity.

None of these alternatives are viable for v1. Options 3 and 4 are documented
as future paths (see Alternatives below).

### The determinism dependency

The ZK vault design relies on the ed25519 signature over the fixed vault
derivation message being stable across sessions and devices: same wallet,
same message → same 64-byte signature → same KEK. RFC 8032 §5.1.6 specifies
that ed25519 signatures are deterministic (no random nonce). Major browser
wallets (Phantom, Solflare, Backpack) comply with this. However:

- Ledger hardware wallets may not support `signMessage` on all firmware
  versions, and determinism on the Solana app has not been confirmed in
  testing as of this writing.
- A key-derivation design built on this property must validate it explicitly
  before committing user data to the vault. A single non-deterministic result
  means the KEK changes, the DEK cannot be unwrapped, and the vault is
  permanently inaccessible.
- The vault design therefore includes a mandatory determinism check on
  first-use (sign the derivation message twice, compare byte-for-byte) that
  blocks vault creation if the results differ.

### The legal dimension

ArcFace embeddings derived from a face image are biometric data under GDPR
Art. 9, Illinois BIPA, and Argentina Ley 25.326. Processing them in a
server-readable index (as required for feature B) is the highest-risk category
of data processing in this system. This is not a reason to abandon B — the
community value of automated event coverage is real — but it means B must be:

- Strictly opt-in, with per-person explicit consent.
- Isolated from the ZK personal vault (a single data model compromise would
  otherwise put both at risk).
- Subject to a DPIA before production launch.
- Designed with deletion as a first-class operation (not an afterthought).

Keeping the two stores separate ensures that the ZK guarantee of the personal
vault is not weakened by the existence of the server-readable global index.

---

## Decision

We will implement **two separate stores with two separate trust models**:

### Store 1 — Zero-knowledge personal vault

- Scope: personal monke library, named face-to-monke associations, ArcFace
  embeddings the user has produced for their own contacts.
- Encryption: client-side, AES-256-GCM, DEK wrapped under KEK derived from
  wallet signature via HKDF-SHA256.
- Server knowledge: ciphertext blob + wrapped DEK only. No plaintext, no KEK,
  no DEK ever reaches the server.
- Face matching: client-side only. After vault unlock, the browser compares
  the query embedding against the user's stored association embeddings using
  cosine similarity.
- Access control: Postgres RLS restricts all reads to the owning user. Admins
  have access to a metadata-only view; `ciphertext` and `wrapped_dek` columns
  are excluded from all admin-accessible views and API endpoints.
- Trust: the server is explicitly untrusted for vault contents. Even a
  fully-compromised Supabase instance yields only opaque bytes.

### Store 2 — Consented global match index

- Scope: ArcFace embeddings of members who have explicitly opted into the
  global registry for the purpose of automated event coverage.
- Encryption: AES-256-GCM with a server-managed key stored in Supabase Vault
  (envelope-encrypted at the application layer); plaintext pgvector column
  (`pgv_embedding`) for ANN search; wrapped copy (`wrapped_embedding`) for
  audit/recovery.
- Server knowledge: the server can read `pgv_embedding` in plaintext. This
  is an accepted, disclosed limitation. It is mitigated by access controls
  (service-role-only access, RLS preventing direct user queries), audit
  logging on all reads, and the consent model.
- Face matching: server-side pgvector HNSW approximate nearest-neighbour
  search at event-processing time.
- Access control: RLS prevents any user (including admins) from querying
  this table via the Supabase client. Only the backend service role may read
  embeddings, and only during event processing.
- Trust: the server IS trusted for this store. Members who do not trust the
  platform operator with their biometric data should not enroll in the global
  registry. This must be stated plainly in the consent dialog.

### Separation guarantee

The two stores are separate Postgres tables with no foreign-key relationship
between them (beyond the `user_id` join to the `users` table). The application
layer has no code path that reads from the personal vault and writes to the
global index, or vice versa. An audit of the backend code must verify this
before Phase 4 ships.

---

## Consequences

### What becomes easier

- The personal vault achieves genuine zero-knowledge with straightforward
  crypto (standard HKDF + AES-GCM; no exotic primitives).
- The global index achieves community-scale ANN search with pgvector (mature,
  well-understood, already available in Supabase).
- Legal compliance for the global index is tractable: a consent model over a
  defined, isolated store is easier to reason about and audit than a hybrid.
- Feature A (personal vault) can ship independently of B (global registry),
  with no dependency on the DPIA.
- The existing ephemeral flow is unchanged; there is no regression risk to the
  "deleted right after" promise for anonymous users.

### What becomes harder

- Two stores = two code paths for embedding storage and retrieval. More surface
  area to keep in sync (especially around deletion cascades).
- The ZK property of the personal vault introduces a permanent user-education
  burden: "lose your wallet, lose your vault" is a concept most web users have
  no mental model for. Onboarding UX must be carefully designed.
- The determinism dependency on wallet implementations is a fragility. If a
  future wallet update changes `signMessage` behaviour, users of that wallet
  lose their vaults. The determinism check on setup catches this before data
  is committed, but it is an ongoing operational concern.
- Backup purge for the global index (required for right-to-erasure compliance)
  is operationally non-trivial with Supabase's standard backup approach. A
  backup strategy that supports selective purge must be in place before B ships.

### Risks accepted

- A compromised Supabase service-role credential gives read access to all
  `pgv_embedding` values in the global index. This is mitigated by access
  controls and audit logging but not eliminated. Members consent to this risk
  explicitly.
- ArcFace embedding inversion (reconstructing an approximate face image from
  an embedding) is theoretically possible. We accept this risk for v1 on the
  basis that: (a) current inversion attacks require significant compute and
  produce low-fidelity outputs; (b) the embedding is never exposed to the
  enrolling member or any other user; (c) only backend service role can read it.
  This risk should be re-evaluated if inversion techniques improve materially.
- The ZK vault provides no protection against a user whose wallet is
  compromised. Application-layer security ends at the wallet boundary.

---

## Alternatives considered

### A1 — Single ZK model for both A and B (federated on-device matching)

Each member's embedding is encrypted under their own KEK. At event time, the
backend sends each detected face crop to each member's registered device for
local comparison, aggregates responses.

**Why rejected:** requires all N members to be online simultaneously during
event processing (N can be hundreds). Adds P2P coordination infrastructure with
no existing open-source reference implementation for this use case. Latency is
O(N) network round-trips. A single offline member means their face is missed.
Fragile and impractical for live event use. Document as a potential v3 direction
if the community strongly favours it over the server-readable model.

### A2 — Homomorphic encryption for similarity search

Embeddings are stored as HE ciphertexts. The server computes approximate
nearest-neighbour over HE ciphertexts without decrypting.

**Why rejected:** state-of-the-art FHE (CKKS scheme, which supports floating-
point approximate arithmetic suitable for cosine similarity) adds 3–4 orders of
magnitude of compute overhead per comparison. A 512-dimension cosine similarity
that takes ~1 microsecond in plaintext takes ~10 milliseconds with CKKS at
usable security levels. For 500 enrolled members × N faces per event photo, the
latency becomes seconds to tens of seconds per event photo. Unacceptable for
interactive use. Revisit when HE accelerator hardware (e.g., Intel HERACLES,
Zama Concrete GPU backend) becomes accessible on standard cloud VMs.

### A3 — Trusted Execution Environment (AWS Nitro Enclave / Azure Confidential VM)

Embeddings are encrypted under an enclave-attested key. Matching runs inside
the TEE; results are returned without the server operator seeing the inputs.

**Why rejected:** requires dedicated server instances (not available on Railway,
the current backend host). Adds enclave attestation chain management (rotate
attestation certificates, verify PCR values on each deploy). Increases deploy
complexity substantially. This is the most technically sound alternative; it is
deferred as a Phase 4+ upgrade path if the community demands TEE-grade privacy
for the global index. The separation of stores in this decision is designed to
make a future TEE migration of the global index feasible without touching the
personal vault.

### A4 — No global index; require manual pairing for all event photos

Keep the existing manual pairing flow; provide personal vault auto-suggest but
no community-level matching.

**Why rejected:** this does not address the stated goal of "automatic event
coverage at community scale." The use case (200-person group photo → fully
masked in one pass) requires matching against a community-wide index. Without
it, the platform provides incremental improvement for individuals but no step
change for event organisers.

### A5 — Fully server-readable model for everything (no ZK personal vault)

Encrypt vault at rest with server-managed keys; admins can technically decrypt
if required.

**Why rejected:** this would contradict the platform's core privacy promise.
A wallet-holding crypto community has high sensitivity to server-side key
custody. The ZK property is a differentiator and a trust signal. The technical
cost of implementing it for the personal vault (standard HKDF + AES-GCM) is
low relative to the trust value it provides. Server-side key custody for
personal vaults is not acceptable.

---

## Future upgrade paths

These are explicitly out of scope for v1 but should be considered when
re-evaluating the trust model:

- **TEE migration for global index (A3):** if Railway or a replacement host
  offers Nitro Enclaves or TDX VMs, migrating the global index ANN search
  into a TEE is the highest-value privacy upgrade for B.
- **Federated matching (A1):** if the community prioritises ZK for B over
  availability guarantees, federated on-device matching is revisitable when
  a reliable P2P coordination layer (e.g., a Solana program or a libp2p mesh)
  is in place.
- **HE (A2):** revisit when HE accelerator hardware is accessible on standard
  cloud infrastructure and per-comparison latency drops to sub-millisecond
  range.
- **Wallet recovery / social recovery:** if the "lose wallet = lose vault" UX
  is unacceptable to a significant fraction of users, social recovery (e.g.,
  Shamir secret sharing with trusted guardians) could provide a recovery path
  without server-side key escrow. This would require a new ADR.

---

## References

- Spec: `docs/specs/member-vault-platform.md`
- RFC 8032 §5.1.6 (ed25519 determinism): https://www.rfc-editor.org/rfc/rfc8032
- RFC 5869 (HKDF): https://www.rfc-editor.org/rfc/rfc5869
- pgvector HNSW: https://github.com/pgvector/pgvector
- CKKS HE scheme: Cheon et al., "Homomorphic Encryption for Arithmetic of
  Approximate Numbers", ASIACRYPT 2017
- ArcFace embedding inversion: Shahreza & Marcel, "Face Reconstruction from
  Deep Facial Embeddings", 2022 (IJCB)
- Intel TDX confidential VMs: https://www.intel.com/content/www/us/en/developer/tools/trust-domain-extensions/overview.html
- Zama Concrete (TFHE accelerator): https://github.com/zama-ai/concrete
