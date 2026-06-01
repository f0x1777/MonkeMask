---
name: monkemask
description: Anonymize faces in a group photo by covering each person with their own Solana Monkey Business (SMB) monke, falling back to the generic MonkeDAO DAOJones for anyone unrecognized. Use when the user asks to "monkemask this photo", "cover the faces with monkes", "anonymize this event photo", "put monkes on the faces", "mask the faces with our monkes", or points at a photo from a MonkeDAO / monke community event and wants faces hidden. Runs locally and offline; no photo leaves the machine.
---

# MonkeMask — cover faces with monkes

MonkeMask covers every detected face in a photo with a monke. The primary mode
(`--match`) recognizes **who** each person is and uses **their** monke; anyone it
can't identify gets the generic **MonkeDAO DAOJones** monke. It was built for
MonkeDAO local ambassadors with little to no photo-editing skill — point it at a
group photo and it does the whole job (detect → recognize → cover) on its own.

## When to use

Trigger when the user wants faces in a photo replaced by monkes — especially
community/event group photos where privacy matters. Phrases: "monkemask this",
"cover the faces", "put our monkes on them", "anonymize this photo".

## Prerequisites (check first)

1. The repo is the MonkeMask project (has `src/monkepic/`, `pyproject.toml`,
   `MonkeDAO_DAOJones.png`). If not cloned: `git clone git@github.com:f0x1777/MonkeMask.git`.
2. Environment set up (one time):
   ```bash
   uv venv --python 3.12
   uv pip install -e ".[dev]"
   ```
   First real run downloads ML models (face detector, rembg ~176 MB, InsightFace
   recognition pack) and caches them locally.
3. The person/monke library exists at `OurMonke/NN - Person Name/`, where each
   person folder holds their monke (the file with `SMB` in its name) plus
   reference photos of their face. Without it, every face falls back to DAOJones.

## How to run

Default — recognize each person and use their monke:

```bash
uv run monkepic "<path/to/photo.jpg>" --match
```

Process a whole folder of photos:

```bash
uv run monkepic "<path/to/folder>" --match
```

Also grow the recognition dataset (exports one crop per detected face so they can
be sorted into `OurMonke/<person>/` later):

```bash
uv run monkepic "<path/to/photo.jpg>" --match --export-crops faces/_inbox
```

The result is written next to the input as `<name>-monked.png` (or pass
`--out DIR`). Useful knobs: `--recognition-threshold` (default 0.5, higher =
stricter, more DAOJones), `--min-confidence` (lower if a face is missed),
`--rebuild-gallery` (after adding/removing reference photos), `--min-face-ratio` /
`--min-face-px` (background-face cutoffs).

## After running — ALWAYS verify

1. Open the output image and **look at it**. Confirm every visible face is covered
   and no monke is clipped by the frame edge.
2. Coverage is **not guaranteed 100%** on hard photos (low light, profile, partly
   hidden). If a face is uncovered, re-run with a lower `--min-confidence`
   (e.g. `0.4`); if it still misses, tell the user that face needs manual cover.
   A missed face defeats the privacy purpose — say so explicitly, don't claim
   success you didn't verify.
3. Read stderr for `warning:` lines — they report people who failed to enroll or
   faces whose embedding failed (these silently become DAOJones otherwise).
4. With only one reference photo per person, recognition makes mistakes; the
   threshold is conservative (prefers DAOJones over a wrong guess). More reference
   photos per person improve it.

## Privacy

Everything runs locally/offline. Never upload the user's photos or face crops to
any external service. `Photos/`, `OurMonke/`, `faces/` are gitignored — never
commit them.
