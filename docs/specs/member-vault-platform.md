# Member Vault Platform

**Status**: Draft
**Owner**: operator
**Created**: 2026-06-01
**Branch**: feature/member-vault-platform (off staging)

---

## Problem

MonkeMask is today a stateless, ephemeral tool: upload a group photo, pair
faces with monkes, download the result, photo gone in ~35 minutes. The privacy
promise ("100% private, deleted right after") is the product's core trust
signal and must not be broken.

That stateless flow has a ceiling. Community members who attend multiple events
must re-pair every face every time. There is no way for a member to declare
"my face goes with this monke" once and have it apply automatically at the next
MonkeDAO event. There is no way for an event photographer to upload a 200-person
group shot and get it masked in one pass without manual labour.

Three gaps motivate this evolution:

1. **Personal continuity.** A logged-in user should maintain their own monke
   library (derived from on-chain holdings) and their own named associations
   (face → monke, e.g., "Alice → MonkeSMB #4721") so re-use is instant across
   sessions — without any of that data being readable by anyone but them.

2. **Community-scale automation.** At MonkeDAO events, opted-in members should
   be recognised automatically in group photos so their monke is placed without
   manual pairing. This is community-scale face recognition; it requires a
   server-side similarity index and therefore has a fundamentally different
   privacy profile than the personal vault.

3. **Operational oversight.** As the platform grows, admins need tooling to
   manage members, monkes, events, consent records, moderation requests, and
   deletions — with full audit trails and zero ability to read personal vaults.

---

## Goals

- Keep the ephemeral, anonymous flow as the **default**. Arriving without
  a wallet must work exactly as today.
- Add an **opt-in account layer** (wallet-based identity) that unlocks personal
  library, associations, and — separately opted into — global registry.
- ZK personal vault: the server stores only ciphertext the operator cannot
  read, even under subpoena or database breach.
- Consented global match index: members who want automatic event coverage
  give explicit, revocable biometric consent; the index is access-controlled,
  encrypted at rest, and fully deletable.
- Admin panel with role separation and audit logging.
- All biometric data handling must be compliant enough to deploy to
  international events (Argentina PDP / GDPR / US BIPA awareness, DPIA
  recommended before B ships).

## Non-goals

- Replacing the ephemeral flow. Anonymous use remains first-class.
- Implementing homomorphic encryption, secure enclaves (TEE), or on-device
  federated matching for v1. These are documented as future paths in the ADR.
- Hosting SMB trait layer assets. Background removal is done programmatically
  from metadata.
- Social features (feeds, follows, comments).
- Monetisation / payment flows.
- Mobile native app.

---

## Acceptance Criteria

- [AC-1] An unauthenticated visitor can complete the full mask-and-download
  flow with no account prompt and no data persisted beyond the existing 35-min
  TTL.
- [AC-2] A wallet-connected user can derive their monke library from on-chain
  holdings without manually uploading images.
- [AC-3] A wallet-connected user's named associations are stored encrypted such
  that decrypting the ciphertext in the database without the user's wallet
  signature is computationally infeasible.
- [AC-4] Re-connecting the same wallet in a new browser session restores the
  full vault (library + associations) with no server-side decryption.
- [AC-5] A member who has opted into the global registry is recognised in an
  event photo and their monke is placed automatically; consent record is
  retrievable by the member and by admins.
- [AC-6] A member can delete their global-registry enrollment; within 72 hours,
  their embedding row is hard-deleted from the match index, any backups are
  flagged for purge, and the deletion is audit-logged.
- [AC-7] An admin can view consent records, manage members and events, and
  trigger moderation actions, but cannot decrypt any personal vault ciphertext.
- [AC-8] All biometric data writes to the global registry are preceded by a
  logged, versioned consent record with timestamp and consent text hash.
- [AC-9] Wallet determinism is validated on vault setup: the app signs a test
  message twice and compares; setup is blocked if the results differ, with a
  clear error explaining the risk.
- [AC-10] False-match handling: when the global registry returns a match below
  a configurable similarity threshold, the face falls back to manual pairing
  rather than auto-placing a wrong monke.

---

## Dual-Mode Model

### Ephemeral (default — no change)

The user arrives, uploads a photo, pairs faces, downloads the PNG. The backend
processing pipeline (`monkepic`) runs unchanged. The TTL sweep deletes the
photo and any server-side intermediate data after ~35 minutes. No user record
is created, no cookies set beyond a transient session token for the request
lifecycle, no embeddings stored.

This mode is the landing experience and must not degrade in latency, UX, or
privacy properties.

### Account (opt-in)

A wallet-connect button in the UI initiates the SIWS flow (see below). After
authentication:

- The user's monke library is loaded (from holdings) or shown empty.
- The vault is unlocked in-browser (see vault flow below).
- The active pairing session can read from the vault's associations to
  auto-suggest pairings.
- The user may save new associations back to the vault.
- The user may separately choose to enroll in the global registry (a second,
  distinct consent step — distinct from account creation).

Switching back to anonymous: the user disconnects their wallet. The tab returns
to ephemeral mode. No local state persists after disconnect beyond the
browser's standard session scope.

---

## Identity and Authentication: Wallet + SIWS

### Auth flow

1. UI requests wallet connection (Phantom, Solflare, Backpack, Ledger).
2. Backend generates a nonce (32 bytes, stored with a 5-minute TTL in Redis /
   Supabase ephemeral table).
3. UI constructs a SIWS-style message:

   ```
   mmonkemask.io wants you to sign in with your Solana account:
   <wallet_pubkey_base58>

   By signing, you authenticate to MonkeMask. This request will expire at
   <ISO-8601 timestamp>.

   Nonce: <hex-nonce>
   ```

4. Wallet signs the message; UI sends `{pubkey, signature, nonce}` to
   `/api/auth/verify`.
5. Backend verifies the ed25519 signature against the message (using
   `@noble/ed25519` or equivalent). On success, mints a short-lived JWT
   (15-minute access token + 7-day refresh token, stored httpOnly Secure
   SameSite=Strict cookie). Nonce is consumed.
6. Supabase Auth row is upserted: `users(wallet_pubkey, created_at,
   last_seen_at)`. No email, no password.

### Replay protection

The nonce is single-use and has a 5-minute TTL. A replayed signature against
an already-consumed nonce is rejected. The message includes the origin domain
to prevent cross-origin replay. JWTs are short-lived; refresh tokens are
rotated on use.

### Wallet support matrix

| Wallet | `signMessage` support | ed25519 determinism | Notes |
|---|---|---|---|
| Phantom (browser ext) | Yes | Yes (RFC 8032) | Primary target |
| Solflare (browser ext) | Yes | Yes | Primary target |
| Backpack (browser ext) | Yes | Yes | Primary target |
| Ledger (hardware) | Conditional | Needs verification | `signMessage` requires Ledger Live app ≥ 2.x + Solana app ≥ 1.3; determinism unconfirmed — see open questions |
| WalletConnect bridge | Yes | Dependent on wallet | Test per wallet |

---

## Vault: Zero-Knowledge Personal Store

### Design principle

Supabase (and therefore the operator) must never see a plaintext vault. This is
achieved by deriving the encryption key entirely from the user's wallet
signature, which never leaves the client.

### Envelope encryption

```
[Browser only]
  wallet.signMessage(VAULT_DERIVATION_MESSAGE)
    → raw_signature (64 bytes, ed25519)
    → KEK = HKDF-SHA256(ikm=raw_signature, salt="MonkeMask-Vault-v1", info="KEK", len=32)

[On vault creation]
  DEK = crypto.getRandomValues(32 bytes)         // random per vault
  ciphertext = AES-256-GCM(DEK, plaintext_json)  // iv: 12 random bytes, prepended
  wrapped_DEK = AES-256-GCM(KEK, DEK)            // iv: 12 random bytes, prepended

[Stored in Supabase: vaults table]
  { user_id, ciphertext, wrapped_dek, version, updated_at }

[On vault unlock]
  re-sign VAULT_DERIVATION_MESSAGE → same signature → same KEK
  DEK = AES-256-GCM-Decrypt(KEK, wrapped_DEK)
  plaintext_json = AES-256-GCM-Decrypt(DEK, ciphertext)
```

`VAULT_DERIVATION_MESSAGE` is a fixed string stored in the client codebase,
versioned, never changes after v1 launch. Any change = all users lose their
vaults. It must be treated like a schema migration.

### What the vault contains (plaintext_json schema)

```json
{
  "schema_version": 1,
  "monke_library": [
    {
      "token_mint": "...",
      "label": "My main monke",
      "transparent_png_b64": "...",   // cached cutout, client-derived
      "metadata_snapshot": { ... }
    }
  ],
  "associations": [
    {
      "id": "uuid",
      "label": "Alice",
      "arc_face_embedding": [...],    // 512-float32 vector, base64-encoded
      "monke_token_mint": "...",
      "created_at": "ISO-8601",
      "updated_at": "ISO-8601"
    }
  ]
}
```

The `arc_face_embedding` stored here belongs to the user and is encrypted. It
is never sent to the server in plaintext. Personal face matching runs
client-side after vault decryption: load the embedding → compare cosine
similarity against detected embeddings in the current photo → auto-suggest
pairings, threshold-gated.

### Re-key flow

If a user wants to change the DEK (e.g., after a suspected local compromise):

1. Unlock vault (old KEK → unwrap old DEK → decrypt plaintext).
2. Generate new DEK.
3. Re-encrypt plaintext with new DEK.
4. Re-wrap new DEK with same KEK (or new KEK if wallet was changed — see below).
5. Write new `{ciphertext, wrapped_dek}` to `vaults` in a single transaction
   with optimistic locking on `version`.

Wallet migration (user switches to a different wallet): this is equivalent to a
full re-key with a new KEK. The old wallet must sign once to decrypt; the new
wallet signs to produce the new KEK; the re-wrapped vault is written. This
operation REQUIRES both wallets to be active simultaneously and is a deliberate
UX ceremony.

### Data-loss risk and mitigations

**The core risk:** `lost wallet = unrecoverable vault`. There is no server-side
key escrow. This is the trade-off for zero-knowledge.

Mitigations:

| Mitigation | What it does | Trade-off |
|---|---|---|
| Determinism check on setup | Signs test message twice, compares; blocks setup if results differ | Catches non-deterministic wallets before any data is written |
| Explicit loss warning in UX | "If you lose access to this wallet, your vault is permanently unrecoverable. No reset option exists." | User friction; essential |
| Encrypted key export | User can export `wrapped_dek` encrypted under a user-supplied passphrase for cold storage | Passphrase loss = same outcome; documented clearly |
| Vault version history (Supabase Storage) | Keep last N versions of the ciphertext blob; protects against accidental overwrite, not key loss | Storage cost, not a key-recovery mechanism |
| Graceful vault-not-found path | If vault row missing (new device, new wallet), offer fresh vault creation; never silently overwrite | |

There is intentionally no "forgot my wallet" recovery path. This must be stated
on the vault setup screen and in docs.

---

## Two Trust Models: Personal Vault vs. Global Match Index

This is the central architectural tension. See ADR-0001 for the full
decision rationale.

### Model A — Zero-knowledge personal vault

- **Who can read plaintext:** the user alone (browser, after signing).
- **Server knowledge:** ciphertext blob + wrapped DEK. Neither is meaningful
  without the KEK.
- **Face matching:** runs entirely client-side. The user's associations
  (embeddings) are decrypted in-browser, then compared locally to embeddings
  extracted from the current photo.
- **Scale:** limited to one user's own associations. Fast, private, no server
  query.
- **Privacy guarantee:** breach of Supabase yields only ciphertext. Admin
  access yields only ciphertext. The zero-knowledge property holds as long as
  the signing key stays with the user.

### Model B — Consented global match index

- **Who can read plaintext:** the server (Supabase service role + backend).
- **Why it must be server-readable:** to match a face in an event photo against
  ALL enrolled members, a pgvector similarity search over the entire embedding
  space is required. The backend cannot decrypt each member's vault in sequence;
  that would be O(N) client-side operations and require every member's wallet to
  be online. The index must be a plaintext (or server-key-encrypted) pgvector
  column.
- **How access is controlled:** RLS + service-role-only write; backend reads
  only at event-processing time; no direct user access to other members'
  embeddings.
- **Consent requirement:** each member's embedding is stored ONLY after explicit
  biometric consent (see Legal section). The consent record is immutable and
  audited.
- **Encryption at rest:** the `global_embeddings` table is in an encrypted
  Supabase project (AES-256 at the storage layer). The embeddings are also
  individually wrapped with a server-managed key (AES-256-GCM, key stored in
  Supabase Vault / environment secret, not in the database). This protects
  against raw storage-media exfiltration but NOT against a compromised
  service-role credential — that is an accepted risk, documented in the threat
  model.
- **Deletion:** hard-delete on request, see AC-6 and Legal section.

### Diagram in prose

```
Personal Vault (ZK)                   Global Match Index (Server-readable)
─────────────────────────────────     ─────────────────────────────────────
User signs VAULT_DERIVATION_MSG       User signs explicit BIOMETRIC_CONSENT_MSG
       ↓                                      ↓
  KEK derived in browser              Consent record written (immutable audit)
       ↓                                      ↓
  DEK unwrapped                       ArcFace embedding extracted server-side
       ↓                                      ↓
  Vault JSON decrypted                Embedding wrapped with server KMS key
       ↓                                      ↓
  Embeddings available client-side    Row inserted: global_embeddings(member_id,
       ↓                                wrapped_embedding, consent_id, expires_at)
  Client cosine-compare against             ↓
  current photo embeddings            pgvector ANN search at event-processing time
       ↓                                      ↓
  Auto-suggest pairings (local)       Auto-place monkes in event photo (server)

Server sees: {ciphertext, wrapped_DEK} Server sees: wrapped embeddings (own key)
```

### Privacy-preserving alternatives considered and deferred

The following approaches could bring B closer to ZK but are out of scope
for v1 due to engineering complexity and operational risk:

- **On-device/federated matching:** each member's wallet holds their own
  embedding; event processing sends face crops to each member's device for
  local comparison. Requires member devices to be online during event
  processing, adds P2P coordination infrastructure, and has latency problems
  for large events. Revisit in v2 if the community demands it.
- **Trusted Execution Environments (Intel TDX, AMD SEV, Nitro Enclaves):**
  embeddings encrypted under an enclave key; matching happens inside the TEE.
  Strong guarantee, but requires dedicated server infrastructure (not available
  on Railway/standard cloud), attestation chain management, and significant
  ops overhead. Document as a post-v1 upgrade path.
- **Private Set Intersection / Homomorphic encryption:** cryptographic
  techniques that allow matching without revealing embeddings. Current SOTA
  has prohibitive per-match compute cost at community scale (hundreds of
  members, potentially seconds per comparison). Not practical for v1.

See ADR-0001 for the full decision record.

---

## Supabase Data Model

### Tables

#### `users`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | Supabase auth UID |
| `wallet_pubkey` | `text` UNIQUE NOT NULL | base58 |
| `created_at` | `timestamptz` | |
| `last_seen_at` | `timestamptz` | |
| `role` | `text` DEFAULT `'member'` | `member` / `moderator` / `admin` |

RLS: `SELECT` own row only. `UPDATE last_seen_at` own row only. Admins: full
select, no update to `role` except via admin service function.

#### `vaults`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → `users.id` UNIQUE | one vault per user |
| `ciphertext` | `bytea` | AES-256-GCM output (iv prepended) |
| `wrapped_dek` | `bytea` | DEK wrapped under user's KEK |
| `schema_version` | `integer` | vault JSON schema version |
| `version` | `integer` | optimistic lock counter |
| `updated_at` | `timestamptz` | |

RLS: `SELECT` / `UPDATE` / `INSERT` own row only. No admin read. The service
role (backend) has no read policy on `vaults.ciphertext` — the backend never
needs to read this column. The only backend operation is to write the blob
returned by the client after client-side encryption.

**Admin access to vaults:** admins can see the vault row exists (metadata:
`user_id`, `updated_at`, `schema_version`) for operational purposes (e.g.,
confirming a user's vault was seeded). They CANNOT read `ciphertext` or
`wrapped_dek`. Enforce this via column-level security in a `vaults_meta` view
that strips those columns, and grant admins access to the view only.

#### `monke_library_cache`
Optimisation table — not encrypted, contains non-sensitive metadata.
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → `users.id` | |
| `token_mint` | `text` | SMB token mint address |
| `gen` | `integer` | 2 or 3 |
| `background_trait` | `text NULLABLE` | Gen3 only: Background trait value |
| `metadata_json` | `jsonb` | on-chain metadata snapshot |
| `fetched_at` | `timestamptz` | for cache invalidation |

RLS: own rows only. The processed PNG cutout lives in the vault (encrypted)
or is re-derived on demand; it is NOT stored in this table to avoid
server-side storage of user-attributed assets.

#### `consent_records`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → `users.id` | |
| `consent_type` | `text` | `global_registry_enrollment` |
| `consent_text_hash` | `text` | SHA-256 of consent string shown to user |
| `consent_text_version` | `text` | e.g., `v1.0` |
| `granted_at` | `timestamptz` | |
| `revoked_at` | `timestamptz NULLABLE` | null = currently active |
| `ip_hash` | `text` | SHA-256 of IP, for legal evidence |
| `user_agent_hash` | `text` | SHA-256 of UA string |

RLS: user reads own rows. Admins read all. No DELETE — consent records are
immutable audit evidence. Revocation writes `revoked_at`, never removes.

#### `global_embeddings`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → `users.id` UNIQUE | one embedding per user |
| `consent_id` | `uuid` FK → `consent_records.id` | must reference active consent |
| `wrapped_embedding` | `bytea` | ArcFace 512-float32, server-KMS-wrapped |
| `embedding_iv` | `bytea` | 12-byte GCM IV |
| `embedding_version` | `text` | model version tag, e.g., `arcface-r100-v1` |
| `pgv_embedding` | `vector(512)` | pgvector column — plaintext in-DB for ANN search |
| `expires_at` | `timestamptz` | retention policy expiry |
| `created_at` | `timestamptz` | |
| `deleted_at` | `timestamptz NULLABLE` | soft-delete marker |

Note on the `pgv_embedding` column: this IS plaintext in the Postgres row and
is used for pgvector ANN (`<=>` operator, IVFFlat or HNSW index). The
`wrapped_embedding` column is a backup/audit copy. A compromised Supabase
service-role credential gives access to `pgv_embedding`. That risk is accepted
in the threat model (see below) and mitigated by access controls and audit
logging.

RLS: users cannot SELECT this table at all (zero direct access). Service role
can INSERT/UPDATE/DELETE. Backend reads are via a service-role function with
row-level audit logging.

#### `events`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text` | |
| `date` | `date` | |
| `created_by` | `uuid` FK → `users.id` | admin or moderator |
| `status` | `text` | `draft` / `active` / `archived` |
| `created_at` | `timestamptz` | |

RLS: public read for active events. Write: admin/moderator only.

#### `event_photos`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `event_id` | `uuid` FK → `events.id` | |
| `storage_path` | `text` | Supabase Storage path |
| `status` | `text` | `processing` / `complete` / `failed` |
| `uploaded_by` | `uuid` FK → `users.id` | |
| `created_at` | `timestamptz` | |
| `expires_at` | `timestamptz` | TTL for ephemeral mode photos |

RLS: uploader reads own rows. Admin/moderator reads all.

#### `audit_log`
| Column | Type | Notes |
|---|---|---|
| `id` | `bigserial` PK | |
| `actor_id` | `uuid NULLABLE` FK → `users.id` | null for system events |
| `action` | `text` | e.g., `vault.write`, `registry.enroll`, `registry.delete` |
| `target_table` | `text NULLABLE` | |
| `target_id` | `uuid NULLABLE` | |
| `metadata` | `jsonb` | non-PII context |
| `created_at` | `timestamptz` | |

RLS: INSERT by service role only (no user can write audit log). SELECT: admins
only. No UPDATE, no DELETE — append-only enforced by a trigger that raises
an exception on UPDATE/DELETE attempts.

### Storage buckets

| Bucket | Contents | Access |
|---|---|---|
| `event-photos` | Group photos for events (ephemeral and persistent) | Authenticated upload by event participant; admin read; auto-expire via TTL job |
| `processed-photos` | Final masked PNG outputs | Owner download for 24h; then deleted |
| `monke-assets` | Cached transparent monke PNGs (non-sensitive) | Public read (CDN-cacheable) |

### pgvector index

Index on `global_embeddings.pgv_embedding` using HNSW (Hierarchical
Navigable Small World) with parameters tuned for community scale:

```sql
CREATE INDEX global_embeddings_hnsw_idx
  ON global_embeddings
  USING hnsw (pgv_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

ANN search query at event-processing time:

```sql
SELECT user_id, 1 - (pgv_embedding <=> $query_vec) AS similarity
FROM global_embeddings
WHERE deleted_at IS NULL
  AND expires_at > now()
  AND EXISTS (
    SELECT 1 FROM consent_records cr
    WHERE cr.id = consent_id AND cr.revoked_at IS NULL
  )
ORDER BY pgv_embedding <=> $query_vec
LIMIT 5;
```

Matches below the similarity threshold (configurable, default 0.75) are
discarded; the corresponding face falls back to manual pairing.

---

## SMB Library Derivation

When a wallet connects, the monke library is bootstrapped automatically from
on-chain holdings rather than requiring manual uploads.

### Flow

```
1. Get holdings
   Helius DAS API: getAssetsByOwner(wallet_pubkey, page=1..N)
   → list of token mints where grouping=SMBv2 or SMBv3 collection

2. For each mint, fetch metadata
   Helius DAS API: getAsset(mint)
   → name, attributes[], image URL (HTTPS)
   Also: MonkeDAO monke-asset-api (github.com/MonkeDAO/monke-asset-api)
   → flat render + trait names (no transparent endpoint yet)

3. Determine generation
   Gen3: attributes contains { trait_type: "Background", value: "<color>" }
   Gen2: no Background attribute

4. Background removal
   Gen3 (preferred path):
     Read Background trait value → look up in the 18-value enum
     → compute exact hex color → chroma-key the flat render image
     → produce transparent PNG (lossless on pixel art; no fringe artifacts)

   Gen2 (fallback path):
     Corner-seeded flood-fill on the dominant corner color
     → expand to silhouette
     → existing monkepic palette + fringe cleanup post-processing

   Non-SMB / unknown:
     Full monkepic background removal pipeline (palette, silhouette, fringe)

5. Cache
   Store metadata in monke_library_cache (server-side, non-sensitive)
   Store transparent PNG in the vault JSON (client-side, encrypted)
   CDN-cache the asset URL in Supabase Storage monke-assets bucket

6. Library displayed in UI
   Ordered by: currently equipped (on-chain profile), then token ID ascending
```

### MonkeDAO partnership track (parallel, non-blocking)

Submit a request to MonkeDAO for access to the private HashLips trait layer
assets. If granted: Gen3 cutouts become true-transparency (no chroma-key
processing at all, no fringe possibility). Until then, metadata-driven
chroma-key is production-quality for Gen3 and is the v1 path.

---

## Global Registry and Event-Coverage Flow

### Enrollment (consent-gated)

1. User navigates to "Join Global Registry" (distinct section from wallet
   auth; not shown on the main mask-flow page).
2. UI presents the consent dialog (see Legal section for required content).
3. User confirms. Frontend calls `/api/registry/enroll` with wallet signature
   over the consent text hash + nonce. Backend:
   a. Verifies consent signature.
   b. Writes `consent_records` row (immutable).
   c. Extracts the user's ArcFace embedding from a reference selfie the user
      uploads at enrollment time (selfie is processed by `monkepic` and
      discarded — NOT stored; only the embedding is retained).
   d. Inserts `global_embeddings` row.
   e. Audit-logs the enrollment.
4. User sees confirmation with their enrolled monke and an explicit
   "Remove me" button always visible.

### Event-photo matching

```
Event photo uploaded by organiser
       ↓
monkepic: face detection (YuNet) → N face bounding boxes
       ↓
monkepic: ArcFace embedding extraction per face crop
       ↓
Backend: pgvector ANN search for each face embedding
       ↓
For each face:
  similarity ≥ threshold → matched member → fetch member's monke mint
                                          → queue placement (auto)
  similarity < threshold → no match      → falls to manual pairing
       ↓
Server renders combined result
       ↓
Organiser reviews auto-placements; can override any individual pairing
       ↓
Final render with any manual corrections applied
```

### False-match handling

- Default similarity threshold: 0.75 (cosine, ArcFace r100). Configurable
  per-event by the admin panel.
- Matches in [0.65, 0.75) are surfaced to the organiser as "low-confidence"
  suggestions requiring explicit confirmation rather than auto-placed.
- Matches below 0.65 are silently discarded and fall to manual pairing.
- If auto-placement produces a visibly wrong result (wrong monke on a face),
  the organiser can override in the review step; the override is logged.
- There is no feedback loop that writes overrides back to the embedding store
  in v1 (to avoid embedding drift from organiser corrections).

### Deletion lifecycle

When a member requests deletion of their registry enrollment:

```
Member clicks "Remove me from registry"
       ↓
consent_records.revoked_at = now()         (immutable, revocation recorded)
       ↓
global_embeddings.deleted_at = now()       (soft-delete; excluded from queries)
       ↓
Async job (within 72h):
  DELETE FROM global_embeddings WHERE deleted_at IS NOT NULL AND deleted_at < now()
  Supabase Storage: any cached photo fragments referencing this user_id purged
  Backup flag: set purge_requested=true on the backup job record
       ↓
audit_log: action='registry.delete', actor_id=member, target_id=embedding_id
       ↓
Member receives email confirmation (if email on file) or can check audit trail
```

The 72-hour window is required to allow in-flight event processing to
complete. It must be disclosed in the consent text.

---

## Admin Panel

### Roles

| Role | Assigned to | Capabilities |
|---|---|---|
| `admin` | Platform operator | All admin panel features; cannot read vault ciphertext |
| `moderator` | Trusted community members | Manage events, review photos, handle reports; cannot touch consent records or member deletions |
| `member` | All authenticated wallet users | Self-service: own vault, own consent, own library |

Role changes require `admin` action and are audit-logged.

### Admin panel features

- **Members:** list wallet pubkeys, join dates, registry enrollment status,
  consent record view (cannot see vault content). Trigger deletion on behalf
  of member (GDPR Right to Erasure flow). Suspend / ban (blocks login).
- **Events:** create, edit, archive events; upload group photos; review
  auto-placements; approve final renders.
- **Consent records:** read-only view of all consent records, filter by
  type/status/date. Export to CSV for legal review.
- **Deletion requests:** queue of pending Right-to-Erasure requests with
  status tracking and deadline (30-day GDPR window, 72-hour embedding purge).
- **Moderation:** flag and remove rendered photos on takedown request; log
  reason.
- **Audit log viewer:** search/filter audit log. Cannot edit or delete entries.
- **Monke inventory:** browse SMB token → member mappings (useful for
  resolving duplicate-monke conflicts).

### Explicit admin vault constraint

Admins have zero technical path to read a user's vault `ciphertext` or
`wrapped_dek` columns. This is enforced at three layers:

1. **Postgres RLS:** `vaults` table has no SELECT policy for any role other
   than `own row`. The service role can write (to accept client-submitted
   ciphertext) but the backend code path never reads the ciphertext column.
2. **Column-level view:** `vaults_meta` view exposes only `user_id`,
   `schema_version`, `version`, `updated_at`. Admin panel queries this view.
3. **Application layer:** the admin API routes have no endpoint that returns
   vault ciphertext; this is a code-level constraint, auditable in the backend.

Even an admin with direct Supabase dashboard access would see only opaque
bytes. This must be documented in the admin onboarding materials.

---

## Security Model

### Threat model

| Threat | Impact | Mitigation | Residual risk |
|---|---|---|---|
| Supabase database breach | Vault ciphertext exposed | ZK encryption: ciphertext is meaningless without user's wallet | Attacker with user's wallet can still decrypt — wallet security is load-bearing |
| Malicious or compromised admin | Vault read, embedding exfiltration | RLS + view-only vault metadata; audit log; vault ZK property | Admin can read `pgv_embedding` (global index) — accepted, mitigated by audit trail |
| Lost / burned wallet | Vault permanently inaccessible | Determinism check on setup; explicit loss warning; optional encrypted key export | User accepts data loss — no recovery path |
| Wallet private-key theft | Full vault decryption + impersonation | Wallet security is user's responsibility; session JWTs are short-lived | Out of scope for app-layer mitigation |
| SIWS replay attack | Authenticated as victim | Single-use nonce, 5-min TTL, domain binding in message | Negligible after mitigation |
| Non-deterministic wallet | Vault permanently unreadable | Determinism check on setup blocks vault creation until validated | Wallets failing the check cannot use the vault (graceful degradation) |
| ArcFace embedding inversion | Reconstruct approximate face image from embedding | Embeddings are server-KMS-wrapped at rest; access only via service role | Inversion attacks on ArcFace are theoretically possible; not a v1 mitigation target — document as future work |
| False positive match in global registry | Wrong monke placed on person's face | Threshold gating + organiser review step | Low-confidence matches require human confirmation |
| Timing attack on similarity threshold | Enumerate registry | Threshold is server-side, not exposed in API response; only pass/fail and similarity score for matched user is returned to organiser | Acceptable residual risk |
| Supabase Storage bucket misconfiguration | Public access to photos | `event-photos` and `processed-photos` are private buckets; access via signed URLs only | Configuration drift risk; mitigate with IaC and periodic audit |
| XSS in client app | KEK exfiltrated from browser memory | Content Security Policy (strict), no inline scripts, subresource integrity on bundles | Browser memory is fundamentally accessible to XSS; defense-in-depth, not elimination |

### Session security

- JWT access token: 15 minutes, httpOnly Secure SameSite=Strict.
- Refresh token: 7 days, rotated on use, stored httpOnly.
- CSRF: SameSite=Strict cookie + custom request header (`X-Requested-With:
  MonkeMask`) required on all state-changing API calls.
- The KEK and DEK are held in JavaScript memory only for the duration of vault
  access. They are not written to localStorage, sessionStorage, or any
  persistent browser store.

---

## Legal and Compliance

### Why this matters

The global registry (feature B) processes biometric data — ArcFace embeddings
derived from face images. Biometric data is special-category personal data under:

- **GDPR Art. 9 (EU):** requires explicit, purpose-limited consent; right to
  erasure; breach notification within 72 hours.
- **BIPA (Illinois, USA):** requires written consent before biometric data
  collection; prohibits sale or profit from biometric data; 5-year retention
  limit; $1,000–$5,000 per violation.
- **Argentina Ley 25.326 (current) / new PDP bill (in progress):** data subject
  consent; right to deletion (habeas data); sensitivity classification for
  biometric data.

The operator is based in Argentina; events may attract participants from the EU
and US. The platform should be designed for GDPR-equivalent compliance as the
highest common denominator.

### Consent requirements for the global registry

The consent dialog MUST include, in plain language:

1. What biometric data is collected (face embedding derived from a selfie).
2. Why it is collected (automatic monke placement in event photos).
3. Who can access it (platform backend, no third-party sharing).
4. How long it is retained (explicit date or "until you request deletion").
5. How to delete it (one-click removal, always visible in account settings).
6. That the embedding cannot be used to reconstruct their original face image
   exactly (accurate characterisation, not overclaim).
7. That their selfie is discarded immediately after embedding extraction; only
   the embedding is stored.
8. Contact address for data-related requests.

The consent text is versioned. The hash of the consented version is stored in
`consent_records.consent_text_hash`. If the consent text changes materially
(new use, new retention period, new sharing), re-consent is required for all
existing members before their embeddings are used again.

### Retention and auto-expiry

- Global embeddings: default retention of 2 years from enrollment, enforced by
  `expires_at` column. Members are notified 30 days before expiry and given the
  option to renew consent or let it lapse.
- Consent records: retained indefinitely (legal evidence; no GDPR right to erase
  a consent record; only its revocation is recorded).
- Event photos: 35-minute TTL for ephemeral mode; configurable retention (default
  30 days) for event-mode photos, after which they are hard-deleted from Storage.
- Personal vault: retained as long as the user account exists. On account
  deletion, the vault is deleted (data the server cannot decrypt anyway, but
  deletion is required to satisfy right-to-erasure form).

### Right to erasure cascade

When a member requests full account deletion:

```
1. Revoke all active consent records (revoked_at = now())
2. Soft-delete global_embeddings (deleted_at = now())
3. Hard-delete global_embeddings within 72h (async job)
4. Delete vault row (ciphertext was unreadable anyway; deletion satisfies form)
5. Anonymise audit_log rows: replace actor_id with a stable anonymous token
   derived from the user's ID — so audit trail integrity is preserved but
   individual is unidentifiable
6. Delete users row
7. Send deletion confirmation
8. Log deletion event with timestamp and confirmation number
```

Backup purge: the backup flagging mechanism must be implemented before B ships.
Until it is, backups represent a compliance gap for deleted biometric data. This
is a hard blocker for production launch of B.

### DPIA recommendation

Processing biometric data of community members at scale (feature B) is
high-risk processing under GDPR Art. 35. A Data Protection Impact Assessment
(DPIA) is **strongly recommended** before feature B ships to any user outside
the development team. The DPIA should cover:

- Necessity and proportionality of the global registry vs. alternatives.
- Risk assessment for embedding inversion, false matches, and data breach.
- Safeguards (consent, deletion, access control, encryption) and their adequacy.
- Consultation with affected data subjects (community survey recommended).

This is not a legal opinion. Get actual legal review.

---

## Phased Roadmap

### Phase 1 — Wallet Auth + Dual-Mode Shell

Scope: SIWS authentication, session management, dual-mode UI gate, no data
persistence beyond today's TTL.

Deliverables:
- Wallet connect / disconnect UI.
- SIWS verification endpoint.
- JWT session management (httpOnly cookies, refresh rotation).
- `users` table + RLS.
- Feature flag: `VAULT_ENABLED=false` (vault UI hidden but auth works).
- Audit log table + append-only trigger.
- Existing ephemeral flow: zero regression (AC-1).

### Phase 2 — Personal Library from Holdings + ZK Vault

Scope: monke library derivation from on-chain data, vault encryption, vault
unlock/lock, re-key flow.

Deliverables:
- Helius DAS API integration for holdings query.
- Gen3 chroma-key background removal (metadata-driven).
- Gen2 flood-fill background removal.
- `vaults` table + RLS (admin vault constraint enforced).
- `monke_library_cache` table + RLS.
- `vaults_meta` view for admin panel.
- Client-side vault crypto (HKDF, AES-256-GCM).
- Determinism check on vault setup (AC-9).
- Loss warning UX.
- Encrypted key export (optional backup of `wrapped_dek`).

### Phase 3 — Personal Associations + Client-Side Matching

Scope: named face-to-monke associations stored in vault, client-side
auto-suggest in the mask flow.

Deliverables:
- Association CRUD in vault JSON (client-side only, vault persisted to server
  as ciphertext).
- Client-side cosine similarity compare against vault embeddings.
- Auto-suggest UI in mask flow (threshold-gated, user confirms each suggestion).
- Association management screen (add, rename, delete).

### Phase 4 — Opt-In Global Registry + Event Coverage

Scope: biometric consent, global embeddings index, event-photo matching,
admin event management. This phase REQUIRES completed DPIA and legal review.

Deliverables:
- `consent_records` table + RLS.
- `global_embeddings` table + pgvector HNSW index + RLS.
- Consent dialog UI with versioned consent text.
- Enrollment flow (selfie upload → embedding extraction → discard selfie →
  store embedding).
- pgvector ANN search backend service.
- Event-photo processing pipeline (detect → embed → match → place → organiser
  review).
- Similarity threshold configuration (per-event, admin panel).
- False-match handling UI (low-confidence suggestions).
- Deletion flow (AC-6).
- Backup purge flagging (hard blocker for this phase).
- Retention / expiry job.

### Phase 5 — Admin Panel

Scope: role-based admin UI, consent record management, deletion queue, audit
log viewer, moderation.

Deliverables:
- Admin panel Next.js routes (server-side, auth-gated to `admin`/`moderator`).
- All features listed in Admin Panel section above.
- Role management UI.
- Consent record export.
- Deletion request queue with deadline tracking.
- Audit log viewer.

---

## Open Questions

1. **B trust-model acceptance:** will the MonkeDAO community accept that
   the global registry cannot be zero-knowledge in v1? A community consultation
   (Discord vote, town-hall) before Phase 4 is strongly recommended.

2. **Wallet determinism test results:** Ledger hardware wallet `signMessage`
   determinism has not been confirmed on the Solana app. A test harness signing
   the same message 10 times across Phantom, Solflare, Backpack, and Ledger
   must produce identical outputs before Phase 2 ships. If Ledger is
   non-deterministic, vault must be blocked for Ledger users with a clear
   explanation.

3. **MonkeDAO partnership for HashLips layers:** has a formal request been
   submitted? Timeline? This is a quality upgrade for Gen3 cutouts, not a
   blocker, but should be initiated during Phase 1 to potentially land in
   Phase 2.

4. **Legal / DPIA review:** who is performing the DPIA? Before Phase 4 ships.
   Is there an engaged data protection counsel familiar with Argentina PDP and
   GDPR? Timeline?

5. **Staging environment:** Phase 4 requires a staging Supabase project with
   pgvector enabled and a staging Railway backend. Is this provisioned or is
   it part of Phase 1 infra work?

6. **Consent text versioning:** who is responsible for reviewing and approving
   each version of the consent text before it ships? The hash-based versioning
   in `consent_records` assumes a human-approved text exists before enrollment
   opens.

7. **ArcFace model version pinning:** `monkepic` uses ArcFace for embeddings.
   If the model is updated (different weights), existing embeddings become
   incompatible with new enrollments in the global index. The `embedding_version`
   column in `global_embeddings` is designed to support this, but a migration
   strategy (re-enroll all members on model upgrade) needs to be specified
   before Phase 4.

8. **Event organiser role:** is "event organiser" a distinct role from `admin`
   and `moderator`? The current role model has `moderator` covering event
   management; if external organisers need access without moderator-level
   permissions, a fourth role is required.

9. **Encrypted key export UX:** the optional `wrapped_dek` export for recovery
   is a sensitive operation. What passphrase strength requirements apply? Where
   is the export stored? Is the export invalidated if the user re-keys? This
   needs UX spec before Phase 2 ships.

10. **Backup infrastructure:** Supabase automatic backups will capture
    `pgv_embedding` plaintext. The backup purge flagging mechanism (required
    for Phase 4) depends on knowing the backup schedule and having a process to
    purge or overwrite specific rows from backup snapshots. This may require
    moving to point-in-time recovery with selective restore capability, or
    accepting a backup-window gap and disclosing it in the consent text.

---

## References

- ADR-0001: `docs/decisions/0001-vault-and-trust-models.md`
- MonkeMask repo: github.com/f0x1777/MonkeMask
- MonkeDAO monke-asset-api: github.com/MonkeDAO/monke-asset-api
- Helius DAS API: https://docs.helius.dev/compression-and-das-api/digital-asset-standard-das-api
- Sign In With Solana (SIWS) draft: https://github.com/phantom-labs/sign-in-with-solana
- ArcFace paper: Deng et al., 2019 (InsightFace r100 model)
- pgvector HNSW: https://github.com/pgvector/pgvector
- GDPR Art. 9 (special categories): https://gdpr.eu/article-9-processing-special-categories-of-personal-data/
- BIPA (Illinois): 740 ILCS 14/
- Argentina Ley 25.326: https://servicios.infoleg.gob.ar/infolegInternet/anexos/60000-64999/64790/texact.htm
- HKDF (RFC 5869): https://www.rfc-editor.org/rfc/rfc5869
- ed25519 determinism (RFC 8032 §5.1.6): https://www.rfc-editor.org/rfc/rfc8032
