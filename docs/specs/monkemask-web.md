# Spec: MonkeMask Web — manual face→monke pairing UI

- Status: Draft (pending operator approval)
- Date: 2026-06-01
- Owner: nico (@f0x1777)
- Slug: `monkemask-web`
- Rigor: major (new subsystem: web frontend + API backend)
- Builds on: `docs/specs/monkepic.md` (detection + compositing core)

## 1. Problem

The CLI works, but MonkeDAO local ambassadors have little to no editing skill and
won't run a terminal. They need a browser tool: upload an event photo, see the
detected faces, assign a monke to each face by clicking, and download the result.
No Photoshop, no command line.

## 2. Goals

- G1. A web UI where a user uploads a photo, the app detects faces and shows them,
  the user pairs each detected face with a monke, and downloads the composited
  result.
- G2. Reuse the existing `monkepic` Python core (detector, background, geometry,
  compositor) for all image work — the web layer adds no new image logic.
- G3. Run locally with a single documented command (localhost), AND deploy as a
  self-hosted app later (Next.js frontend on Vercel + FastAPI backend elsewhere).
- G4. Privacy: photos are processed on the backend and **deleted right after**;
  nothing is persisted or sent to third parties. Stated plainly in the UI.
- G5. Manual pairing (v1) — no face recognition in the web yet. Deterministic,
  no recognition errors. (Auto-suggest via the existing matcher is a later add.)

## 3. Non-goals (v1)

- NG1. Identity recognition in the browser/back end (manual pairing only).
- NG2. Accounts, auth, multi-user, persistence/history.
- NG3. Client-side (WASM) processing — backend does the work in v1.
- NG4. Editing the monke library through the UI beyond uploading monke images for
  the current session.
- NG5. Mobile-native app.

## 4. Architecture

Two deployables, one shared image core.

```
apps/
  web/            # Next.js (App Router) frontend — deploys to Vercel
  api/            # FastAPI backend — wraps the monkepic core; deploys to a host
                  # that allows the ML deps (Railway/Fly/own VM)
src/monkepic/     # unchanged Python core, imported by apps/api
```

The frontend never touches Python; it calls the API over HTTP. The API is a thin
adapter: it receives uploads, calls `monkepic` functions, returns JSON/images, and
deletes temp files.

### 4.1 Data flow

```
1. User uploads event photo            POST /api/detect (multipart: photo)
   API: detect faces -> return face boxes + base64 face thumbnails + a session id
2. User uploads monke images (session)  POST /api/monkes (multipart: files[])
   API: store in the session tempdir, return ids + thumbnails
3. User assigns monke -> face (UI state, no call)
4. User clicks "Generate"               POST /api/compose (json: session, assignments)
   API: composite each assigned face, return the final PNG
5. API deletes the session tempdir (on compose, on a TTL sweep, and on /api/session DELETE)
```

A **session** is an opaque id naming a tempdir under the system temp root
(`monkemask-<uuid>/`). It holds the uploaded photo and monke files for the few
seconds/minutes of one pairing flow. No database.

### 4.2 Backend modules (`apps/api/`)

```
apps/api/
  main.py          # FastAPI app, CORS, routes
  sessions.py      # create/find/delete session tempdirs; TTL sweep
  service.py       # adapter: bytes-in -> monkepic core -> bytes/JSON-out
  schemas.py       # pydantic request/response models
  tests/
```

- `service.detect(photo_bytes) -> (session_id, [FaceBox], [thumb_png_b64])`:
  loads via `monkepic.loader`, runs `monkepic.detector.FaceDetector`, applies
  `monkepic.facefilter.filter_background`, crops a thumbnail per kept face.
- `service.add_monkes(session_id, [bytes]) -> [MonkeInfo]`: saves monke files,
  returns ids + thumbnails (background pre-removed via `ensure_transparent`,
  cached as today).
- `service.compose(session_id, assignments) -> png_bytes`: for each
  `{face_index, monke_id}`, builds a `Placement` with the SAME geometry the CLI
  uses (`head_box`, `monke_target_size`, `eye_roll`) and calls
  `monkepic.compositor.composite`. Faces with no assignment are left uncovered
  (the UI warns). Returns the final PNG.

No image logic is reimplemented — `service` only marshals bytes and calls the core.

### 4.3 API surface

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/api/detect` | multipart photo | `{session, faces:[{index,x,y,w,h,thumb}]}` |
| POST | `/api/monkes` | multipart files[] + session | `{monkes:[{id,thumb}]}` |
| POST | `/api/compose` | json `{session, assignments:[{face_index,monke_id}]}` | `image/png` |
| DELETE | `/api/session/{id}` | — | `204` (deletes tempdir) |
| GET | `/api/health` | — | `{status:"ok"}` |

Limits: max upload size (e.g. 25 MB photo, 5 MB/monke), allowed types
(png/jpg/webp/avif), max faces/monkes per session.

### 4.4 Frontend (`apps/web/`)

Next.js App Router, one page, three steps in a wizard:

1. **Upload photo** → calls `/api/detect`, shows the photo with numbered boxes over
   detected faces and a strip of face thumbnails.
2. **Add monkes & pair** → upload monke images (`/api/monkes`); a grid of monke
   thumbnails. Click a face, click a monke → assignment shown as an overlay badge.
   Unassigned faces are highlighted. (Stretch: "auto-suggest" button calling a
   future recognition endpoint.)
3. **Generate & download** → calls `/api/compose`, shows the result, Download
   button, and a "Start over" that DELETEs the session.

Privacy note shown in the UI: "Your photo is processed on the server and deleted
right after. It is never stored or shared."

`NEXT_PUBLIC_API_BASE` env var points the frontend at the API (localhost in dev,
the deployed API URL in prod).

## 5. Running locally (acceptance for "works on localhost")

```bash
# backend
uv run uvicorn apps.api.main:app --reload --port 8000
# frontend
cd apps/web && npm install && npm run dev   # http://localhost:3000
```

`apps/web/.env.local`: `NEXT_PUBLIC_API_BASE=http://localhost:8000`.

## 6. Error handling

- No faces detected → API returns `faces: []`; UI says "no faces found" and offers
  to lower the detection threshold (query param) or pick a different photo.
- Unsupported/oversized upload → 400 with a clear message; UI shows it.
- Compose with unassigned faces → allowed, but UI warns "N faces have no monke and
  will stay visible" and requires a confirm.
- Unknown/expired session → 404; UI restarts the flow.
- Monke background removal ambiguous → same fallback as the CLI (compose as-is with
  a logged warning).

## 7. Privacy & security

- Session tempdirs deleted: on compose success, on explicit `DELETE`, and by a TTL
  sweep (e.g. anything older than 30 min) on a background task.
- CORS restricted to the configured frontend origin.
- No analytics, no third-party calls with user images. Document in the UI + README.
- Upload type/size validation server-side (never trust the client).

## 8. Dependencies (added)

- Backend: `fastapi`, `uvicorn`, `python-multipart` (added to a `web` extra in
  `pyproject.toml` so the core install stays slim).
- Frontend: Next.js + React + Tailwind (in `apps/web`, its own `package.json`).

## 9. Acceptance criteria (each maps to ≥1 test)

- AC1. `POST /api/detect` with a photo returns a session id and one face entry per
  non-background detected face, each with a base64 thumbnail (API test, detector
  mocked).
- AC2. `POST /api/monkes` stores uploaded monkes in the session and returns an id +
  thumbnail per monke (API test).
- AC3. `POST /api/compose` with assignments returns a PNG where each assigned face
  region is covered by its monke (API test using the real compositor + a synthetic
  photo/monke; assert pixels changed at face centers).
- AC4. Faces left unassigned are not covered (compose test).
- AC5. `DELETE /api/session/{id}` removes the tempdir; a subsequent call for that
  session returns 404 (session test).
- AC6. The TTL sweep deletes a session tempdir older than the TTL (session test
  with an injected clock).
- AC7. Oversized / unsupported uploads return 400 (API test).
- AC8. `service.compose` uses the SAME geometry as the CLI (unit test asserting the
  `Placement` built for a known face equals what `head_box`/`monke_target_size`/
  `eye_roll` produce — guards against the web drifting from the CLI).
- AC9. End-to-end on localhost: documented commands bring up both servers; a manual
  smoke (Playwright optional) uploads the sample photo, pairs one monke, and
  downloads a non-empty PNG.

## 10. Testing strategy

- **Backend unit:** `service` adapter with the detector mocked; `sessions` TTL +
  delete with an injected clock; geometry-parity test (AC8).
- **Backend integration:** FastAPI `TestClient` over each route, real compositor,
  synthetic images (AC1-AC7).
- **Frontend:** component tests for the wizard state machine (assignment logic,
  unassigned-face warning). E2E (Playwright) optional for AC9.
- **DoD validator:** every AC mapped before PR.

## 11. Open decisions (defaults chosen; override on review)

- Frontend styling: Tailwind + minimal custom components (no heavy UI kit) to keep
  it fast and ambassador-simple.
- Auto-suggest (recognition) endpoint: out of v1; wire the existing
  `gallery`+`recognizer` behind `POST /api/suggest` in a later phase.
- Deployment host for the API: Railway or Fly (allows the ML deps); decided when we
  deploy, not now. Local-first.
