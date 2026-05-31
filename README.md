# MonkePic

Local, offline tool that covers every face in a photo with a Solana Monkey
Business (SMB) monke — background removed, scaled, positioned and rotated to the
head. Built for MonkeDAO Argentina event-photo privacy.

## Install

```bash
uv venv --python 3.12
uv pip install -e ".[dev]"
```

## Use

```bash
# Anonymize one photo with a random monke per face from a pool
uv run monkepic "Photos/Event-MiniGolf-24-04-2026/raw-pic.jpg" --monkes "Argentina Monkes" --out output

# Force one specific monke
uv run monkepic photo.jpg --monke "OurMonke/01 - Nico/Nico - SMB #3053 .png"

# Also export face crops to build the Phase 3 enrollment dataset
uv run monkepic photo.jpg --export-crops faces/_inbox
```

Then drag each crop from `faces/_inbox/` into the matching `faces/<Person>/`
folder. Over a few events this builds the recognition dataset for Phase 3
(identity matching).

## How it works (Phase 1)

1. Detect every face (OpenCV YuNet) → bounding box + eye keypoints.
2. Pick a monke per face (random, no repeats within a photo).
3. Remove the monke's background — tiered: existing alpha → solid-color cutout →
   `rembg` ML fallback for complex backgrounds (cached in `.monke-cache/`).
4. Scale to cover the head, rotate to the head tilt (eye-line roll), composite.

## Privacy

Everything runs locally. The only network access is a one-time model-weights
download (face detector / rembg) on first run. No photo ever leaves your machine.

## Roadmap

- Phase 2 — local web UI (Gradio) over the same core.
- Phase 3 — identity matching: recognize who each face is and place *their* monke
  from `OurMonke/`; unknown faces get a generic monke.

See `docs/specs/monkepic.md` for the full spec and `docs/specs/monkepic.plan.md`
for the implementation plan.
