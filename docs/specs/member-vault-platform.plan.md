# Implementation Plan: member-vault-platform

**Spec**: `docs/specs/member-vault-platform.md`
**ADR**: `docs/decisions/0001-vault-and-trust-models.md`
**Branch**: `feature/member-vault-platform`

---

## Overview

Four phases. Phase 1 is fully detailed with bite-sized TDD tasks. Phases 2-4
are outlined at task-title granularity.

Phase 1 establishes the foundation: the wallet-signature determinism spike
(de-risks the entire encryption model before any of it is built), the `/v2`
route scaffold, SIWS authentication with allowlist gate, WebCrypto
envelope-encryption primitives, and the Supabase schema.

Each Phase 1 task is independently committable. Failing tests come first.

---

## Operator inputs required before Phase 1 completes

- **Determinism spike results (before Task 4):** run the Task 1 harness with
  your Phantom, Solflare, Backpack, and Ledger wallets. Report which pass and
  which fail. This determines whether Ledger gets a graceful-degradation path
  or is blocked from `/v2` with an explanation.
- **Initial allowlist (before Task 4):** provide the 20-30 wallet addresses,
  with role (`ambassador` / `global_admin` / `super_admin`) and country (ISO
  3166-1 alpha-2) for each. Identify the `super_admin` bootstrap wallet first.

---

## Phase 1 — Foundation

### Task 1: Wallet-Signature Determinism Spike [AC-6]

**This task gates all subsequent work. Complete it before writing any
envelope-encryption code.**

- File: `apps/web/src/lib/crypto/determinism-spike.test.ts` (new)
- File: `apps/web/src/lib/crypto/determinism-spike.ts` (new)

**Change:**
Write a self-contained test harness (runnable in a browser or with a Jest/Vitest
environment) that:
1. Accepts a wallet adapter (`signMessage`-capable, e.g. Phantom via
   `@solana/wallet-adapter-phantom`).
2. Signs the string `"MonkeMask-v2-KEK-v1-determinism-check"` (UTF-8 encoded)
   ten times using the wallet.
3. Compares all ten 64-byte signatures byte-for-byte.
4. Returns `{ deterministic: boolean, signatures: Uint8Array[], walletName: string }`.
5. Throws a typed error `WalletDeterminismError` if any signature differs.

The test file imports the harness and exercises it with a mock wallet that
returns a fixed signature (happy path) and a mock that varies the signature on
the third call (failure path).

The harness is also the implementation that will be called during real vault
setup in Task 4 (the SIWS auth hook will call `checkDeterminism()` after
first sign-in for a new wallet, before any key material is written).

**Commit message template:**
```
feat: wallet determinism spike harness + unit tests

Refs: docs/specs/member-vault-platform.md
```

**Verify:**
```bash
cd apps/web
npx vitest run src/lib/crypto/determinism-spike.test.ts
```
Both the happy-path and failure-path tests pass.

**Operator action:** after unit tests pass, run the harness in the browser with
your real wallets. Record results. Report before Task 4 begins.

---

### Task 2: `/v2` Route Scaffold [AC-1, AC-2]

- File: `apps/web/src/app/(v2)/layout.tsx` (new)
- File: `apps/web/src/app/(v2)/page.tsx` (new)
- File: `apps/web/src/app/(v2)/sign-in/page.tsx` (new)
- File: `apps/web/src/app/(v2)/dashboard/page.tsx` (new, placeholder)
- File: `apps/web/src/app/(v2)/layout.test.tsx` (new)

**Change:**
Create the `(v2)` route group in Next.js App Router. The group layout:
1. Exports a `V2Layout` server component that checks for a valid `v2_session`
   JWT cookie. If absent, redirects to `/(v2)/sign-in`. The JWT validation
   itself is a stub at this stage (always fail → always redirect) until Task 3
   adds real auth.
2. `/v2/sign-in` renders a "Connect Wallet" page (static HTML + one `use client`
   component shell, no wallet adapter wired yet).
3. `/v2/dashboard` renders a placeholder "You are authenticated" page.
4. `/` (the existing ephemeral flow) is not touched. Verify by checking that
   `apps/web/src/app/page.tsx` is unchanged and that the `/` route continues to
   render the existing upload UI.

The layout test asserts:
- A request to `/v2/dashboard` without a JWT cookie renders a redirect to
  `/v2/sign-in`.
- A request to `/v2/dashboard` with a mock valid JWT renders the dashboard
  placeholder (not a redirect).
- A request to `/` renders the existing page content unchanged (regression
  guard).

**Commit message template:**
```
feat: /v2 route group scaffold with auth-redirect layout

Refs: docs/specs/member-vault-platform.md
```

**Verify:**
```bash
cd apps/web && npx vitest run src/app/\(v2\)/layout.test.tsx
```

---

### Task 3: Supabase Schema — allowlist, auth_nonces, wrapped_keys, audit_log [AC-2, AC-3, AC-5]

- File: `supabase/migrations/20260601000001_v2_allowlist.sql` (new)
- File: `supabase/migrations/20260601000002_v2_auth_nonces.sql` (new)
- File: `supabase/migrations/20260601000003_v2_wrapped_keys.sql` (new)
- File: `supabase/migrations/20260601000004_v2_audit_log.sql` (new)
- File: `supabase/migrations/20260601000005_v2_rls_policies.sql` (new)
- File: `supabase/tests/v2_rls.test.sql` (new, pgTAP)

**Change:**
Write the SQL migrations for the four tables defined in the spec:

`allowlist (id, wallet_pubkey, role, country, added_by, added_at, removed_at, notes)`
- UNIQUE constraint on `wallet_pubkey`.
- CHECK: `role IN ('ambassador', 'global_admin', 'super_admin')`.
- CHECK: `(role = 'ambassador' AND country IS NOT NULL) OR (role != 'ambassador')`.

`auth_nonces (nonce, created_at, expires_at, consumed_at)`
- Primary key on `nonce`.

`wrapped_keys (id, wallet_pubkey, scope, wrapped_key, key_version, created_at, superseded_at)`
- UNIQUE on `(wallet_pubkey, scope)` WHERE `superseded_at IS NULL`.

`audit_log (id bigserial, actor_wallet, action, target_country, target_id, metadata, created_at)`
- Append-only trigger: function that raises `EXCEPTION` on UPDATE or DELETE.
- RLS: INSERT via service role. SELECT for `super_admin` JWT role claim only.

RLS policies for `allowlist`:
- `SELECT` own row: `auth.jwt() ->> 'wallet_pubkey' = wallet_pubkey`.
- Full CRUD via service role function `v2_allowlist_upsert(...)` (called only
  from server-side API routes with service role key).

RLS policies for `wrapped_keys`:
- `SELECT` own active rows: `auth.jwt() ->> 'wallet_pubkey' = wallet_pubkey AND superseded_at IS NULL`.
- No client INSERT/UPDATE/DELETE.

pgTAP test assertions:
- An `ambassador` JWT can SELECT their own `allowlist` row and their own
  `wrapped_keys` rows; cannot SELECT another wallet's rows.
- An `ambassador` JWT cannot INSERT into `audit_log`.
- A service-role call can INSERT into `audit_log`; a subsequent SELECT by
  `super_admin` JWT returns the row.
- An UPDATE/DELETE on `audit_log` raises an exception.

**Commit message template:**
```
feat: Supabase v2 schema — allowlist, auth_nonces, wrapped_keys, audit_log + RLS

Refs: docs/specs/member-vault-platform.md
```

**Verify:**
```bash
# Apply migrations to local Supabase dev instance
supabase db reset
supabase test db
# Should show all pgTAP assertions passing
```

---

### Task 4: SIWS Auth Endpoint + Allowlist Gate [AC-2, AC-3, AC-5]

- File: `apps/web/src/app/api/v2/auth/nonce/route.ts` (new)
- File: `apps/web/src/app/api/v2/auth/verify/route.ts` (new)
- File: `apps/web/src/app/api/v2/auth/refresh/route.ts` (new)
- File: `apps/web/src/app/api/v2/auth/signout/route.ts` (new)
- File: `apps/web/src/lib/auth/v2-session.ts` (new)
- File: `apps/web/src/app/api/v2/auth/verify/route.test.ts` (new)

**Change:**
`GET /api/v2/auth/nonce`:
- Generate 32 random bytes (hex-encoded).
- INSERT into `auth_nonces` (expires_at = now() + 5 min) via service role.
- Return `{ nonce }`.

`POST /api/v2/auth/verify` body: `{ pubkey: string, signature: string (base58 or hex), nonce: string }`:
1. Verify the nonce exists in `auth_nonces`, is not consumed, and is not expired.
2. Reconstruct the SIWS message string (same deterministic template as the spec).
3. Verify the ed25519 signature using `@noble/ed25519` (verify the message against
   the pubkey).
4. Mark the nonce consumed (`consumed_at = now()`).
5. Query `allowlist` WHERE `wallet_pubkey = pubkey AND removed_at IS NULL`.
   - If no row: return `403 { "error": "wallet_not_authorised" }`.
   - If row present: read `role` and `country` from the row.
6. Mint a JWT: `{ wallet_pubkey, role, country, iat, exp: now()+15min }`.
   Sign with `V2_JWT_SECRET` (env var, never exposed to client).
7. Set httpOnly Secure SameSite=Strict cookie `v2_session` with the JWT.
8. Set a separate httpOnly cookie `v2_refresh` (7-day, rotated on use).
9. Write `audit_log` row: `action='auth.signin', actor_wallet=pubkey`.
10. Return `{ role, country }` (no JWT in body).

On allowlist failure: write `audit_log` row: `action='auth.denied', actor_wallet=pubkey`.

`v2-session.ts`: exports `getSessionFromCookie(req)` that parses and validates the
JWT from the `v2_session` cookie. Returns `{ wallet_pubkey, role, country }` or
`null`. Used by the layout server component and all `/api/v2/*` route handlers.

Test file assertions (using Next.js `Request` mocks):
- Valid pubkey + signature + nonce for an allowlisted wallet returns 200 +
  `Set-Cookie` header containing `v2_session`.
- Valid pubkey + signature + nonce for a non-allowlisted wallet returns 403
  `wallet_not_authorised`.
- Expired nonce returns 400 `nonce_expired`.
- Already-consumed nonce returns 400 `nonce_consumed`.
- Invalid signature returns 401 `signature_invalid`.
- Non-allowlisted wallet sign-in attempt is written to `audit_log`.

**Commit message template:**
```
feat: SIWS auth endpoints + allowlist gate for /v2

Refs: docs/specs/member-vault-platform.md
```

**Verify:**
```bash
cd apps/web
npx vitest run src/app/api/v2/auth/verify/route.test.ts
```
All assertions pass.

---

### Task 5: Wallet Connect UI + SIWS Sign-In Flow [AC-2, AC-6]

- File: `apps/web/src/app/(v2)/sign-in/WalletSignIn.tsx` (new, `use client`)
- File: `apps/web/src/app/(v2)/sign-in/WalletSignIn.test.tsx` (new)
- File: `apps/web/package.json` (modify: add `@solana/wallet-adapter-react`,
  `@solana/wallet-adapter-phantom`, `@solana/wallet-adapter-solflare`,
  `@solana/wallet-adapter-backpack`, `@solana/web3.js`)

**Change:**
`WalletSignIn.tsx` — a React client component that:
1. Renders a "Connect Wallet" button. On click, opens the wallet adapter modal.
2. On wallet connected, calls `GET /api/v2/auth/nonce` to fetch a nonce.
3. Constructs the SIWS message string.
4. Calls the determinism check from Task 1 (`checkDeterminism(wallet,
   KEK_DERIVATION_MESSAGE)`). If check fails: display an error ("This wallet
   cannot be used with MonkeMask v2 because it produces non-deterministic
   signatures. Please use Phantom, Solflare, or Backpack.") and stop.
5. If check passes: call `wallet.signMessage(siwsMessage)`.
6. POST `{pubkey, signature, nonce}` to `/api/v2/auth/verify`.
7. On 200: redirect to `/v2/dashboard`.
8. On 403 (`wallet_not_authorised`): display "Your wallet is not on the
   MonkeMask v2 allowlist. Contact the operator to be added."
9. On any other error: display a generic retry message.

Wrap `apps/web/src/app/(v2)/layout.tsx` in a `WalletAdapterProvider`
(configured with supported wallets from `@solana/wallet-adapter-*`).

Test assertions (React Testing Library + vitest):
- Renders a "Connect Wallet" button in initial state.
- Simulates a successful sign-in sequence (mocked wallet, mocked fetch); asserts
  redirect is called with `/v2/dashboard`.
- Simulates a 403 response; asserts the "not on allowlist" message is displayed.
- Simulates a determinism check failure; asserts the non-determinism error is
  displayed and the SIWS step is never reached.

**Commit message template:**
```
feat: wallet connect UI + SIWS sign-in flow with determinism check

Refs: docs/specs/member-vault-platform.md
```

**Verify:**
```bash
cd apps/web
npx vitest run src/app/\(v2\)/sign-in/WalletSignIn.test.tsx
```

---

### Task 6: WebCrypto Envelope-Encryption Primitives [AC-7]

- File: `apps/web/src/lib/crypto/envelope.ts` (new)
- File: `apps/web/src/lib/crypto/envelope.test.ts` (new)

**Change:**
`envelope.ts` exports the following pure WebCrypto functions (no side effects,
no network calls, no wallet calls — crypto primitives only):

```typescript
// Derive a 32-byte KEK from a wallet signature (ed25519, 64 bytes raw)
async function deriveKEK(walletSignature: Uint8Array): Promise<CryptoKey>

// Wrap a raw symmetric key (CK or GK, 32 bytes) under a KEK
// Returns: 12-byte IV || AES-256-GCM ciphertext
async function wrapKey(kek: CryptoKey, keyToWrap: Uint8Array): Promise<Uint8Array>

// Unwrap a wrapped key using a KEK
// Input: 12-byte IV || AES-256-GCM ciphertext (from wrapKey)
async function unwrapKey(kek: CryptoKey, wrappedKey: Uint8Array): Promise<Uint8Array>

// Encrypt arbitrary plaintext bytes under a symmetric key (CK or GK)
// Returns: 12-byte IV || AES-256-GCM ciphertext
async function encrypt(key: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array>

// Decrypt
async function decrypt(key: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array>

// Generate a new random 32-byte symmetric key (for CK/GK generation by super_admin)
function generateSymmetricKey(): Uint8Array
```

`deriveKEK` implementation:
```
HKDF-SHA256(
  ikm  = walletSignature,           // 64-byte ed25519 signature
  salt = TextEncoder("MonkeMask-v2-KEK-v1"),
  info = TextEncoder("kek"),
  len  = 32
)
→ import as AES-GCM key (extractable=false, usages=[wrapKey, unwrapKey, encrypt, decrypt])
```

Test assertions (vitest, uses `globalThis.crypto` — available in Node 18+ and browsers):
- `wrapKey(kek, ck)` then `unwrapKey(kek, wrapped)` returns the original CK
  byte-for-byte.
- `encrypt(ck, plaintext)` then `decrypt(ck, ciphertext)` returns the original
  plaintext byte-for-byte.
- Decrypting with a different key (wrong KEK → wrong CK after unwrap) throws
  or returns garbage (assert throws).
- `deriveKEK` with the same input always returns a key that produces the same
  `wrapKey` output (deterministic derivation).
- Two different wallet signatures (different `ikm`) produce different KEKs
  (assert wrapped outputs differ).
- `generateSymmetricKey` returns 32 bytes; successive calls return different
  values.

**Commit message template:**
```
feat: WebCrypto envelope-encryption primitives (HKDF KEK, AES-GCM wrap/encrypt)

Refs: docs/specs/member-vault-platform.md
```

**Verify:**
```bash
cd apps/web
npx vitest run src/lib/crypto/envelope.test.ts
```
All assertions pass, including the round-trip and wrong-key tests.

---

### Task 7: encrypted_country_rosters Schema + RLS [AC-3, AC-7]

- File: `supabase/migrations/20260601000006_v2_country_roster.sql` (new)
- File: `supabase/tests/v2_country_roster_rls.test.sql` (new, pgTAP)

**Change:**
Migration creates `encrypted_country_rosters`:

```sql
CREATE TABLE encrypted_country_rosters (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country       text NOT NULL,
  ciphertext    bytea NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  key_version   integer NOT NULL DEFAULT 1,
  record_count  integer,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text NOT NULL
);

CREATE UNIQUE INDEX ON encrypted_country_rosters (country);
```

RLS policies:
- SELECT: `auth.jwt() ->> 'country' = country AND auth.jwt() ->> 'role' = 'ambassador'`
  OR `auth.jwt() ->> 'role' IN ('global_admin', 'super_admin')`.
- UPDATE/INSERT: `auth.jwt() ->> 'country' = country AND auth.jwt() ->> 'role' = 'ambassador'`
  (ambassadors can write their own country's blob) OR `super_admin` role.
- No client DELETE (service role only).

pgTAP assertions:
- An `ambassador` JWT with `country='AR'` can SELECT the `AR` row; cannot SELECT
  the `BR` row.
- An `ambassador` JWT with `country='AR'` can UPDATE the `AR` row; cannot UPDATE
  the `BR` row.
- A `global_admin` JWT can SELECT any country row; cannot UPDATE any row.
- A `super_admin` JWT can SELECT and UPDATE any row.

**Commit message template:**
```
feat: encrypted_country_rosters table + RLS

Refs: docs/specs/member-vault-platform.md
```

**Verify:**
```bash
supabase db reset
supabase test db
```

---

### Task 8: consent_records Schema + RLS [AC-9]

- File: `supabase/migrations/20260601000007_v2_consent_records.sql` (new)
- File: `supabase/tests/v2_consent_rls.test.sql` (new, pgTAP)

**Change:**
Migration creates `consent_records` as defined in the spec. Key constraints:
- No DELETE in RLS policies (consent records are append-only).
- `granted_at` defaults to `now()`.
- CHECK: `consent_type IN ('country_roster_enrollment', 'global_registry_promotion')`.

Append-only enforcement: add the same trigger pattern used in `audit_log` —
raise EXCEPTION on DELETE attempts.

pgTAP assertions:
- An `ambassador` JWT with `country='AR'` can INSERT a consent record with
  `country='AR'`; cannot INSERT with `country='BR'`.
- `super_admin` can SELECT all consent records.
- DELETE on a consent_records row raises an exception.
- UPDATE to set `revoked_at` is permitted for the inserting ambassador and
  for `super_admin`.

**Commit message template:**
```
feat: consent_records table + RLS + append-only trigger

Refs: docs/specs/member-vault-platform.md
```

**Verify:**
```bash
supabase db reset
supabase test db
```

---

### Task 9: monke_library_cache Schema + RLS [AC-10]

- File: `supabase/migrations/20260601000008_v2_monke_library_cache.sql` (new)
- File: `supabase/tests/v2_monke_library_cache_rls.test.sql` (new, pgTAP)

**Change:**
Migration creates `monke_library_cache` as defined in the spec. RLS: all
operations scoped to `wallet_pubkey = auth.jwt() ->> 'wallet_pubkey'`.

pgTAP assertions:
- A JWT for wallet A can INSERT and SELECT their own rows; cannot SELECT
  wallet B's rows.

**Commit message template:**
```
feat: monke_library_cache table + RLS

Refs: docs/specs/member-vault-platform.md
```

**Verify:**
```bash
supabase db reset
supabase test db
```

---

### Phase 1 Completion Checkpoint

All of the following must be true before Phase 2 begins:

- [ ] Tasks 1-9 all committed on `feature/member-vault-platform`.
- [ ] All unit tests pass: `cd apps/web && npx vitest run`.
- [ ] All RLS tests pass: `supabase db reset && supabase test db`.
- [ ] Operator has run the determinism spike against real wallets and confirmed
  which wallets are deterministic.
- [ ] Operator has provided the initial allowlist (wallet addresses + roles +
  countries).
- [ ] `/` ephemeral flow is manually verified to be unaffected (load the app
  locally, upload a photo, complete the pairing flow, confirm download works).

---

## Phase 2 — Encrypted Country Roster + SMB Library + Client-Side Matching

Task titles (each 2-5 min implementation blocks; detailed plans follow Phase 1 approval):

- **P2-T1:** Helius DAS API client + holdings fetch (`apps/web/src/lib/helius/das.ts`)
- **P2-T2:** Gen3 chroma-key background removal in the browser (WebAssembly or
  canvas-based; reuse `monkepic` logic)
- **P2-T3:** Gen2 flood-fill background removal (canvas-based fallback)
- **P2-T4:** Monke library UI — display holdings grid in `/v2/dashboard`; cache
  metadata in `monke_library_cache`
- **P2-T5:** Reference photo → ArcFace embedding via API call (the API returns
  only the embedding; the photo is discarded server-side; no embedding is stored
  in plaintext)
- **P2-T6:** Consent capture UI + `consent_records` INSERT before any association
  is stored
- **P2-T7:** Country roster client-side write — encrypt new association into the
  roster JSON, re-encrypt blob with CK, UPSERT `encrypted_country_rosters` row
- **P2-T8:** Country roster client-side read — fetch blob, decrypt with CK, parse
  roster JSON, display associations
- **P2-T9:** Client-side cosine similarity matching — given a query embedding and
  the decrypted roster, return sorted matches above threshold [AC-8, AC-11]
- **P2-T10:** Pairing session integration — wire client-side matching into the
  existing manual pairing flow at `/v2`; auto-suggest pairings with threshold gate
- **P2-T11:** Association management screen — add, rename, delete associations
  (delete = remove from JSON, re-encrypt, write back blob + consent revocation)
- **P2-T12:** Regression test: run `/` ephemeral flow end-to-end after Phase 2
  changes; assert zero regressions [AC-1]

---

## Phase 3 — Global Registry Promotion + Global Admin Matching + Consent/Deletion

Task titles:

- **P3-T1:** `encrypted_global_registry` table + RLS migration
- **P3-T2:** `wrapped_keys` rows for `global_admin` wallets + GK generation UI
  (super_admin setup screen)
- **P3-T3:** Global registry promotion flow — super_admin client-side merge of
  country rosters + re-encrypt under GK + write `encrypted_global_registry` blob
- **P3-T4:** Global admin sign-in + GK unwrap + global registry decrypt in-browser
- **P3-T5:** Global admin event-coverage session — query face against global
  registry client-side, ranked results display [AC-8]
- **P3-T6:** Deletion request flow — consent revocation, roster blob re-encryption
  without the deleted record, global registry update if promoted, audit log [AC-9]
- **P3-T7:** Deletion SLA enforcement — verify 72-hour window with a test using
  an injected clock; surface pending deletions in the UI for the responsible
  ambassador
- **P3-T8:** Consent record browser — ambassador view (own country), super_admin
  view (all countries), with filter and CSV export
- **P3-T9:** Regression test: `/` ephemeral flow + Phase 2 country roster flows
  still work after Phase 3 changes

---

## Phase 4 — Admin Panel

Task titles:

- **P4-T1:** `/v2/admin` route group with `super_admin` role gate
- **P4-T2:** Allowlist management UI — add/remove wallets, assign role + country,
  view active/removed entries; calls `v2_allowlist_upsert` service role function
- **P4-T3:** CK rotation on ambassador removal — generate new CK, re-wrap for
  remaining ambassadors of that country, re-encrypt roster blob, delete old
  wrapped_keys row, audit log
- **P4-T4:** Key rotation pending-actions UI — surfaces countries with a removed
  ambassador whose CK has not been rotated yet; tracks against rotation SLA
- **P4-T5:** Global registry promotion admin screen — country selector, trigger
  client-side merge + re-encrypt flow from P3-T3
- **P4-T6:** Deletion request queue — list pending deletions with 72-hour
  deadline countdown, status (pending / in-progress / completed), link to
  responsible ambassador
- **P4-T7:** Audit log viewer — search by action type, wallet, country, date
  range; paginated; cannot edit
- **P4-T8:** Monke inventory browser — SMB token → wallet mappings; flag
  duplicate-monke conflicts
- **P4-T9:** Consent record export — CSV export of all consent records, filtered
  by country / type / date range
- **P4-T10:** Regression test: all Phase 1-3 tests still pass; end-to-end
  smoke of the full add-ambassador → roster-write → global-promote →
  delete-record flow
