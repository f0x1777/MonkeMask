# MonkePic 🐵

**Local, offline face anonymizer.** Drop in a photo and MonkePic covers every
face with a [Solana Monkey Business](https://solanamonkey.business/) (SMB) monke —
background removed, scaled to the head, positioned, and rotated to the head tilt.

Built for [MonkeDAO Argentina](https://monkedao.io/) to share event photos
without exposing people's faces. Everything runs on your machine — **no photo
ever leaves your computer.**

---

## Why

You want to post a group photo from a meetup, but not everyone wants their face
public. MonkePic replaces faces with monkes automatically, so the vibe stays and
the privacy is kept.

It works in two levels:

1. **Auto-anonymizer** — covers *every* face with a random monke. No setup,
   works on any photo.
2. **Identity matching** — recognizes *who* each person is and gives them
   *their own* monke; strangers get the generic MonkeDAO monke. (Enable with
   `--match`.)

---

## Install

Requires Python ≥ 3.10. We use [uv](https://github.com/astral-sh/uv) for the
environment.

```bash
git clone <this-repo> MonkePic
cd MonkePic
uv venv --python 3.12
uv pip install -e ".[dev]"
```

On first run, ML models download automatically and are cached locally: a face
detector (~0.3 MB), the background remover (~176 MB), and — for `--match` — the
InsightFace recognition pack (~few hundred MB).

---

## Usage

```bash
# Cover every face with a random monke from a folder of monke images
uv run monkepic path/to/photo.jpg --monkes path/to/monkes

# Force one specific monke for all faces
uv run monkepic photo.jpg --monke path/to/one-monke.png

# Process a whole folder of photos at once
uv run monkepic path/to/photos/ --monkes path/to/monkes

# Also export a crop of each detected face (used to build the matching dataset)
uv run monkepic photo.jpg --monkes path/to/monkes --export-crops faces/_inbox

# Write results somewhere else than next to the input
uv run monkepic photo.jpg --monkes path/to/monkes --out some/output/dir
```

By default the result is written **next to the input photo** as
`<name>-monked.png` (e.g. `path/to/photo-monked.png`). Use `--out DIR` to send
results elsewhere.

> **Coverage is not guaranteed to be 100%.** On hard photos (low light, faces in
> profile or partly hidden) the detector can miss a face. Always eyeball the
> result before sharing. If a face is missed, lower `--min-confidence` (e.g. `0.4`)
> and re-run; if it's still missed, cover that one by hand. A missed face defeats
> the privacy purpose.

### Identity matching

Give each person *their own* monke instead of a random one:

```bash
uv run monkepic photo.jpg --match
```

How it works:
- Reads `OurMonke/NN - Person/` — the file with `SMB` in its name is that
  person's monke; any other images are reference photos of their face.
- Recognizes each detected face (InsightFace/ArcFace) and applies that person's
  monke. Unrecognized faces get the generic `MonkeDAO_DAOJones.png`.
- Clearly-background faces (small/distant) are left untouched.

Build the dataset over time: run with `--export-crops faces/_inbox`, then drag
each crop into the right `OurMonke/NN - Person/` folder. More reference photos per
person = better recognition.

> ⚠️ With only one reference photo per person, recognition will make mistakes.
> The threshold is conservative (prefers the generic monke over a wrong guess) and
> accuracy improves as you add more reference photos. Always eyeball the result.

Matching flags: `--ourmonke DIR`, `--generic-monke FILE`,
`--recognition-threshold` (default 0.5), `--min-face-ratio` (0.35),
`--min-face-px` (40), `--rebuild-gallery`.

### Options

| Flag | Default | What it does |
| --- | --- | --- |
| `input` | — | Photo file **or** a directory of photos (processed recursively). |
| `--monkes DIR` | `Argentina Monkes` | Folder of monke images to pick from (png/jpg/webp/avif). |
| `--monke FILE` | — | Use one specific monke for every face (overrides `--monkes`). |
| `--out DIR` | _same folder as input_ | Where results are written. |
| `--margin FLOAT` | `1.0` | How much bigger than the detected face the monke is (`1.0` ≈ 2× the face box, so the whole head is covered). |
| `--no-rotate` | off | Disable 2D rotation (monkes stay upright). |
| `--export-crops DIR` | — | Also save a crop of each detected face to this folder. |
| `--seed INT` | — | Fix the random monke selection (reproducible results). |
| `--min-confidence FLOAT` | `0.6` | Detection threshold. Lower it if a face is missed. |
| `--match` | off | Enable identity matching (see above). |
| `--ourmonke DIR` | `OurMonke` | Person/monke library for matching. |
| `--generic-monke FILE` | `MonkeDAO_DAOJones.png` | Monke for unrecognized faces. |
| `--recognition-threshold F` | `0.5` | Min cosine similarity to accept a match (higher = stricter). |
| `--min-face-ratio F` | `0.35` | Background cutoff relative to the median face size. |
| `--min-face-px INT` | `40` | Absolute background cutoff in pixels. |
| `--rebuild-gallery` | off | Ignore the cached gallery and re-enroll. |

---

## How it works

```
photo ──▶ detect faces ──▶ (matching: drop background faces, recognize each)
                       ──▶ for each face:
                              pick a monke (random, forced, or the person's)
                              remove its background
                              scale to cover the head
                              rotate to the head tilt
                              paste it on
          ──▶ <name>-monked.png  (next to the input)
```

1. **Detect faces** — OpenCV [YuNet](https://github.com/opencv/opencv_zoo) run at
   several resolutions and unioned (no single resolution catches both very large
   and small faces); gives eye keypoints for the tilt. Not guaranteed 100% on hard
   photos — eyeball the result.
2. **Remove the monke's background** — a tiered cascade, picking the cheapest tier
   that works, cached so each monke is processed once:
   - already-transparent PNG → used as-is;
   - flat/solid background → fast color-key cutout;
   - complex background → [rembg](https://github.com/danielgatis/rembg) (U²-Net ML).
3. **Place it** — scale to cover the head (`--margin`), rotate to the eye-line tilt,
   alpha-blend onto the photo.
4. **(With `--match`) recognize** — embed each face with InsightFace/ArcFace,
   compare against the enrolled gallery, and pick that person's monke (or the
   generic one). Background faces are filtered out first.

---

## Project structure

```
MonkePic/
├── src/monkepic/          # the package
│   ├── cli.py             # command-line entry point
│   ├── pipeline.py        # orchestration: detect → cover each face → save
│   ├── detector.py        # OpenCV YuNet face detector wrapper (multi-scale)
│   ├── background.py      # tiered monke-background removal (alpha/solid/ML)
│   ├── geometry.py        # pure math: roll angle, head box, scale-to-cover, IoU
│   ├── compositor.py      # scale + rotate + alpha-blend the monke
│   ├── selector.py        # pick a monke per face (random, no repeats)
│   ├── crops.py           # export face crops (for the matching dataset)
│   ├── facefilter.py      # drop background faces by size (matching)
│   ├── embedder.py        # InsightFace/ArcFace face embeddings (matching)
│   ├── gallery.py         # build/cache the person→embedding gallery (matching)
│   ├── recognizer.py      # cosine match a face to a person (matching)
│   ├── matching.py        # Phase 3 orchestration
│   ├── loader.py          # image I/O incl. AVIF/WebP
│   └── types.py           # FaceRegion, Placement, PersonEntry, MatchResult
├── tests/                 # pytest suite (TDD)
├── docs/specs/            # specs + implementation plans
├── MonkeDAO_DAOJones.png  # generic monke (DAOJones) for unrecognized faces
├── README.md
└── pyproject.toml
```

### Folders you provide (not in git)

These hold images and outputs and are **gitignored** — bring your own:

| Folder | What goes here |
| --- | --- |
| `<monkes>/` | Monke images to use (any folder you pass to `--monkes`). Supports png, jpg, webp, avif. |
| `OurMonke/NN - Person/` | For `--match`: each person's monke (file with `SMB` in the name) plus reference photos of their face. |
| `Photos/` | Input photos to anonymize. Results (`*-monked.png`) land here too, next to each input, unless you pass `--out`. |
| `faces/_inbox/` | Face crops emitted by `--export-crops`, to be sorted for the matching dataset. |
| `models/`, `.monke-cache/` | Auto-downloaded models and cached transparent monkes / gallery. |

> ⚠️ **Privacy:** `Photos/`, `faces/`, `OurMonke/`, the monke folders and all
> generated `*-monked.*` files are gitignored on purpose so real faces and personal
> data are never committed. Keep it that way if you fork this repo.

---

## Development

```bash
uv run pytest          # run the test suite
uv run ruff check src tests   # lint
```

The codebase follows TDD — pure logic (geometry, selection, background tiers,
face filter, recognizer) is unit-tested in isolation; the ML detector and embedder
are mocked in pipeline/matching tests, with skippable real-model smoke tests. See
`docs/specs/monkepic.md` / `docs/specs/monkepic-phase3-matching.md` (specs) and the
matching `*.plan.md` files.

---

## Roadmap

- [x] **Phase 1 — Auto-anonymizer (CLI).** Cover every face with a monke.
- [ ] **Phase 2 — Local web UI.** Drag a photo in the browser, download the result.
- [x] **Phase 3 — Identity matching.** Recognize who each face is and give them
  *their* monke from `OurMonke/`; unknown faces get the generic monke.

---

## License

TBD before public release.
