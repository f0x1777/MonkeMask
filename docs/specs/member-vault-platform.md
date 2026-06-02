# Member Vault Platform

**Status**: Draft (revised 2026-06-01)
**Owner**: operator
**Created**: 2026-06-01
**Branch**: feature/member-vault-platform

---

## Problem

MonkeMask is today a stateless, ephemeral tool: upload a group photo, pair
faces with monkes, download the result, photo gone in ~35 minutes. The privacy
promise ("100% private, deleted right after") is the product's core trust
signal and must not be broken.

That stateless flow has a ceiling. Community members who attend multiple events
must re-pair every face every time. There is no way for a MonkeDAO Local
Ambassador to build and maintain a roster — "this face belongs to this monke" —
that persists across events. There is no way for an ambassador covering an event
in another country to look up whether a given face is already in a known
registry.

Three gaps motivate this evolution:

1. **Per-country roster.** A Local Ambassador should be able to build a database
   of faces and their SMB associations for their own country, use it at every
   local event without re-pairing, and keep that data encrypted and
   country-scoped — not visible to ambassadors in other countries.

2. **Cross-country coverage.** At multi-country events or when providing cover,
   opted-in country data should be promotable to a global registry that
   `global_admin` users can query. The global registry is accessed only by a
   small, designated group — never exposed to all ambassadors.

3. **Operational oversight.** A `super_admin` (the operator) needs tooling to
   manage the allowlist of permitted wallets, assign roles and countries, handle
   deletion requests, and review audit trails.

---

## Goals

- Keep the ephemeral, anonymous flow as the **default** at `/`. Arriving without
  a wallet must work exactly as today. Zero regression.
- Add an **opt-in platform layer** at `/v2`, gated to an allowlist of ~20-30
  Solana wallets ("Local Ambassadors"). Non-allowlisted wallets are denied.
- Three roles: `ambassador` (country-scoped), `global_admin` (global-registry
  access), `super_admin` (allowlist and role management).
- **Country-scoped encryption:** local face data (face reference crops,
  ArcFace embeddings, and monke associations) encrypted at rest with a
  per-country symmetric key (CK). CK is envelope-wrapped to each ambassador of
  that country using a key derived from their wallet signature (SIWS message →
  HKDF → KEK → wrap CK). Any ambassador in a country can unwrap CK and decrypt
  that country's data; ambassadors in other countries cannot.
- **Global encryption:** the promoted global registry is encrypted with a global
  symmetric key (GK), envelope-wrapped to each `global_admin`'s wallet-derived
  key.
- **Client-side matching:** decryption and ArcFace cosine-similarity matching
  happen in the browser. The server never stores or processes plaintext
  embeddings. This is feasible because the total key group is ~20-30 wallets,
  and per-country/global embedding sets are small (hundreds to a few thousand
  512-dim float32 vectors = a few MB, trivial in-browser).
- In-app consent per enrolled person, right-to-deletion (cascades local +
  global), and audit logging.
- SMB monke library derived from on-chain holdings (Helius DAS → Magic Eden
  fallback) or manual upload, with near-perfect cutouts via the existing
  `monkepic` pipeline.

## Non-goals

- Replacing or changing the ephemeral flow at `/`. Anonymous use stays first-
  class and untouched.
- Open signup or holder-gating. Access is exclusively via the operator-managed
  allowlist.
- Implementing homomorphic encryption, secure enclaves (TEE), or on-device
  federated matching for v1.
- Hosting SMB trait layer assets. Background removal is programmatic from
  metadata.
- Social features (feeds, follows, comments).
- Monetisation / payment flows.
- Mobile native app.
- Formal DPIA / external legal review gate before launch (operator explicitly
  accepts this risk given the closed, trusted-ambassador access group).

---

## Acceptance Criteria

- [AC-1] An unauthenticated visitor (or a wallet not on the allowlist) at `/`
  can complete the full mask-and-download flow with no account prompt and no
  data persisted beyond the existing 35-min TTL.
- [AC-2] A non-allowlisted wallet attempting to access `/v2` receives an
  explicit denial response ("wallet not authorised"); the existing `/` flow is
  unaffected.
- [AC-3] An allowlisted `ambassador` wallet can sign in at `/v2`, and after
  authentication sees only the roster and embeddings for their assigned country.
  Data from other countries is neither returned by the API nor decryptable
  from what is returned.
- [AC-4] An allowlisted `global_admin` wallet can access the promoted global
  registry after client-side unwrap of GK. The global registry contains only
  data explicitly promoted by `super_admin`.
- [AC-5] A `super_admin` can add/remove a wallet from the allowlist, assign or
  change role and country, and those changes take effect on the next login for
  the affected wallet.
- [AC-6] Wallet-signature determinism is validated before any key-material is
  committed: the app signs the KEK derivation message twice and asserts
  identical 64-byte outputs; setup is blocked with a clear error if they differ.
- [AC-7] Face reference data (embeddings + association records) for a country
  is stored as AES-256-GCM ciphertext. Decryption requires the CK, which
  requires a wallet signature from an ambassador of that country. The database
  contains no plaintext embeddings.
- [AC-8] A `global_admin` running client-side matching over the global registry
  obtains correct cosine-similarity ranked results against a query face
  embedding; results match those computed server-side from the same plaintext
  vectors (regression test with a seeded dataset).
- [AC-9] An enrolled person's deletion request triggers: revocation of consent
  record, deletion of their association row from the country store, cascaded
  deletion from the global registry if promoted, and an audit log entry — all
  within 72 hours of request.
- [AC-10] An ambassador can derive their SMB monke library from on-chain
  holdings without manually uploading images.
- [AC-11] False-match handling: when client-side cosine similarity for a face
  is below the configurable threshold, the face falls back to manual pairing
  rather than auto-placing a wrong monke.

---

## Dual-Mode Model

### Ephemeral (default — no change, lives at `/`)

The user arrives, uploads a photo, pairs faces, downloads the PNG. The backend
processing pipeline (`monkepic`) runs unchanged. The TTL sweep deletes the
photo and any server-side intermediate data after ~35 minutes. No user record
is created, no cookies set beyond a transient session token, no embeddings
stored.

This mode is the landing experience and must not degrade in latency, UX, or
privacy properties.

### Platform (opt-in — lives at `/v2`)

`/v2` is a Next.js route group in the same `apps/web` application. It is
rendered only after wallet authentication and allowlist verification. The
existing `/` routes are not modified and have no dependency on `/v2` code.

After authentication at `/v2`:

- The ambassador's country-scoped roster is loaded (as encrypted blobs from
  Supabase).
- The browser unwraps CK using the wallet-derived KEK and decrypts the roster.
- The active pairing session can read from the decrypted roster to auto-suggest
  pairings (client-side cosine similarity).
- The ambassador can capture new face-monke associations, which are encrypted
  with CK and written back to Supabase.
- A `global_admin` additionally has a global-registry view (same client-side
  decrypt-and-match pattern, using GK).

Disconnecting the wallet clears all in-memory plaintext. No local state persists
after disconnect beyond the browser's standard session scope.

---

## Identity and Authentication: Wallet + SIWS + Allowlist Gate

### Auth flow

1. UI requests wallet connection (Phantom, Solflare, Backpack, Ledger).
2. Backend generates a nonce (32 bytes, stored with a 5-minute TTL in a
   Supabase ephemeral table).
3. UI constructs a SIWS-style message:

   ```
   monkemask.io wants you to sign in with your Solana account:
   <wallet_pubkey_base58>

   By signing, you authenticate to MonkeMask. This request will expire at
   <ISO-8601 timestamp>.

   Nonce: <hex-nonce>
   ```

4. Wallet signs the message; UI sends `{pubkey, signature, nonce}` to
   `/api/v2/auth/verify`.
5. Backend verifies the ed25519 signature against the message (using
   `@noble/ed25519`). On success, checks `allowlist` table for the pubkey.
   If not present: return 403 with `{"error":"wallet_not_authorised"}`. If
   present: mint a short-lived JWT (15-min access token + 7-day refresh token,
   httpOnly Secure SameSite=Strict cookie). Nonce is consumed.
6. JWT payload includes: `{wallet_pubkey, role, country}` — sourced from the
   `allowlist` table row.

### Replay protection

The nonce is single-use with a 5-minute TTL. A replayed signature against an
already-consumed nonce is rejected. The message includes the origin domain to
prevent cross-origin replay. JWTs are short-lived; refresh tokens are rotated
on use.

### Wallet support matrix

| Wallet | `signMessage` support | ed25519 determinism | Notes |
|---|---|---|---|
| Phantom (browser ext) | Yes | Yes (RFC 8032) | Primary target |
| Solflare (browser ext) | Yes | Yes | Primary target |
| Backpack (browser ext) | Yes | Yes | Primary target |
| Ledger (hardware) | Conditional | Needs verification | `signMessage` requires Ledger Live app >= 2.x + Solana app >= 1.3; determinism unconfirmed — see open questions and the determinism spike (Phase 1, Task 1) |
| WalletConnect bridge | Yes | Dependent on wallet | Test per wallet |

---

## Encryption Model

### Design principle

The server never stores or processes plaintext embeddings or face data. All
sensitive data is encrypted client-side before being written to Supabase, and
decrypted client-side after retrieval. The access group is small enough
(~20-30 wallets total) and the per-country/global datasets are small enough
(hundreds to a few thousand 512-dim vectors = a few MB) that in-browser
decryption and linear cosine-similarity search are practical. This is not a
scalability trade-off for v1: it is the correct architecture for this closed
access model.

As a direct consequence: **pgvector server-side ANN search is NOT used for v1
matching**. The `pgvector` extension is available on the Supabase project and
remains installed (it may be useful for future features or analytics), but it
holds no plaintext embeddings and is not queried for matching in this design.
This resolves the "plaintext embeddings in pgvector" accepted risk noted in the
prior version of ADR-0001.

### Key hierarchy

```
Wallet signature (64 bytes, ed25519, deterministic per RFC 8032)
       |
       v
KEK = HKDF-SHA256(
        ikm  = wallet.signMessage(KEK_DERIVATION_MESSAGE),
        salt = "MonkeMask-v2-KEK-v1",
        info = "kek",
        len  = 32
      )
```

`KEK_DERIVATION_MESSAGE` is a fixed string in the codebase, versioned. It is
NOT the SIWS auth nonce — it is a separate, fixed message used only for key
derivation. Changing it invalidates all wrapped keys.

From the KEK, the browser can unwrap a country key or global key:

```
[Country key wrapping, stored in wrapped_keys table]
CK  = random 32-byte symmetric key (generated once per country by super_admin)
wrapped_CK_for_ambassador = AES-256-GCM(key=KEK_of_ambassador, plaintext=CK)

[Global key wrapping]
GK  = random 32-byte symmetric key (generated once by super_admin)
wrapped_GK_for_global_admin = AES-256-GCM(key=KEK_of_global_admin, plaintext=GK)
```

When an ambassador signs in, the browser:
1. Derives KEK from wallet signature.
2. Fetches `wrapped_CK` for (wallet_pubkey, country) from the `wrapped_keys`
   table.
3. Decrypts: `CK = AES-256-GCM-Decrypt(KEK, wrapped_CK)`.
4. Decrypts the country's encrypted roster blob with CK.
5. Holds CK and the decrypted roster in JS memory only; never writes to
   localStorage.

A `global_admin` performs the same flow using `wrapped_GK`.

### Encrypted data blobs

Country roster data and global registry data are stored as opaque encrypted
blobs (or as rows with encrypted columns). The schema is described in the Data
Model section. The blob format is:

```
[12-byte GCM IV] [AES-256-GCM ciphertext of JSON payload]
```

The plaintext JSON payload for a country roster is:

```json
{
  "schema_version": 1,
  "country": "AR",
  "associations": [
    {
      "id": "uuid",
      "label": "Display name or alias (no real name required)",
      "arc_face_embedding": [...],    // 512 float32 values
      "monke_token_mint": "...",
      "consent_id": "uuid",
      "created_at": "ISO-8601",
      "updated_at": "ISO-8601"
    }
  ]
}
```

The global registry blob mirrors this structure with a `"scope": "global"` field
and references to source country records.

### Key rotation on ambassador removal

When a `super_admin` removes a wallet from the allowlist or removes it from a
country's ambassador group:

1. Generate a new CK for that country.
2. Re-wrap the new CK for each remaining ambassador of that country.
3. Re-encrypt the country roster blob with the new CK.
4. Delete the removed wallet's `wrapped_keys` row.
5. Write the new encrypted blob and wrapped key rows in a single transaction.
6. Audit-log the rotation event.

The removed ambassador retains any plaintext data they decrypted in their browser
during active sessions. There is no mechanism to revoke data already in memory or
in prior browser downloads. This is an accepted residual risk, documented in the
threat model.

### Determinism requirement

The entire key derivation chain depends on `wallet.signMessage(KEK_DERIVATION_MESSAGE)`
producing the same 64-byte output on every call for the same wallet. RFC 8032 §5.1.6
specifies that ed25519 signatures are deterministic. The implementation validates
this before any key material is written: sign the message twice, compare
byte-for-byte; block if they differ. This spike is the first task in Phase 1 and
must pass before the envelope-encryption model is built.

---

## Supabase Data Model

### Supabase project

`monkemask-v2`, São Paulo region, free tier, auto-RLS enabled, `pgvector`
extension installed (available but not used for v1 matching — deferred).

### Tables

#### `allowlist`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `wallet_pubkey` | `text` UNIQUE NOT NULL | base58 |
| `role` | `text` NOT NULL | `ambassador` / `global_admin` / `super_admin` |
| `country` | `text NULLABLE` | ISO 3166-1 alpha-2; required for `ambassador`, null for `global_admin`/`super_admin` |
| `added_by` | `uuid` FK → `allowlist.id NULLABLE` | who added this wallet; null for the bootstrap row |
| `added_at` | `timestamptz` | |
| `removed_at` | `timestamptz NULLABLE` | soft-removal; null = active |
| `notes` | `text NULLABLE` | operator notes |

RLS: `super_admin` full CRUD (via service role function). Other roles: `SELECT`
own row only (to read their role and country after auth). No client-level INSERT
or DELETE.

The JWT payload is sourced from this table at auth time. A wallet present but
with `removed_at IS NOT NULL` is treated as non-allowlisted.

#### `auth_nonces`
| Column | Type | Notes |
|---|---|---|
| `nonce` | `text` PK | hex string |
| `created_at` | `timestamptz` | |
| `expires_at` | `timestamptz` | created_at + 5 minutes |
| `consumed_at` | `timestamptz NULLABLE` | set on use; null = available |

RLS: service role write only. Expired/consumed nonces are swept by a scheduled
job or on-access TTL check.

#### `wrapped_keys`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `wallet_pubkey` | `text` NOT NULL | the wallet this wrap is for |
| `scope` | `text` NOT NULL | `country:<ISO>` or `global` |
| `wrapped_key` | `bytea` NOT NULL | AES-256-GCM(KEK, CK or GK); 12-byte IV prepended |
| `key_version` | `integer` NOT NULL DEFAULT 1 | incremented on rotation |
| `created_at` | `timestamptz` | |
| `superseded_at` | `timestamptz NULLABLE` | set when a rotation replaces this row |

RLS: `SELECT` WHERE wallet_pubkey = authenticated wallet AND superseded_at IS NULL.
No client INSERT/UPDATE/DELETE — mutations via service role functions only.

UNIQUE constraint: `(wallet_pubkey, scope)` on active (non-superseded) rows.

#### `encrypted_country_rosters`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `country` | `text` NOT NULL | ISO 3166-1 alpha-2 |
| `ciphertext` | `bytea` NOT NULL | AES-256-GCM(CK, roster_json); 12-byte IV prepended |
| `schema_version` | `integer` NOT NULL DEFAULT 1 | roster JSON schema version |
| `key_version` | `integer` NOT NULL DEFAULT 1 | must match wrapped_keys.key_version |
| `record_count` | `integer` | denormalized count for admin display |
| `updated_at` | `timestamptz` | |
| `updated_by` | `text` | wallet_pubkey of last writer |

RLS: `SELECT` WHERE country = authenticated wallet's country (from JWT).
`UPDATE`/`INSERT` similarly scoped. `super_admin` full read.

Only one active row per country (enforce via unique index on `country`).

#### `encrypted_global_registry`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `ciphertext` | `bytea` NOT NULL | AES-256-GCM(GK, global_registry_json); 12-byte IV prepended |
| `schema_version` | `integer` NOT NULL DEFAULT 1 | |
| `key_version` | `integer` NOT NULL DEFAULT 1 | |
| `record_count` | `integer` | |
| `updated_at` | `timestamptz` | |
| `promoted_by` | `text` | wallet_pubkey of super_admin who promoted |

RLS: `SELECT` for `global_admin` and `super_admin` only (enforce via JWT role
claim). No client-level write — promotion is a service role function.

Only one active row (the current global registry snapshot).

#### `consent_records`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `subject_alias` | `text` | display name / alias of the enrolled person (NOT a wallet — these are event attendees, not necessarily wallet holders) |
| `country` | `text` | ISO 3166-1 alpha-2 — which country's roster this enrollment is in |
| `enrolled_by` | `text` | wallet_pubkey of the ambassador who enrolled this person |
| `consent_type` | `text` | `country_roster_enrollment` / `global_registry_promotion` |
| `consent_text_hash` | `text` | SHA-256 of consent string shown to the attendee |
| `consent_text_version` | `text` | e.g., `v1.0` |
| `granted_at` | `timestamptz` | |
| `revoked_at` | `timestamptz NULLABLE` | null = currently active |
| `deletion_requested_at` | `timestamptz NULLABLE` | when the subject requested deletion |
| `deleted_at` | `timestamptz NULLABLE` | when the record was purged from roster blobs |

RLS: `INSERT` by `ambassador` for their own country. `SELECT` own-country rows
for `ambassador`; all rows for `global_admin` / `super_admin`. No DELETE — consent
records are immutable audit evidence; deletion writes `deleted_at` and flags the
blob for re-encryption without that record.

Note on subjects: the most sensitive parties are the event attendees whose faces
are in photos. They are not necessarily wallet holders. Consent is captured
informally (event signage, community norms) — this is the operator's accepted
responsibility. The `consent_records` table provides a traceable in-app record
that a consent mechanism was in place.

#### `monke_library_cache`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `wallet_pubkey` | `text` NOT NULL | ambassador's wallet |
| `token_mint` | `text` | SMB token mint address |
| `gen` | `integer` | 2 or 3 |
| `background_trait` | `text NULLABLE` | Gen3 only: Background trait value |
| `metadata_json` | `jsonb` | on-chain metadata snapshot |
| `fetched_at` | `timestamptz` | for cache invalidation |

RLS: own rows only (wallet_pubkey = authenticated wallet pubkey from JWT).
Non-sensitive metadata only; processed PNG cutouts are held in-browser or
derived on demand, not stored here.

#### `audit_log`
| Column | Type | Notes |
|---|---|---|
| `id` | `bigserial` PK | |
| `actor_wallet` | `text NULLABLE` | wallet_pubkey; null for system events |
| `action` | `text` | e.g., `auth.signin`, `auth.denied`, `roster.write`, `roster.key_rotation`, `registry.promote`, `registry.delete`, `consent.enroll`, `consent.revoke`, `allowlist.add`, `allowlist.remove` |
| `target_country` | `text NULLABLE` | |
| `target_id` | `uuid NULLABLE` | |
| `metadata` | `jsonb` | non-PII context |
| `created_at` | `timestamptz` | |

RLS: INSERT by service role only. SELECT: `super_admin` only. No UPDATE, no
DELETE — append-only enforced by a trigger that raises an exception on
UPDATE/DELETE attempts.

### Storage buckets

| Bucket | Contents | Access |
|---|---|---|
| `event-photos` | Group photos for event sessions (ephemeral mode at `/`) | No change from existing design; auto-expire TTL |
| `processed-photos` | Final masked PNG outputs (ephemeral mode) | No change |
| `monke-assets` | Cached transparent monke PNGs (non-sensitive) | Public read (CDN-cacheable) |

No new storage buckets are required for the encrypted roster/registry data —
those are stored as `bytea` columns in Postgres, which is appropriate for the
expected payload sizes (a few MB at most per country blob).

### pgvector

`pgvector` extension is installed on the Supabase project and available. For v1
it holds no data and is not queried. It is preserved for potential future use
(e.g., deduplication analytics, model-version migration tooling) but is not part
of the v1 matching architecture.

---

## SMB Library Derivation

When a wallet connects, the ambassador's monke library is bootstrapped
automatically from on-chain holdings.

### Flow

```
1. Get holdings
   Helius DAS API: getAssetsByOwner(wallet_pubkey, page=1..N)
   → list of token mints where grouping=SMBv2 or SMBv3 collection

2. For each mint, fetch metadata
   Helius DAS API: getAsset(mint)
   → name, attributes[], image URL (HTTPS)
   Also: MonkeDAO monke-asset-api (github.com/MonkeDAO/monke-asset-api)
   → flat render + trait names

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
   CDN-cache asset URL in Supabase Storage monke-assets bucket

6. Library displayed in UI
   Ordered by: currently equipped (on-chain profile), then token ID ascending
```

### MonkeDAO partnership track (parallel, non-blocking)

Submit a request to MonkeDAO for access to the private HashLips trait layer
assets. If granted: Gen3 cutouts become true-transparency (no chroma-key
processing, no fringe possibility). Until then, metadata-driven chroma-key is
production-quality for Gen3 and is the v1 path.

---

## Global Registry and Event-Coverage Flow

### Promotion (super_admin-gated)

Country data is promoted to the global registry by a `super_admin`:

1. `super_admin` selects which countries to include in the global registry.
2. Backend (service role) reads the encrypted country roster blobs for those
   countries. Note: the super_admin does NOT decrypt these — the promotion
   operation assembles them as encrypted units.
3. A new `encrypted_global_registry` blob is constructed: each country's
   decrypted associations are merged (this requires the super_admin to perform
   the decryption client-side using the super_admin's own GK-unwrapping ability
   — OR the super_admin re-encrypts a merged JSON under GK client-side and
   uploads the ciphertext). The server sees only ciphertext throughout.
4. `wrapped_GK` rows are written for each `global_admin` wallet.
5. Audit log: `registry.promote` with list of countries included.

### Client-side matching (global_admin)

A `global_admin` running event coverage:

```
1. Sign in → derive KEK → fetch wrapped_GK → unwrap GK → decrypt global registry JSON
2. For each face in the event photo:
   a. Extract ArcFace embedding (client-side via monkepic WASM or API call
      that returns only the embedding, not stored)
   b. Compute cosine similarity against all embeddings in the decrypted registry
   c. similarity >= threshold → matched person → fetch their monke mint
                              → queue placement (auto)
      similarity < threshold  → no match → fall back to manual pairing
3. global_admin reviews auto-placements, overrides if needed
4. Final render returned
```

Scale note: at ~20-30 ambassadors per country and a few countries, the global
registry will have at most a few hundred entries. A linear scan over a few
hundred 512-float32 vectors in JavaScript takes under 10ms. Server-side ANN
search is not needed and is not used.

### Similarity thresholds

- Default match threshold: 0.75 (cosine, ArcFace r100).
- Low-confidence range [0.65, 0.75): surfaced to the reviewer as suggestions
  requiring explicit confirmation.
- Below 0.65: discarded; face falls to manual pairing.

### Deletion lifecycle

When a subject's consent is revoked or a deletion is requested:

```
1. consent_records.revoked_at = now()       (immutable revocation)
2. Ambassador downloads their country roster (decrypts in browser)
3. Ambassador (or super_admin) removes the association record from the JSON
4. Ambassador re-encrypts the updated JSON with the current CK
5. Writes updated ciphertext back to encrypted_country_rosters
6. If the record was in the global registry: super_admin repeats the same
   process for encrypted_global_registry
7. audit_log: action='consent.revoke' + 'roster.write' (and 'registry.delete'
   if applicable)
8. All steps must complete within 72 hours of deletion request
```

---

## Admin Panel

### Roles

| Role | Assigned to | Capabilities |
|---|---|---|
| `super_admin` | The operator | Allowlist management; assign roles + countries; key rotation on removals; global registry promotion; audit log; deletion requests; read all consent records |
| `global_admin` | Designated subset of ambassadors | Decrypt and query global registry (client-side); cross-country event coverage; view global consent records |
| `ambassador` | Local Ambassadors (~20-30 total) | Build and manage country roster (encrypted client-side); capture face-monke associations; local event coverage; manage own country's consent records |

Role changes require `super_admin` action and are audit-logged.

### Admin panel features (Phase 4)

- **Allowlist management:** add/remove wallets; assign role + country; view
  active/removed entries; audit trail per wallet.
- **Key rotation:** when an ambassador is removed, trigger country CK rotation
  (re-wrap for remaining ambassadors, re-encrypt roster blob).
- **Global registry promotion:** select countries, trigger client-side merge +
  re-encryption, write new global registry blob.
- **Consent record browser:** read-only view of all consent records, filter by
  country/type/status/date. Export to CSV for legal review.
- **Deletion request queue:** pending right-to-deletion requests with status
  tracking and 72-hour deadline.
- **Audit log viewer:** search/filter audit log. Cannot edit or delete entries.
- **Monke inventory:** browse SMB token → ambassador mappings; useful for
  resolving duplicate-monke conflicts.

---

## Security Model

### Threat model

| Threat | Impact | Mitigation | Residual risk |
|---|---|---|---|
| Supabase database breach | Encrypted roster/registry blobs exposed | Client-side encryption: ciphertext is meaningless without CK/GK, which requires wallet signature to unwrap | Attacker with a current ambassador's wallet can unwrap and decrypt that country's data |
| Compromised `super_admin` wallet | Global registry and allowlist access | GK is envelope-wrapped; rotation on removal. Allowlist changes are audit-logged | super_admin wallet is the highest-value target; wallet security is the primary control |
| Removed ambassador retains decrypted data | Former ambassador has plaintext embeddings from sessions before removal | CK rotation prevents future access; prior decrypted data in their browser/downloads cannot be recalled | Accepted risk; mitigated by vetting of ambassadors before allowlist add |
| Non-deterministic wallet | KEK changes on re-sign; wrapped keys become unusable | Determinism spike in Phase 1; determinism check blocks key wrap if test fails | Wallets failing the check cannot use /v2; graceful degradation with clear error |
| SIWS replay | Authenticated as victim | Single-use nonce, 5-min TTL, domain binding | Negligible after mitigation |
| Non-allowlisted wallet | Accesses /v2 data | Allowlist check server-side before JWT issuance; RLS enforces role/country claims | Configuration errors in allowlist; mitigated by audit log and super_admin review |
| XSS in client app | KEK / CK / GK exfiltrated from browser memory | Strict CSP, no inline scripts, SRI on bundles | Browser memory is accessible to XSS; defense-in-depth required |
| ArcFace embedding inversion | Approximate face reconstruction from stored embedding | Embeddings are AES-GCM encrypted at rest; no plaintext in DB; access requires wallet | Inversion attacks are theoretically possible; v1 does not mitigate at this layer |
| Country blob read by wrong ambassador | Cross-country data leak | RLS restricts SELECT to own country (from JWT); country claim is server-validated | JWT tampering — mitigated by short-lived tokens and server-side validation |
| Supabase storage misconfiguration | Public access to photos | event-photos and processed-photos are private buckets; signed URLs only | Configuration drift risk; mitigate with IaC and periodic audit |

### Session security

- JWT access token: 15 minutes, httpOnly Secure SameSite=Strict.
- Refresh token: 7 days, rotated on use, stored httpOnly.
- CSRF: SameSite=Strict cookie + custom request header (`X-Requested-With: MonkeMask-v2`).
- KEK, CK, GK, and decrypted JSON are held in JavaScript memory only for the
  duration of the active session. Never written to localStorage, sessionStorage,
  or any persistent browser store.

---

## Legal and Compliance

### Who the data subjects are

The most sensitive subjects are the **event attendees** whose faces appear in
photos. They are not necessarily wallet holders or MonkeDAO members. Consent for
their face data is captured informally (event signage, community norms) — this
is the operator's accepted responsibility. The in-app `consent_records` table
provides a traceable record that a consent mechanism was present.

The operator explicitly accepts this risk given the closed, trusted-ambassador
access model and the community context of MonkeDAO events.

### No formal DPIA gate

Unlike the prior v1 design (which had a hard DPIA blocker before the global
registry launch), this design explicitly removes that gate. The operator has
accepted the risk. The design does not require a DPIA sign-off before launch.
This decision should be revisited if the platform scales beyond the
~20-30-ambassador model or if events attract participants with GDPR-jurisdiction
rights who have not implicitly consented through community membership.

### Consent requirements (in-app)

The consent capture flow for an enrolled attendee MUST convey, in plain language:

1. What biometric data is collected (face embedding derived from a reference photo).
2. Why it is collected (automatic monke placement in event photos).
3. Who can access it (ambassadors of their country; `global_admin`s if promoted).
4. How to request deletion (contact the ambassador who enrolled them, or the
   operator directly).
5. That the reference photo is processed locally and discarded; only the
   embedding is stored (encrypted).
6. That the embedding cannot be used to reconstruct the original face image
   exactly.

The consent text is versioned. The hash is stored in `consent_records`.

### Retention and deletion

- Country roster blobs: retained as long as the country has active ambassadors.
  On deletion request for a specific person, the blob is re-encrypted without
  that person's record within 72 hours.
- Global registry: same 72-hour deletion SLA if promoted.
- Consent records: retained indefinitely as audit evidence (revocation recorded,
  record not deleted).
- Event photos (ephemeral mode at `/`): 35-minute TTL, unchanged.

### Right to erasure cascade

When a person's enrollment is deleted:

```
1. Revoke consent record (revoked_at = now())
2. Ambassador decrypts, removes the association from country roster JSON,
   re-encrypts with CK, writes new blob
3. If in global registry: super_admin performs equivalent removal and re-encryption
4. Audit log entry written for each step
5. Deletion confirmed within 72 hours
```

---

## Phased Roadmap

### Phase 1 — Foundation (detailed in plan)

Scope: wallet-signature determinism spike; `/v2` route scaffold; SIWS +
allowlist auth gate; WebCrypto envelope-encryption primitives; Supabase schema
(allowlist, auth_nonces, wrapped_keys, audit_log tables + RLS).

### Phase 2 — Encrypted Country Roster + Client-Side Matching

Scope: encrypted_country_rosters table + RLS; SMB library from holdings;
country roster encrypted face-capture and association flow; client-side cosine
similarity matching within a country.

Deliverables:
- Helius DAS API integration for holdings query.
- Gen3 chroma-key + Gen2 flood-fill background removal.
- Ambassador capture flow: reference photo → embedding (via API, no storage) →
  encrypt association with CK → write blob.
- Client-side matching in the pairing session.
- Consent record creation per enrollment.

### Phase 3 — Global Registry + Global Admin Matching + Consent/Deletion

Scope: encrypted_global_registry table + RLS; super_admin global promotion flow;
global_admin client-side matching; consent revocation and deletion cascade.

Deliverables:
- Global registry blob schema and RLS.
- Promotion flow (super_admin client-side merge + re-encrypt under GK).
- wrapped_GK rows for global_admin wallets.
- Global admin matching view and event-coverage session.
- Deletion request flow (72-hour SLA, audit-logged).
- Consent record browser (ambassador and super_admin views).

### Phase 4 — Admin Panel

Scope: full `/v2/admin` UI for super_admin; allowlist management; key rotation;
audit log viewer; deletion request queue; monke inventory.

Deliverables:
- All features listed in Admin Panel section above.
- CK rotation on ambassador removal (automated trigger in super_admin UI).
- Consent record export (CSV).
- Deletion request queue with deadline tracking.
- Audit log viewer (search/filter).

---

## Open Questions

1. **Wallet determinism spike result (Phase 1, Task 1 blocker):** the test
   harness must be run with Phantom, Solflare, Backpack, and Ledger before any
   wrapped-key infrastructure is built. If Ledger is non-deterministic, the UX
   must clearly block Ledger users from `/v2` key operations with a human
   explanation. The operator should run this test and report results before
   Phase 1 Task 3 begins.

2. **Allowlist seeding:** the operator must provide the initial set of 20-30
   wallet addresses (with role and country assignments) before Phase 1 Task 4
   ships. The `super_admin` bootstrap wallet must be decided first; all other
   allowlist entries are added via the admin panel.

3. **Country key seeding:** per-country CKs and the global GK are generated
   once by the super_admin and wrapped to the initial allowlist. The procedure
   for this (a dedicated admin setup screen or a one-time CLI tool) must be
   decided before Phase 2 ships.

4. **Per-country key rotation SLA:** when an ambassador is removed, how quickly
   must the CK rotation complete? If there is no automation, a manual rotation
   by the super_admin could lag. A target SLA (e.g., within 24 hours of removal)
   should be defined and enforced by the admin panel's pending-rotation UI.

5. **MonkeDAO partnership for HashLips layers:** has a formal request been
   submitted? Timeline? Quality upgrade for Gen3 cutouts, not a blocker.

6. **ArcFace model version pinning:** `monkepic` uses ArcFace for embeddings.
   If the model is updated (different weights), existing embeddings become
   incompatible with new enrollments. The `schema_version` field in roster blobs
   supports this, but a migration strategy (re-enroll affected records on model
   upgrade) must be specified before Phase 2 ships at scale.

7. **Client-side matching scale ceiling:** the current design is feasible for
   hundreds of entries. If the global registry grows to thousands of entries, the
   linear scan will still be fast (<100ms for 5,000 × 512-dim vectors in modern
   browsers), but this should be re-evaluated if the model scales.

8. **Supabase free-tier limits:** the free Supabase project has a 500MB database
   limit and 1GB storage. Encrypted blobs for a few countries with hundreds of
   entries each will stay well under this. Re-evaluate if scope grows.

---

## References

- ADR-0001: `docs/decisions/0001-vault-and-trust-models.md`
- MonkeMask repo: github.com/f0x1777/MonkeMask
- MonkeDAO monke-asset-api: github.com/MonkeDAO/monke-asset-api
- Helius DAS API: https://docs.helius.dev/compression-and-das-api/digital-asset-standard-das-api
- Sign In With Solana (SIWS) draft: https://github.com/phantom-labs/sign-in-with-solana
- ArcFace paper: Deng et al., 2019 (InsightFace r100 model)
- HKDF (RFC 5869): https://www.rfc-editor.org/rfc/rfc5869
- ed25519 determinism (RFC 8032 §5.1.6): https://www.rfc-editor.org/rfc/rfc8032
- WebCrypto API (HKDF + AES-GCM): https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto
- GDPR Art. 9: https://gdpr.eu/article-9-processing-special-categories-of-personal-data/
- Argentina Ley 25.326: https://servicios.infoleg.gob.ar/infolegInternet/anexos/60000-64999/64790/texact.htm
