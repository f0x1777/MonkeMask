# Spec: MonkeMask Web — auto-suggest (in-session recognition)

- Status: Draft (pending operator approval)
- Date: 2026-06-01
- Owner: nico (@f0x1777)
- Slug: `monkemask-web-autosuggest`
- Rigor: major (adds ML recognition to the web subsystem)
- Builds on: `docs/specs/monkemask-web.md` (manual pairing) and
  `docs/specs/monkepic-phase3-matching.md` (the recognition engine)

## 1. Problem

Manual pairing works but is tedious for big group photos. The ambassador wants an
"Auto" button: the app recognizes each detected face and pre-fills its monke, then
they review/correct before generating. Per the operator's decision, recognition is
**in-session**: the user uploads each person's monke **and** reference photos of
that person's face; the app enrolls them for this session only. Faces with no
confident match are reported, and the user confirms using the generic DAOJones for
them.

## 2. Goals

- G1. In the web, let the user define people for the session: for each person, a
  monke image + one or more reference face photos.
- G2. An "Auto-suggest" action that, for every detected face, computes an embedding,
  matches it against the session people, and pre-fills `assign[faceIndex] = monkeId`
  for confident matches.
- G3. Faces with no confident match are listed back to the user; the UI offers
  "use DAOJones for these" which assigns the generic monke to each.
- G4. Pre-fill only — the user stays on the pairing step and can change any
  assignment before generating (operator's choice).
- G5. Reuse the existing recognition engine (`embedder`, `gallery`-style averaging,
  `recognizer`) — no new ML logic.
- G6. Privacy unchanged: reference photos live in the session tempdir and are
  deleted with the session.

## 3. Non-goals

- NG1. Using the server-side `OurMonke/` library (this flow is fully user-supplied,
  per operator decision). A future variant could add it.
- NG2. Auto-generating without review (we pre-fill and stay on the pairing step).
- NG3. Persisting people/embeddings across sessions.

## 4. Data flow (extends the manual flow)

```
existing: POST /api/detect (photo) -> session + faces
existing: POST /api/monkes (files) -> monke ids + thumbs

NEW — define people for the session:
  POST /api/people  (multipart: session, name, monke_id, faces[])
     -> stores reference faces under the session, embeds them, returns
        {person_id, name, monke_id, n_refs, usable_refs}
     (a person links an already-uploaded monke_id to >=1 reference face photo)

NEW — recognize the detected faces:
  POST /api/suggest (json: {session})
     -> for each detected face: embed -> match against session people
        returns {suggestions:[{face_index, person_id, monke_id, similarity}],
                 unmatched:[face_index,...]}

then the existing POST /api/compose runs unchanged with the chosen assignments.
```

### 4.1 Backend

- `service.enroll_person(session_dir, faces_paths, embedder, detector) -> embedding`:
  reuse `gallery.build`-style logic — detect+embed each reference face, average,
  L2-normalize. Returns `None` (with a warning) if no reference face is usable.
- `service.suggest(photo_path, people, embedder, detector, threshold) ->
  (suggestions, unmatched)`: detect faces (filtered), embed each, run a
  `Recognizer` built from the session people; collect confident matches and the
  unmatched face indices.
- A `Person` record per session is held in `sessions` (in-memory map keyed by
  session id): `{person_id, name, monke_id, embedding, n_refs}`. Reference images
  saved under `<session>/people/<person_id>/`.

### 4.2 API additions

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/api/people` | multipart: session, name, monke_id, faces[] | `{person_id, name, monke_id, n_refs, usable_refs}` |
| GET | `/api/people?session=…` | — | `{people:[…]}` |
| POST | `/api/suggest` | json `{session}` | `{suggestions:[…], unmatched:[…]}` |

Validation: monke_id must exist in the session; faces[] type/size checked like
other uploads; cap people per session.

### 4.3 Frontend

In step 2, add a "People (for Auto)" sub-panel:
- For each person: a name field, pick one uploaded monke, upload reference face
  photo(s). "Add person" posts to `/api/people` and shows `usable_refs`
  (warns if 0 → not enrolled).
- An **Auto-suggest** button calls `/api/suggest`, then sets `assign` from the
  returned suggestions. Shows "Matched N of M faces."
- If `unmatched` is non-empty, show "K faces weren't recognized" with a button
  **"Use DAOJones for the rest"** → assigns the generic monke to each unmatched
  face (the generic monke is uploaded/selected as a normal monke, or we add a
  `/api/generic` that exposes the shipped `MonkeDAO_DAOJones.png` as a monke id).
- All assignments remain editable; user clicks Generate as before.

To make DAOJones available as a monke id without the user uploading it, add a
small endpoint:

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/api/generic` | json `{session}` | `{id, thumb}` — copies the shipped DAOJones into the session monkes |

## 5. Error handling

- Person with no usable reference face → not enrolled; UI shows `usable_refs: 0`
  and a warning. They can add more photos.
- `/api/suggest` with no enrolled people → all faces unmatched; UI suggests adding
  people or using DAOJones for all.
- Embedding failure on a detected face → that face is unmatched (logged), never a
  silent wrong assignment.
- threshold conservative default (reuse 0.5) so wrong-person is rarer than
  fallback-to-unmatched.

## 6. Privacy

- Reference face photos and embeddings live only in the session tempdir / in-memory
  map; deleted on session DELETE and TTL sweep. Documented in the UI.

## 7. Acceptance criteria (each maps to ≥1 test)

- AC1. `POST /api/people` with a monke_id + reference face(s) returns a person with
  `usable_refs >= 1` when at least one reference face embeds (detector+embedder
  mocked); `usable_refs == 0` (and not enrolled) when none do.
- AC2. `POST /api/suggest` returns, for a face whose embedding matches an enrolled
  person above threshold, a suggestion with that person's `monke_id`; and lists
  faces below threshold in `unmatched` (mocked embedder with known vectors).
- AC3. `/api/suggest` with no enrolled people returns all faces in `unmatched`.
- AC4. `/api/generic` adds the shipped DAOJones as a session monke and returns its
  id + thumb; a subsequent compose can use it.
- AC5. People/reference data is removed when the session is deleted (session test).
- AC6. Frontend: after Auto-suggest, matched faces show as assigned; an
  "use DAOJones for the rest" control assigns the generic to every unmatched face
  (component/E2E test).
- AC7. Existing manual flow and `--match` CLI are unaffected (regression).

## 8. Testing strategy

- Backend unit/integration: `enroll_person` and `suggest` with detector+embedder
  mocked (deterministic vectors); FastAPI TestClient over the new routes; session
  cleanup test.
- Frontend: E2E (Playwright) — upload photo, add a person (monke + a reference face
  = one of the detected face crops saved as a file), Auto-suggest, assert at least
  one face becomes assigned, then "use DAOJones for the rest", Generate, download.
  Screenshots per step.
- DoD validator: every AC mapped before PR.

## 9. Open decisions (defaults chosen; override on review)

- Reuse recognition threshold 0.5; expose as a slider later if needed.
- DAOJones exposure via `/api/generic` (simplest) vs bundling it in the monke list
  on session creation — start with `/api/generic`.
- People panel UX kept minimal (name + monke + photos); richer management later.
