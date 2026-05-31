# Spec: MonkePic — face anonymizer with SMB monkes

- Status: Draft (pending operator approval)
- Date: 2026-05-31
- Owner: nico
- Slug: `monkepic`
- Rigor: major (new project, computer-vision pipeline) — full TDD + DoD validator

## 1. Problem

We share group photos from MonkeDAO Argentina events. We want to protect the
privacy of the people in them by covering each face with a Solana Monkey Business
(SMB) monke image, instead of publishing real faces. Doing this by hand (one
layer per face, scaled and rotated) is slow and does not scale to group photos or
to many events.

We want a local, offline tool that takes a photo and returns the same photo with
every face replaced by a monke — correctly sized, positioned, and rotated so it
looks deliberate rather than a flat sticker.

Two levels of intelligence are envisioned:

- **Tool 1 — Auto-anonymizer (no identity).** Detect every face and cover it with
  a generic/configurable monke. Works with zero prior data.
- **Tool 2 — Identity matching.** Recognize *who* each face is and place *their*
  assigned monke (from `OurMonke/`); unknown faces get a generic monke. Requires
  an enrollment dataset (reference face photos per person).

## 2. Goals

- G1. Cover all detected faces in a photo with a transparent-background monke,
  scaled to the head, positioned over the face, and rotated to match head tilt
  (2D roll).
- G2. Handle monke source images that are AVIF / WebP / PNG / JPG, with or without
  an alpha channel; remove a solid background automatically when there is no alpha.
- G3. Run 100% locally and offline (privacy is the whole point). No photo ever
  leaves the machine.
- G4. Expose the same core pipeline through a CLI and a local web UI.
- G5. Export a crop of every detected face so the operator can manually sort crops
  into per-person folders, incrementally building the enrollment dataset for Tool 2.
- G6. Use the existing `OurMonke/NN - Person/` folders as the person→monke mapping
  for Tool 2 (no separate config to maintain).

## 3. Non-goals (for now)

- NG1. 3D head pose (yaw/pitch) / perspective warping of the monke. Only 2D roll.
- NG2. Real-time video. Still images only.
- NG3. Automatic, hands-free enrollment. Enrollment is operator-curated (drag
  crops into folders); the tool only *produces* the crops.
- NG4. Cloud hosting / multi-user deployment. Local web only.
- NG5. On-chain / wallet integration to fetch NFTs. Monkes come from local folders.

## 4. Phasing

The product ships in phases. Each phase is independently useful and reuses the
prior phase's core.

- **Phase 1 — Core + Tool 1 (CLI).** Detection → background cutout → geometry
  (scale/position/rotate) → composite → write output. Plus face-crop export.
  **This spec specifies Phase 1 in full detail; it is the implementation scope of
  the first plan.**
- **Phase 2 — Local web UI.** Thin UI over the Phase 1 core: upload a photo,
  preview the result, download. Default tech: Gradio (fastest to build, reuses the
  Python core, fully local). FastAPI + custom frontend is the alternative if more
  visual control is wanted later.
- **Phase 3 — Tool 2 (identity matching).** Enrollment from curated face crops +
  face-recognition embeddings (ArcFace/dlib) + automatic person→monke assignment
  from `OurMonke/`. Unrecognized faces fall back to a generic monke.

Phases 2 and 3 are described at the architecture level here and will each get their
own spec + plan when started.

## 5. Data model and folder conventions

All paths are relative to the project root and are external inputs (gitignored).

- `OurMonke/NN - Person Name/<monke>.<ext>` — one subfolder per person; the image
  inside is that person's assigned monke. This is the canonical person→monke map
  (used in Phase 3). The leading `NN - ` index and the person name are parsed from
  the folder name.
- `Argentina Monkes/` — the larger master monke library plus MonkeDAO brand
  resources. Source pool for generic monkes in Phase 1.
- `Photos/<event>/...` — input photos to process.
- `faces/<Person Name>/*.jpg` — curated reference face crops per person (Phase 3
  enrollment input). Built up over time by the operator.
- `faces/_inbox/<source-stem>__face_<n>.png` — unsorted face crops emitted by
  Tool 1. The operator drags each crop into the right `faces/<Person>/` folder.
- `output/<same-relative-path>-monked.<ext>` — processed photos.
- `.monke-cache/<hash>.png` — cached transparent cutouts of monke images (so the
  background is removed once per monke, not per run).

## 6. Architecture (Phase 1)

Small, single-purpose modules with explicit interfaces. Geometry and selection are
pure functions (no I/O, no ML) so they are fully unit-testable. Python package
`monkepic` under `src/`.

```
src/monkepic/
  detector.py     # FaceDetector: image -> list[FaceRegion]
  background.py   # ensure_transparent(monke_image) -> RGBA image (alpha or solid-bg cutout)
  geometry.py     # pure: head-box expansion, scale, roll angle, placement
  selector.py     # MonkeSelector: choose monke(s) for a set of faces (seedable RNG)
  compositor.py   # paste a rotated/scaled RGBA monke onto the base image
  crops.py        # export face crops to faces/_inbox/
  pipeline.py     # orchestrates the above end to end
  loader.py       # image I/O incl. AVIF/WebP decode, format-preserving save
  cli.py          # argparse entrypoint
tests/
```

### 6.1 Types

- `FaceRegion`: bounding box `(x, y, w, h)` in pixels, plus keypoints
  `left_eye (x,y)`, `right_eye (x,y)` (from the detector). Optional
  `confidence: float`.
- `Placement`: target center `(cx, cy)`, target size `(w, h)`, `roll_deg: float`.

### 6.2 detector.py

- Wraps MediaPipe Face Detection (model: short-range or full-range depending on
  photo). Returns one `FaceRegion` per detected face above a confidence threshold.
- Provides `left_eye` / `right_eye` keypoints used to compute roll.
- Behind a small interface so it can be swapped (e.g., OpenCV DNN, RetinaFace)
  and mocked in tests.

### 6.3 background.py — monke background removal (tiered)

Removes the **monke image's** background so it composites cleanly (this is NOT
the photo's background, which is never touched). `ensure_transparent(img) -> RGBA`
runs a cascade and stops at the first tier that succeeds:

1. **Alpha present** → if the image already has a meaningful alpha channel, return
   as-is (converted to RGBA). Many SMB PNGs are already transparent. (AC5)
2. **Solid background** → sample the four corners; if they agree within a tolerance
   (flat background), take the median as the background color, flood-fill from the
   borders within tolerance, set those pixels to alpha 0, lightly feather the edge.
   Fast, deterministic, no ML. Covers the typical SMB case. (AC4)
3. **Complex background fallback** → if corners disagree (no flat background) or the
   solid-color cut leaves too much/too little, fall back to **`rembg` (U²-Net, a
   local ML model)** to segment the subject. Handles AVIF/WebP monkes with
   gradient/noisy edges. Model weights download once and run fully offline. (AC12)

- The chosen tier is logged so results are explainable.
- Every result is cached to `.monke-cache/` keyed by a content hash of the source
  image, so each monke's background is removed once, not once per run.
- `is_solid_background(img) -> bool` and the tier functions are individually
  unit-testable with synthetic images (flat-bg, alpha, gradient-bg).

### 6.4 geometry.py (pure)

- `roll_degrees(left_eye, right_eye) -> float`: angle of the eye line vs horizontal.
- `head_box(face_region, margin) -> (cx, cy, w, h)`: expand the face bbox by a
  configurable margin so the monke covers the whole head (forehead/chin/sides),
  centered on the face center (eye midpoint biased slightly down).
- `monke_target_size(head_box, monke_aspect) -> (w, h)`: size the monke to cover
  the head box while preserving the monke's aspect ratio.
- All functions are deterministic and unit-tested with hand-computed expectations.

### 6.5 selector.py

- `MonkeSelector(pool, seed)`: choose one monke per face.
- Phase 1 policy: random **without repetition within a single photo** when the
  pool size ≥ face count; once exhausted, allow repeats and emit a warning.
- Seedable RNG for deterministic tests. (Phase 3 overrides selection with
  identity-based assignment.)

### 6.6 compositor.py

- `composite(base, monke_rgba, placement) -> image`: scale the monke to
  `placement` size, rotate by `placement.roll_deg` (expand canvas, keep alpha),
  alpha-blend it onto `base` centered at `placement` center.

### 6.7 crops.py

- `export_crops(image, regions, dest, source_stem)`: write one crop per face to
  `faces/_inbox/<source-stem>__face_<n>.png`, padded around the face box. Used to
  seed Phase 3 enrollment. Deterministic naming.

### 6.8 pipeline.py

End-to-end for one photo:

1. Load image (loader).
2. Detect faces (detector).
3. If no faces → copy original to output, warn, return.
4. Export face crops (crops) if `--export-crops`.
5. Select a monke per face (selector).
6. For each face: `ensure_transparent` the monke (background), compute
   `head_box` + `roll` + `monke_target_size` (geometry), build a `Placement`,
   composite (compositor).
7. Save output preserving format (loader).

Supports a single file or a directory (recursively process supported images).

### 6.9 cli.py

```
monkepic [INPUT] [options]
  INPUT                 photo file or directory
  --monkes DIR          monke pool dir (default: "Argentina Monkes")
  --monke FILE          force one specific monke for all faces
  --out DIR             output dir (default: "output")
  --margin FLOAT        head-box margin (default ~0.4)
  --no-rotate           disable 2D roll
  --export-crops        also write face crops to faces/_inbox/
  --seed INT            RNG seed for reproducible selection
  --min-confidence F    detector threshold
```

## 7. Error handling

- No faces detected → copy original to output unchanged + warning (not an error).
- Empty / missing monke pool and no `--monke` → error out with a clear message.
- Unreadable / unsupported input file → skip with a warning, continue the batch.
- AVIF/WebP decode failure → warning naming the file; continue.
- Background removal ambiguous (no clear solid bg, no alpha) → composite the monke
  as-is with a warning (better a visible box than a crash); rembg is the future fix.
- Monke pool smaller than face count with no-repeat policy → allow repeats + warn.

## 8. Privacy

- Fully offline. The only network access is a one-time model-weights download for
  the detector during install/first run; no photo data is transmitted. Document
  this explicitly in the README. (Phase 3 recognition models are likewise local.)

## 9. Dependencies (Phase 1)

- `mediapipe` (face detection + eye keypoints)
- `Pillow` + `pillow-heif` (or `pillow-avif-plugin`) for AVIF/WebP I/O
- `numpy`
- `rembg` (U²-Net) — ML fallback for complex monke backgrounds (tier 3, §6.3).
  Local/offline after one-time weights download.
- `pytest` (dev), `ruff` (lint), TDD throughout
- Packaging/env: `uv` + `pyproject.toml`
- Phase 2: `gradio`. Phase 3: `face_recognition` (dlib) or `insightface`.

## 10. Acceptance criteria (Phase 1) — each maps to ≥1 test

- AC1. A photo with N detectable faces produces an output with a monke composited
  over each of the N faces.
- AC2. The monke is rotated to match the eye-line roll (geometry unit test with
  known eye points → known angle; pipeline test asserts rotation applied).
- AC3. The monke is scaled to cover the head box (face bbox expanded by the margin),
  preserving the monke's aspect ratio (geometry unit test).
- AC4. A monke with a solid background and no alpha yields a cutout with
  transparent border/corners via the solid-color tier (background unit test).
- AC5. A monke that already has alpha is used unchanged (background unit test).
- AC12. A monke with a non-solid/gradient background (corners disagree) is routed
  to the `rembg` ML fallback and yields a transparent-background cutout; the
  selected tier is reported (background unit test; rembg may be mocked to keep the
  test fast, with one non-mocked smoke test).
- AC6. With multiple faces, all are covered (pipeline test, detector mocked to
  return 3 regions → 3 composites).
- AC7. Selection is non-repeating within a photo when pool ≥ faces, and falls back
  to repeats with a warning when pool < faces (seeded selector unit test).
- AC8. `--export-crops` writes exactly one crop per detected face to `faces/_inbox/`
  with deterministic names (crops unit test).
- AC9. A photo with no detectable faces is copied to output unchanged with a
  warning (pipeline test).
- AC10. The CLI processes both a single file and a directory of photos (CLI
  integration test).
- AC11. An AVIF (and a WebP) monke loads and composites correctly (loader test
  with a sample asset).

## 11. Testing strategy

- **Unit (pure):** geometry (roll, head-box, sizing), selector (seeded), background
  tiers (synthetic solid-bg, synthetic alpha, synthetic gradient-bg → rembg
  fallback, mocked), crops naming.
- **Integration:** pipeline with the detector mocked to return fixed regions, so
  composition logic is tested without depending on the ML model; assert outputs
  are written and the right number of composites happened.
- **Smoke:** run the real detector on `Photos/Event-MiniGolf-24-04-2026/raw-pic.jpg`
  and assert ≥1 face detected (kept separate / skippable if the model is absent).
- **DoD validator:** every AC above has a mapped test before PR.

## 12. Open decisions (defaults chosen; override on review)

- Web UI tech: **Gradio** (Phase 2 default). — confirm when Phase 2 starts.
- Detector model: MediaPipe short-range first; add full-range fallback if group
  photos miss small/distant faces.
- Head-box margin default (~0.4) to be tuned against the MiniGolf photo.
