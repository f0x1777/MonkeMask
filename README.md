# MonkeMask 🐵

**Face anonymizer for group photos.** Drop in a photo and MonkeMask covers every
face with a [Solana Monkey Business](https://solanamonkey.business/) (SMB) monke —
background removed, scaled to the head, positioned, and rotated to the head tilt.

Built for [MonkeDAO](https://monkedao.io/) to share event photos
without exposing people's faces.

> Built by [@f0x1777](https://x.com/f0x1777) of the Argentina Chapter 🇦🇷
> for the rest of the world. 🌎

## ▶️ Try it now (no install)

**[monkemask.vercel.app](https://monkemask.vercel.app)** — a hosted web app. Upload
a group photo, pair each face with a monke, drag to fine-tune in a live preview, and
download the result. The photo is processed on the server and **deleted right after**
— never stored or shared.

## 🔒 Or run it yourself (100% private)

Prefer total privacy? Run it locally — **fully self-hosted, no photo ever leaves
your machine.** The CLI and the same web app both run offline (the only network
access is a one-time ML model download). Self-hosting also lets you **feed it your
own people** so it recognizes who's who and gives each person *their* monke
automatically. See [Install](#install) and [Web app](#web-app-no-terminal-needed).

> Designed for **local ambassadors with little to no photo-editing skill**: no
> Photoshop, no manual masking — point it at a group photo and it does the whole
> job (detect → recognize → cover) on its own.

---

## Why

You want to post a group photo from a meetup, but not everyone wants their face
public. MonkeMask recognizes who each person is and covers their face with **their
own monke**. Anyone it can't identify gets the generic **MonkeDAO DAOJones** monke.
The vibe stays, the privacy is kept, and nobody touches an image editor.

- Each recognized person → **their** monke (from `OurMonke/`).
- Unrecognized faces → the generic **DAOJones** monke.
- Clearly-background faces (small/distant strangers) → left untouched.

---

## Install

Requires Python ≥ 3.10. We use [uv](https://github.com/astral-sh/uv) for the
environment.

```bash
git clone git@github.com:f0x1777/MonkeMask.git
cd MonkeMask
uv venv --python 3.12
uv pip install -e ".[dev]"
```

On first run, ML models download automatically and are cached locally: a face
detector (~0.3 MB), the background remover (~176 MB), and the InsightFace
recognition pack (~few hundred MB).

---

## Usage

The main mode: **each person gets their own monke** (`--match`).

```bash
# Cover each face with that person's monke; unknown faces -> DAOJones
uv run monkepic photo.jpg --match

# Process a whole folder of photos at once
uv run monkepic path/to/photos/ --match

# Also export a crop of each detected face, to grow the recognition dataset
uv run monkepic photo.jpg --match --export-crops faces/_inbox

# Write results somewhere else than next to the input
uv run monkepic photo.jpg --match --out some/output/dir
```

How it works:
- Reads `OurMonke/NN - Person/` — the file with `SMB` in its name is that
  person's monke; any other images are reference photos of their face.
- Recognizes each detected face (InsightFace/ArcFace) and applies **that person's
  monke**. Faces it can't identify get the generic **`MonkeDAO_DAOJones.png`**.
- Clearly-background faces (small/distant) are left untouched.

By default the result is written **next to the input photo** as
`<name>-monked.png`. Use `--out DIR` to send results elsewhere.

Build the dataset over time: run with `--export-crops faces/_inbox`, then drag
each crop into the right `OurMonke/NN - Person/` folder. More reference photos per
person = better recognition.

> ⚠️ **Two things to keep in mind.** (1) With only one reference photo per person,
> recognition will make mistakes; the threshold is conservative (prefers DAOJones
> over a wrong guess) and accuracy improves as you add more reference photos.
> (2) Coverage is not guaranteed 100% — on hard photos a face can be missed.
> Always eyeball the result before sharing; a missed face defeats the purpose.

### Options

| Flag | Default | What it does |
| --- | --- | --- |
| `input` | — | Photo file **or** a directory of photos (processed recursively). |
| `--match` | — | Identity matching: each person their own monke, unknown → DAOJones. **The mode you want.** |
| `--out DIR` | _same folder as input_ | Where results are written. |
| `--export-crops DIR` | — | Also save a crop of each detected face (to grow the dataset). |
| `--ourmonke DIR` | `OurMonke` | Person/monke library for matching. |
| `--generic-monke FILE` | `MonkeDAO_DAOJones.png` | Monke for unrecognized faces. |
| `--recognition-threshold F` | `0.5` | Min cosine similarity to accept a match (higher = stricter). |
| `--min-face-ratio F` | `0.35` | Background cutoff relative to the median face size. |
| `--min-face-px INT` | `40` | Absolute background cutoff in pixels. |
| `--rebuild-gallery` | — | Ignore the cached gallery and re-enroll. |
| `--margin FLOAT` | `1.0` | How much bigger than the detected face the monke is (`1.0` ≈ 2× the face box). |
| `--no-rotate` | off | Disable 2D rotation (monkes stay upright). |
| `--min-confidence FLOAT` | `0.6` | Face-detection threshold. Lower it if a face is missed. |

<details>
<summary>Advanced: low-level monke selection (no recognition)</summary>

These bypass recognition and exist mainly for testing the compositing pipeline.
For real use, prefer `--match`.

| Flag | What it does |
| --- | --- |
| `--monkes DIR` | Pick a **random** monke per face from a folder (no recognition). |
| `--monke FILE` | Use one specific monke for **every** face. |
| `--seed INT` | Fix the random selection (reproducible). |

</details>

---

## Web app (no terminal needed)

A browser version for ambassadors who don't want the command line: upload a
photo, the app shows the detected faces, you click a face then click a monke to
pair them, and download the result. The photo is processed on the server and
**deleted right after** — never stored or shared.

Run it locally (two terminals):

```bash
# 1. backend (FastAPI) — reuses the same Python core as the CLI
uv pip install -e ".[dev,web]"
uv run uvicorn apps.api.main:app --reload --port 8000

# 2. frontend (Next.js)
cd apps/web
cp .env.local.example .env.local   # points at http://localhost:8000
npm install
npm run dev                        # http://localhost:3000
```

The frontend (`apps/web`) is built to deploy to Vercel; the backend
(`apps/api`) runs the ML work and deploys to a host that allows it
(Railway/Fly/own VM). v1 is **manual pairing** — automatic recognition (reusing
the `--match` engine) is a planned follow-up. See
`docs/specs/monkemask-web.md`.

---

## How it works

```
photo ──▶ detect faces ──▶ drop background faces ──▶ recognize each face
                       ──▶ for each face:
                              pick that person's monke (or DAOJones)
                              remove its background
                              scale to cover the head
                              rotate to the head tilt
                              paste it on (kept fully inside the frame)
          ──▶ <name>-monked.png  (next to the input)
```

1. **Detect faces** — OpenCV [YuNet](https://github.com/opencv/opencv_zoo) run at
   several resolutions and unioned (no single resolution catches both very large
   and small faces); gives eye keypoints for the tilt. Not guaranteed 100% on hard
   photos — eyeball the result.
2. **Recognize** — embed each (non-background) face with InsightFace/ArcFace,
   compare against the enrolled gallery, and pick that person's monke, or the
   generic DAOJones when unknown.
3. **Remove the monke's background** — a tiered cascade, picking the cheapest tier
   that works, cached so each monke is processed once:
   - already-transparent PNG → used as-is;
   - flat/solid background → fast color-key cutout;
   - complex background → [rembg](https://github.com/danielgatis/rembg) (U²-Net ML).
4. **Place it** — scale to cover the head (`--margin`), rotate to the eye-line tilt,
   slide it fully inside the frame so it is never clipped, alpha-blend onto the photo.

---

## Project structure

```
MonkeMask/
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
| `OurMonke/NN - Person/` | Each person's monke (file with `SMB` in the name) plus reference photos of their face. The core of `--match`. |
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

- [x] **CLI core.** Detect, cover, scale/rotate, never-clip compositing.
- [x] **Identity matching.** Recognize who each face is and give them *their*
  monke from `OurMonke/`; unknown faces get the generic DAOJones.
- [ ] **Local web UI.** Upload monkes + photos in the browser, associate each
  monke with a person, and the app does the rest. Self-hosted (Vercel UI +
  processing backend).

---

## License

MIT © [f0x1777](https://github.com/f0x1777). See [LICENSE](LICENSE).
