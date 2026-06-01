# Spec: MonkePic Phase 3 — identity matching

- Status: Draft (pending operator approval)
- Date: 2026-05-31
- Owner: nico
- Slug: `monkepic-phase3-matching`
- Rigor: major (new ML subsystem) — full TDD + DoD validator
- Builds on: `docs/specs/monkepic.md` (Phase 1 — auto-anonymizer)

## 1. Problem

Phase 1 covers every face with a **random** monke. The real goal is: each person
gets **their own** monke. The mapping person→monke already exists in the folder
layout (`OurMonke/NN - Person/`), and those folders now also contain reference
photos of each person's real face. We need to recognize who each detected face is
and place that person's monke; anyone we can't identify gets the MonkeDAO generic
monke (DAOJones); faces that are clearly background (small, distant strangers) get
no monke at all.

## 2. Goals

- G1. Build a face-recognition **gallery** from `OurMonke/`: per person, average the
  embeddings of their reference face photos.
- G2. For each detected face in a photo, compute its embedding and assign:
  - the matched person's monke if similarity ≥ a conservative threshold;
  - else the **generic** monke (DAOJones).
- G3. **Skip background faces** (too small relative to the group and too small in
  absolute pixels) — leave them untouched.
- G4. Local/offline (InsightFace ONNX models, downloaded once).
- G5. Reuse the entire Phase 1 vision pipeline (detection, background removal,
  geometry, compositing) unchanged. Phase 3 only adds enrollment, recognition, and
  the background-face filter, and a new selection policy.
- G6. Opt-in via a `--match` CLI flag. Without it, Phase 1 behavior is unchanged.

## 3. Non-goals

- NG1. Re-identifying the *same* unknown person across photos with a consistent
  generic monke. All unknowns get the same DAOJones. (Future.)
- NG2. Training/fine-tuning a model. We use pretrained ArcFace embeddings only.
- NG3. Manual face-tagging UI. Enrollment is folder-based.
- NG4. Guaranteeing correctness with 1 reference photo per person — see §10.

## 4. Folder conventions (enrollment input)

Reuses the existing layout — no reorganization needed.

```
OurMonke/NN - Person Name/
    <something with "SMB" in the name>.<ext>   # the person's MONKE (avatar to paste)
    <other images>.<ext>                        # reference photos of the person's face
MonkeDAO_DAOJones.png                     # generic monke (ships with the repo)
```

Rules:
- In each person folder, files whose name contains `SMB` (case-insensitive) are the
  **monke**; all other images are **face reference photos**.
- A person with no face reference photos is **not** enrolled (their faces will fall
  back to generic). Today 10 of ~30 are enrolled.
- `Potential - *` and `_generic` folders are ignored for enrollment (no `NN - `
  index, or reserved name).
- The generic monke default is `MonkeDAO_DAOJones.png`, overridable with
  `--generic-monke`.

## 5. Architecture

New modules under `src/monkepic/`, alongside Phase 1:

```
src/monkepic/
  embedder.py     # FaceEmbedder: image+FaceRegion -> 512-d L2-normalized vector (InsightFace/ArcFace)
  gallery.py      # build/load/save the person->embedding gallery; parse OurMonke layout
  recognizer.py   # match a face embedding against the gallery (cosine, threshold)
  facefilter.py   # pure: drop background faces by size (combined rule)
  matching.py     # Phase-3 orchestration: enroll -> per face recognize -> choose monke
```

Unchanged Phase 1 modules reused: `detector`, `background`, `geometry`,
`compositor`, `loader`, `crops`, `types`, plus `pipeline` (extended with a monke-
chooser hook so matching can override random selection).

### 5.1 Types (extend `types.py`)

- `PersonEntry`: `name: str`, `monke_path: Path`, `embedding: np.ndarray | None`,
  `n_refs: int`.
- `MatchResult`: `person: str | None`, `similarity: float`, `monke_path: Path`,
  `is_generic: bool`.

### 5.2 embedder.py

- `FaceEmbedder.embed(image, region) -> np.ndarray`: crop the face region (with
  padding), run InsightFace ArcFace, return a 512-d L2-normalized vector.
- Lazy model load; cached instance. Behind an interface so tests mock it.

### 5.3 gallery.py

- `parse_person_folder(dir) -> (monke_path, [face_photo_paths])` using the `SMB`
  rule.
- `build_gallery(ourmonke_dir, embedder, detector) -> list[PersonEntry]`:
  for each `NN - Person` folder, detect+embed each face photo, average and
  re-normalize → the person's embedding. Skip persons with no face photos.
- Cache to `.monke-cache/gallery.npz` keyed by a hash of the folder contents
  (paths + mtimes); rebuild when reference photos change.

### 5.4 recognizer.py

- `Recognizer(gallery, threshold)`: `match(embedding) -> MatchResult`.
- Cosine similarity vs every enrolled person; best match wins if
  `similarity >= threshold` (default 0.5, conservative). Else `person=None`,
  `is_generic=True`, `monke_path = generic`.

### 5.5 facefilter.py (pure)

- `keep_face(region, median_side, min_ratio, min_px) -> bool`:
  drop (return False) only when **both** hold — `region_side < min_ratio *
  median_side` **and** `region_side < min_px`. Otherwise keep.
- `filter_background(regions, min_ratio=0.35, min_px=40) -> list[FaceRegion]`:
  compute the median of face sides, apply `keep_face` to each. With 0–1 faces,
  keep all (no meaningful median).

### 5.6 matching.py

`process_image_matched(src, ourmonke_dir, out_dir, detector, embedder, *,
threshold, min_ratio, min_px, generic_monke, margin, rotate, crops_dir) -> Path`:

1. Load image, detect faces (Phase 1 detector).
2. `filter_background` → drop background faces.
3. Build/load gallery (cached).
4. For each kept face: embed → `Recognizer.match` → `MatchResult`.
5. Compose each face with its chosen monke using the Phase 1 compositor/geometry/
   background pipeline.
6. Optionally export crops (kept faces only).
7. Save output.

`pipeline.process_image` is refactored minimally to accept a `choose_monke`
callback (default: random selector). Matching passes a callback that returns each
face's `monke_path`. This keeps composition logic in one place (DRY).

## 6. CLI additions

```
monkepic INPUT --match [options]
  --match                       enable identity matching (Phase 3)
  --ourmonke DIR                person/monke library (default: "OurMonke")
  --generic-monke FILE          default: MonkeDAO_DAOJones.png
  --recognition-threshold F     default 0.5 (higher = stricter)
  --min-face-ratio F            default 0.35 (background cutoff vs median)
  --min-face-px INT             default 40 (absolute background cutoff)
  --rebuild-gallery             ignore the cache and re-enroll
```

Without `--match`, all existing Phase 1 flags/behavior are unchanged.

## 7. Error handling

- No enrolled persons (empty/no face photos) → warn; every face → generic.
- Generic monke file missing → error with a clear message (it ships in `assets/`).
- A reference photo with no detectable face → skip it with a warning; person still
  enrolls from remaining photos (or is skipped if none usable).
- Face embedding fails on a detected face → treat as unrecognized → generic.
- All faces filtered as background → output equals input + warning.

## 8. Privacy

- Fully local; InsightFace models download once. Reference photos and embeddings
  never leave the machine. `OurMonke/`, `.monke-cache/` remain gitignored; only the
  generic monke (`assets/`) is committed.

## 9. Dependencies (added)

- `insightface` + `onnxruntime` (already present from Phase 1's rembg).
- `cairosvg` (already added) — to rasterize SVG monkes like DAOJones to PNG.
- Reuses numpy, Pillow, opencv.

## 10. Known limitation: cold-start accuracy

With ~1 reference photo per person and a hard low-light/profile group photo,
recognition **will** make identity mistakes. This is expected and accepted: the
conservative threshold biases toward "generic" over "wrong person", and accuracy
improves automatically as more reference photos accrue per person (each event adds
crops via `--export-crops`). Documented in the README so users set expectations.

## 11. Acceptance criteria (each maps to ≥1 test)

- AC1. `parse_person_folder` classifies the `SMB`-named file as the monke and the
  rest as face photos.
- AC2. `build_gallery` produces one entry per person that has ≥1 usable face photo,
  with an L2-normalized averaged embedding; persons with no face photos are skipped
  (embedder + detector mocked).
- AC3. `Recognizer.match` returns the correct person when cosine ≥ threshold
  (mocked embeddings with known vectors).
- AC4. `Recognizer.match` returns generic (`is_generic=True`, `person=None`) when
  the best similarity < threshold.
- AC5. `keep_face` drops a face only when it is below BOTH the relative and absolute
  size cutoffs; keeps it if it fails only one.
- AC6. `filter_background` keeps all faces when there are ≤1 (no median).
- AC7. With `--match`, a recognized face is composited with that person's monke and
  an unrecognized face with the generic monke (matching orchestration, mocks).
- AC8. Without `--match`, behavior is identical to Phase 1 (regression test).
- AC9. Background faces are not composited (a small region produces no monke).
- AC10. Gallery cache is reused on a second run and rebuilt with `--rebuild-gallery`
  or when reference photos change.
- AC11. Smoke (real models, skippable): enroll `OurMonke/`, run on the MiniGolf
  photo; at least one enrolled person is assigned their own (non-generic) monke.

## 12. Testing strategy

- **Unit (pure):** `facefilter` (size rules), `gallery.parse_person_folder`
  (SMB rule), `recognizer` (cosine + threshold with fixed vectors).
- **Integration:** `build_gallery` and `matching` with embedder + detector mocked
  to return deterministic vectors/regions — exercises orchestration without ML.
- **Regression:** `--match` off equals Phase 1 output.
- **Smoke (real, skippable):** enroll + run on the sample photo; assert ≥1
  non-generic assignment. Skipped if models/photo absent.
- **DoD validator:** every AC mapped before PR.

## 13. Open decisions (defaults chosen; override on review)

- Recognition threshold default 0.5 (cosine on ArcFace) — tune on real data.
- Background cutoffs: `min_ratio=0.35`, `min_px=40` — tune on the MiniGolf photo.
- InsightFace model pack: `buffalo_l` (accurate) vs `buffalo_s` (smaller/faster) —
  start with `buffalo_l`, expose if needed.
