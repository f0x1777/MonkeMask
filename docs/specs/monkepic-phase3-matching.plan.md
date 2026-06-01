# MonkePic Phase 3 (identity matching) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognize who each detected face is and cover it with that person's monke from `OurMonke/`; unrecognized faces get the generic DAOJones monke; clearly-background faces are left untouched.

**Architecture:** Add five small modules (embedder, gallery, recognizer, facefilter, matching) on top of the existing Phase 1 vision pipeline. Pure logic (size filter, folder parsing, cosine match) is unit-tested in isolation; InsightFace embedding and the detector are mocked in orchestration tests, with one skippable real-model smoke test. `pipeline.process_image` is refactored to take a `choose_monke` callback so composition stays in one place.

**Tech Stack:** Python ≥3.10, insightface + onnxruntime (ArcFace embeddings), numpy, opencv (YuNet, already used), Pillow, pytest, ruff, uv.

Refs: docs/specs/monkepic-phase3-matching.md

---

## File structure

```
src/monkepic/
  types.py        # MODIFY: add PersonEntry, MatchResult
  facefilter.py   # NEW: pure background-face size filter
  gallery.py      # NEW: parse OurMonke layout, build/cache person->embedding gallery
  embedder.py     # NEW: FaceEmbedder (InsightFace ArcFace) behind an interface
  recognizer.py   # NEW: cosine match embedding -> MatchResult
  pipeline.py     # MODIFY: choose_monke callback (keep random as default)
  matching.py     # NEW: Phase-3 orchestration
  cli.py          # MODIFY: --match and related flags
tests/
  test_facefilter.py test_gallery.py test_recognizer.py
  test_matching.py test_pipeline_choose.py test_cli_match.py
  test_matching_smoke.py
```

Implementation order: pure modules first (types, facefilter, recognizer), then
gallery, then the pipeline refactor, then matching orchestration, then CLI, then
README + smoke.

---

## Task 1: Add Phase 3 types

**Files:**
- Modify: `src/monkepic/types.py`
- Test: `tests/test_recognizer.py` (uses them in Task 3)

- [ ] **Step 1: Add the dataclasses**

Append to `src/monkepic/types.py`:
```python
from pathlib import Path  # add near the top with the other imports


@dataclass(frozen=True)
class PersonEntry:
    """An enrolled person: their name, their monke image, and the averaged
    face embedding built from their reference photos."""

    name: str
    monke_path: Path
    embedding: "tuple[float, ...] | None"
    n_refs: int


@dataclass(frozen=True)
class MatchResult:
    """The outcome of matching one face: who it is (or None), the similarity, the
    monke to paste, and whether we fell back to the generic monke."""

    person: str | None
    similarity: float
    monke_path: Path
    is_generic: bool
```

Note: `embedding` is stored as a plain tuple of floats so `PersonEntry` stays
hashable/frozen; numpy arrays are converted at the boundary in `gallery`/`recognizer`.

- [ ] **Step 2: Sanity import**

Run: `uv run python -c "from monkepic.types import PersonEntry, MatchResult; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add src/monkepic/types.py
git commit -m "feat: add PersonEntry and MatchResult types

Refs: docs/specs/monkepic-phase3-matching.md"
```

---

## Task 2: facefilter (pure background-face filter)

**Files:**
- Create: `src/monkepic/facefilter.py`
- Test: `tests/test_facefilter.py`

- [ ] **Step 1: Write the failing test**

`tests/test_facefilter.py`:
```python
from monkepic.facefilter import filter_background, keep_face
from monkepic.types import FaceRegion


def _region(side):
    return FaceRegion(0, 0, side, side, (0.0, 0.0), (float(side), 0.0))


def test_keep_face_drops_only_when_both_small():
    # small relative AND small absolute -> drop
    assert keep_face(_region(20), median_side=200, min_ratio=0.35, min_px=40) is False
    # small relative but big absolute -> keep
    assert keep_face(_region(60), median_side=200, min_ratio=0.35, min_px=40) is True
    # big relative but small absolute -> keep
    assert keep_face(_region(30), median_side=50, min_ratio=0.35, min_px=40) is True


def test_filter_background_drops_tiny_far_face():
    regions = [_region(200), _region(210), _region(190), _region(20)]
    kept = filter_background(regions)
    assert len(kept) == 3
    assert all(r.w >= 190 for r in kept)


def test_filter_background_keeps_all_when_one_face():
    regions = [_region(15)]  # no median to compare against
    assert filter_background(regions) == regions


def test_filter_background_empty():
    assert filter_background([]) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_facefilter.py -v`
Expected: FAIL (ModuleNotFoundError: monkepic.facefilter)

- [ ] **Step 3: Implement**

`src/monkepic/facefilter.py`:
```python
from __future__ import annotations

from statistics import median

from .types import FaceRegion


def _side(region: FaceRegion) -> float:
    """Representative face size: the larger of width/height."""
    return max(region.w, region.h)


def keep_face(
    region: FaceRegion, median_side: float, min_ratio: float = 0.35, min_px: int = 40
) -> bool:
    """Keep a face unless it is background: dropped only when it is BOTH smaller
    than ``min_ratio`` of the group's median face AND smaller than ``min_px`` px."""
    side = _side(region)
    too_small_relative = side < min_ratio * median_side
    too_small_absolute = side < min_px
    return not (too_small_relative and too_small_absolute)


def filter_background(
    regions: list[FaceRegion], min_ratio: float = 0.35, min_px: int = 40
) -> list[FaceRegion]:
    """Drop clearly-background faces by size. With 0-1 faces there is no meaningful
    median, so all are kept."""
    if len(regions) <= 1:
        return regions
    med = median(_side(r) for r in regions)
    return [r for r in regions if keep_face(r, med, min_ratio, min_px)]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_facefilter.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/facefilter.py tests/test_facefilter.py
git commit -m "feat: add background-face size filter (AC5,AC6)

Refs: docs/specs/monkepic-phase3-matching.md"
```

---

## Task 3: recognizer (cosine match + threshold)

**Files:**
- Create: `src/monkepic/recognizer.py`
- Test: `tests/test_recognizer.py`

- [ ] **Step 1: Write the failing test**

`tests/test_recognizer.py`:
```python
from pathlib import Path

import numpy as np

from monkepic.recognizer import Recognizer
from monkepic.types import PersonEntry


def _person(name, vec):
    v = np.array(vec, dtype=float)
    v = v / np.linalg.norm(v)
    return PersonEntry(name=name, monke_path=Path(f"{name}.png"),
                       embedding=tuple(v.tolist()), n_refs=1)


def _norm(vec):
    v = np.array(vec, dtype=float)
    return v / np.linalg.norm(v)


GALLERY = [_person("nico", [1, 0, 0]), _person("jero", [0, 1, 0])]
GENERIC = Path("MonkeDAO_DAOJones.png")


def test_match_returns_person_above_threshold():
    rec = Recognizer(GALLERY, GENERIC, threshold=0.5)
    res = rec.match(_norm([0.9, 0.1, 0.0]))
    assert res.person == "nico"
    assert res.is_generic is False
    assert res.monke_path == Path("nico.png")
    assert res.similarity > 0.5


def test_match_falls_back_to_generic_below_threshold():
    rec = Recognizer(GALLERY, GENERIC, threshold=0.95)
    res = rec.match(_norm([0.6, 0.55, 0.0]))
    assert res.person is None
    assert res.is_generic is True
    assert res.monke_path == GENERIC


def test_match_empty_gallery_is_generic():
    rec = Recognizer([], GENERIC, threshold=0.5)
    res = rec.match(_norm([1.0, 0.0, 0.0]))
    assert res.is_generic is True
    assert res.person is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_recognizer.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: Implement**

`src/monkepic/recognizer.py`:
```python
from __future__ import annotations

from pathlib import Path

import numpy as np

from .types import MatchResult, PersonEntry


class Recognizer:
    """Match a face embedding against the enrolled gallery by cosine similarity.
    Best match wins if it meets the threshold; otherwise fall back to generic."""

    def __init__(self, gallery: list[PersonEntry], generic_monke: Path, threshold: float = 0.5):
        self._generic = Path(generic_monke)
        self._threshold = threshold
        self._names = [p.name for p in gallery]
        self._monkes = [p.monke_path for p in gallery]
        if gallery:
            mat = np.array([p.embedding for p in gallery], dtype=float)
            # Rows are expected pre-normalized; normalize defensively anyway.
            norms = np.linalg.norm(mat, axis=1, keepdims=True)
            self._mat = mat / np.clip(norms, 1e-12, None)
        else:
            self._mat = None

    def match(self, embedding) -> MatchResult:
        vec = np.asarray(embedding, dtype=float)
        vec = vec / max(float(np.linalg.norm(vec)), 1e-12)
        if self._mat is None:
            return MatchResult(None, 0.0, self._generic, True)
        sims = self._mat @ vec
        best = int(np.argmax(sims))
        best_sim = float(sims[best])
        if best_sim >= self._threshold:
            return MatchResult(self._names[best], best_sim, self._monkes[best], False)
        return MatchResult(None, best_sim, self._generic, True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_recognizer.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/recognizer.py tests/test_recognizer.py
git commit -m "feat: add cosine recognizer with generic fallback (AC3,AC4)

Refs: docs/specs/monkepic-phase3-matching.md"
```

---

## Task 4: gallery — parse_person_folder

**Files:**
- Create: `src/monkepic/gallery.py`
- Test: `tests/test_gallery.py`

- [ ] **Step 1: Write the failing test**

`tests/test_gallery.py`:
```python
from PIL import Image

from monkepic.gallery import parse_person_folder


def _img(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 8)).save(path)


def test_parse_classifies_smb_as_monke_rest_as_faces(tmp_path):
    d = tmp_path / "01 - Nico"
    _img(d / "Nico - SMB #3053 .png")
    _img(d / "raw-pic__face_3.png")
    _img(d / "selfie.jpg")
    monke, faces = parse_person_folder(d)
    assert monke.name == "Nico - SMB #3053 .png"
    assert {f.name for f in faces} == {"raw-pic__face_3.png", "selfie.jpg"}


def test_parse_no_face_photos(tmp_path):
    d = tmp_path / "02 - SrMessi"
    _img(d / "SrMessi - SMB Gen3 #9566.png")
    monke, faces = parse_person_folder(d)
    assert monke.name == "SrMessi - SMB Gen3 #9566.png"
    assert faces == []


def test_parse_no_monke_returns_none(tmp_path):
    d = tmp_path / "99 - Ghost"
    _img(d / "only_a_face.png")
    monke, faces = parse_person_folder(d)
    assert monke is None
    assert len(faces) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_gallery.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: Implement**

`src/monkepic/gallery.py`:
```python
from __future__ import annotations

from pathlib import Path

from .loader import SUPPORTED


def parse_person_folder(folder: str | Path) -> tuple[Path | None, list[Path]]:
    """Split a person folder into (monke, face_photos). The image whose name
    contains 'SMB' (case-insensitive) is the monke; the rest are face photos."""
    folder = Path(folder)
    images = sorted(
        p for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() in SUPPORTED
    )
    monke = next((p for p in images if "smb" in p.name.lower()), None)
    faces = [p for p in images if p is not monke]
    return monke, faces
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_gallery.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/gallery.py tests/test_gallery.py
git commit -m "feat: add OurMonke person-folder parser (SMB rule) (AC1)

Refs: docs/specs/monkepic-phase3-matching.md"
```

---

## Task 5: embedder (InsightFace ArcFace wrapper)

**Files:**
- Create: `src/monkepic/embedder.py`
- Test: `tests/test_matching_smoke.py` (real-model, skippable — added in Task 9)

This module wraps a heavy ML dependency; its real behavior is covered by the
skippable smoke test (Task 9). Here we only add the module and a construction test
that does not load the model.

- [ ] **Step 1: Write a light construction test**

`tests/test_embedder.py`:
```python
from monkepic.embedder import FaceEmbedder


def test_embedder_constructs_without_loading_model():
    # Must not import/download insightface at construction time (lazy load).
    emb = FaceEmbedder()
    assert emb is not None
    assert emb._app is None  # model not loaded yet
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_embedder.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: Implement**

`src/monkepic/embedder.py`:
```python
from __future__ import annotations

import numpy as np
from PIL import Image

from .types import FaceRegion


class FaceEmbedder:
    """InsightFace ArcFace embedder. Lazy-loads the model on first embed().
    Returns a 512-d L2-normalized vector for a face region."""

    def __init__(self, model_name: str = "buffalo_l", pad: float = 0.25):
        self._model_name = model_name
        self._pad = pad
        self._app = None

    def _ensure_app(self):
        if self._app is None:
            from insightface.app import FaceAnalysis

            app = FaceAnalysis(name=self._model_name)
            app.prepare(ctx_id=-1, det_size=(640, 640))  # ctx_id=-1 -> CPU
            self._app = app
        return self._app

    def embed(self, image: Image.Image, region: FaceRegion) -> np.ndarray:
        """Embed the face in ``region``. Crops with padding, runs ArcFace on the
        crop, returns an L2-normalized 512-d vector."""
        app = self._ensure_app()
        W, H = image.size
        px, py = int(region.w * self._pad), int(region.h * self._pad)
        box = (
            max(0, region.x - px), max(0, region.y - py),
            min(W, region.x + region.w + px), min(H, region.y + region.h + py),
        )
        crop = np.array(image.convert("RGB").crop(box))[:, :, ::-1]  # RGB->BGR
        faces = app.get(crop)
        if not faces:
            raise ValueError("no face found in crop for embedding")
        # Largest detected face in the crop.
        face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
        vec = np.asarray(face.normed_embedding, dtype=float)
        return vec / max(float(np.linalg.norm(vec)), 1e-12)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_embedder.py -v`
Expected: 1 passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/embedder.py tests/test_embedder.py
git commit -m "feat: add lazy InsightFace ArcFace embedder

Refs: docs/specs/monkepic-phase3-matching.md"
```

---

## Task 6: gallery — build_gallery (embedder + detector mocked)

**Files:**
- Modify: `src/monkepic/gallery.py`
- Test: `tests/test_gallery.py`

- [ ] **Step 1: Add the failing test**

Append to `tests/test_gallery.py`:
```python
import numpy as np

from monkepic.gallery import build_gallery
from monkepic.types import FaceRegion


class FakeDetector:
    def detect(self, image):
        return [FaceRegion(0, 0, 8, 8, (0.0, 0.0), (8.0, 0.0))]


class FakeEmbedder:
    """Returns a fixed vector per person based on folder name."""
    def __init__(self):
        self.calls = 0

    def embed(self, image, region):
        self.calls += 1
        return np.array([1.0, 0.0, 0.0])


def test_build_gallery_one_entry_per_enrolled_person(tmp_path):
    nico = tmp_path / "01 - Nico"
    _img(nico / "Nico - SMB #1.png")
    _img(nico / "face_a.png")
    _img(nico / "face_b.png")
    messi = tmp_path / "02 - SrMessi"
    _img(messi / "SrMessi - SMB #2.png")  # monke only, no faces
    potential = tmp_path / "Potential - Turi"
    _img(potential / "Turi - SMB #3.png")
    _img(potential / "face_c.png")

    gallery = build_gallery(tmp_path, FakeEmbedder(), FakeDetector())

    names = {p.name for p in gallery}
    assert names == {"Nico"}              # Messi skipped (no faces), Potential ignored
    entry = gallery[0]
    assert entry.n_refs == 2
    v = np.array(entry.embedding)
    assert np.isclose(np.linalg.norm(v), 1.0)  # normalized


def test_build_gallery_skips_unreadable_face(tmp_path):
    nico = tmp_path / "01 - Nico"
    _img(nico / "Nico - SMB #1.png")
    _img(nico / "face_a.png")

    class OneBadEmbedder(FakeEmbedder):
        def embed(self, image, region):
            super().embed(image, region)
            raise ValueError("no face")

    gallery = build_gallery(tmp_path, OneBadEmbedder(), FakeDetector())
    assert gallery == []  # only face failed -> person not enrolled
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_gallery.py::test_build_gallery_one_entry_per_enrolled_person -v`
Expected: FAIL (ImportError: build_gallery)

- [ ] **Step 3: Implement**

Append to `src/monkepic/gallery.py`:
```python
import re

import numpy as np

from .loader import load_image
from .types import PersonEntry

_PERSON_RE = re.compile(r"^\d+\s*-\s*(.+)$")  # "01 - Nico" -> "Nico"


def _person_name(folder: Path) -> str | None:
    m = _PERSON_RE.match(folder.name)
    return m.group(1).strip() if m else None


def build_gallery(ourmonke_dir, embedder, detector) -> list[PersonEntry]:
    """Enroll every 'NN - Person' folder that has a monke and >=1 usable face
    photo. Each person's embedding is the L2-normalized mean of their face
    embeddings. Folders without an 'NN - ' prefix (e.g. 'Potential - X',
    '_generic') are ignored."""
    root = Path(ourmonke_dir)
    entries: list[PersonEntry] = []
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        name = _person_name(folder)
        if name is None:
            continue
        monke, faces = parse_person_folder(folder)
        if monke is None or not faces:
            continue
        vecs = []
        for face_path in faces:
            try:
                image = load_image(face_path)
                regions = detector.detect(image)
                if not regions:
                    continue
                vecs.append(embedder.embed(image, regions[0]))
            except Exception:
                continue
        if not vecs:
            continue
        mean = np.mean(np.array(vecs, dtype=float), axis=0)
        mean = mean / max(float(np.linalg.norm(mean)), 1e-12)
        entries.append(PersonEntry(name, monke, tuple(mean.tolist()), len(vecs)))
    return entries
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_gallery.py -v`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/gallery.py tests/test_gallery.py
git commit -m "feat: build person->embedding gallery from OurMonke (AC2)

Refs: docs/specs/monkepic-phase3-matching.md"
```

---

## Task 7: pipeline refactor — choose_monke callback

**Files:**
- Modify: `src/monkepic/pipeline.py`
- Test: `tests/test_pipeline_choose.py`

This refactor keeps composition in one place so matching can reuse it (DRY).
`process_image` gains an optional `choose_monke` callback that maps a list of
`FaceRegion` to a list of monke paths. The existing random selection becomes the
default callback, so Phase 1 behavior is unchanged.

- [ ] **Step 1: Write the failing test**

`tests/test_pipeline_choose.py`:
```python
import numpy as np
from PIL import Image

from monkepic.pipeline import process_image
from monkepic.types import FaceRegion


class FakeDetector:
    def __init__(self, regions):
        self._r = regions

    def detect(self, image):
        return self._r


def _monke(tmp_path, name, rgb):
    arr = np.full((40, 40, 3), 255, dtype=np.uint8)
    arr[10:30, 10:30] = rgb
    p = tmp_path / name
    Image.fromarray(arr, "RGB").save(p)
    return p


def _region(x, y, s):
    return FaceRegion(x, y, s, s, (x + s * 0.3, y + s * 0.4), (x + s * 0.7, y + s * 0.4))


def test_choose_monke_callback_controls_assignment(tmp_path):
    src = tmp_path / "in.png"
    Image.new("RGB", (300, 300), (10, 10, 10)).save(src)
    red = _monke(tmp_path, "red.png", [255, 0, 0])
    blue = _monke(tmp_path, "blue.png", [0, 0, 255])
    regions = [_region(20, 20, 60), _region(170, 170, 60)]

    # first face -> red, second -> blue
    def choose(rs):
        return [red, blue]

    out = process_image(src, None, tmp_path / "out", FakeDetector(regions),
                        choose_monke=choose)
    arr = np.array(Image.open(out).convert("RGB"))
    assert arr[50, 50, 0] > 100 and arr[50, 50, 2] < 100   # face 0 reddish
    assert arr[200, 200, 2] > 100 and arr[200, 200, 0] < 100  # face 1 bluish
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_pipeline_choose.py -v`
Expected: FAIL (TypeError: unexpected keyword 'choose_monke')

- [ ] **Step 3: Implement**

In `src/monkepic/pipeline.py`, change the `process_image` signature to add the
callback and replace the monke-selection block. Replace this existing block:

```python
    crops_dir=None,
    forced_monke=None,
) -> Path:
```
with:
```python
    crops_dir=None,
    forced_monke=None,
    choose_monke=None,
) -> Path:
```

Then replace this existing selection block:
```python
    if forced_monke is not None:
        monke_paths = [Path(forced_monke)] * len(regions)
    else:
        pool = list_images(monke_pool)
        if not pool:
            raise ValueError(f"no monkes found in {monke_pool}")
        monke_paths = MonkeSelector(pool, seed=seed).assign(len(regions))
```
with:
```python
    if choose_monke is not None:
        monke_paths = [Path(p) for p in choose_monke(regions)]
    elif forced_monke is not None:
        monke_paths = [Path(forced_monke)] * len(regions)
    else:
        pool = list_images(monke_pool)
        if not pool:
            raise ValueError(f"no monkes found in {monke_pool}")
        monke_paths = MonkeSelector(pool, seed=seed).assign(len(regions))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_pipeline_choose.py tests/test_pipeline.py -v`
Expected: all passed (existing pipeline tests still green — Phase 1 unchanged)

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/pipeline.py tests/test_pipeline_choose.py
git commit -m "refactor: add choose_monke callback to pipeline (keeps random default)

Refs: docs/specs/monkepic-phase3-matching.md"
```

---

## Task 8: matching orchestration

**Files:**
- Create: `src/monkepic/matching.py`
- Test: `tests/test_matching.py`

- [ ] **Step 1: Write the failing test**

`tests/test_matching.py`:
```python
from pathlib import Path

import numpy as np
from PIL import Image

from monkepic.matching import process_image_matched
from monkepic.types import FaceRegion, PersonEntry


def _monke(tmp_path, name, rgb):
    arr = np.full((40, 40, 3), 255, dtype=np.uint8)
    arr[10:30, 10:30] = rgb
    p = tmp_path / name
    Image.fromarray(arr, "RGB").save(p)
    return p


def _region(x, y, s):
    return FaceRegion(x, y, s, s, (x + s * 0.3, y + s * 0.4), (x + s * 0.7, y + s * 0.4))


class FakeDetector:
    def __init__(self, regions):
        self._r = regions

    def detect(self, image):
        return self._r


class FakeEmbedder:
    """Maps a face to a vector by its x position: left face -> nico, right -> unknown."""
    def embed(self, image, region):
        return np.array([1.0, 0.0, 0.0]) if region.x < 100 else np.array([0.0, 0.0, 1.0])


def test_recognized_gets_own_monke_unknown_gets_generic(tmp_path):
    src = tmp_path / "in.png"
    Image.new("RGB", (300, 300), (10, 10, 10)).save(src)
    nico_monke = _monke(tmp_path, "nico_red.png", [255, 0, 0])
    generic = _monke(tmp_path, "generic_blue.png", [0, 0, 255])

    nico = PersonEntry("Nico", nico_monke, tuple([1.0, 0.0, 0.0]), 1)
    gallery = [nico]

    regions = [_region(20, 20, 60), _region(200, 20, 60)]  # left known, right unknown

    out = process_image_matched(
        src, gallery, generic, tmp_path / "out", FakeDetector(regions), FakeEmbedder(),
        threshold=0.5,
    )
    arr = np.array(Image.open(out).convert("RGB"))
    # left face -> nico's red monke
    assert arr[50, 50, 0] > 100 and arr[50, 50, 2] < 100
    # right face -> generic blue monke
    assert arr[50, 230, 2] > 100 and arr[50, 230, 0] < 100


def test_background_face_not_covered(tmp_path):
    src = tmp_path / "in.png"
    Image.new("RGB", (300, 300), (10, 10, 10)).save(src)
    generic = _monke(tmp_path, "generic_blue.png", [0, 0, 255])

    # two normal faces + one tiny background face
    regions = [_region(20, 20, 80), _region(180, 20, 80), _region(150, 150, 10)]
    out = process_image_matched(
        src, [], generic, tmp_path / "out", FakeDetector(regions), FakeEmbedder(),
        threshold=0.5,
    )
    arr = np.array(Image.open(out).convert("RGB"))
    # tiny face center (155,155) stays dark (no monke)
    assert arr[155, 155, 2] < 80


def test_no_faces_copies_through(tmp_path):
    src = tmp_path / "in.png"
    Image.new("RGB", (40, 40), (123, 50, 7)).save(src)
    generic = _monke(tmp_path, "g.png", [0, 0, 255])
    out = process_image_matched(
        src, [], generic, tmp_path / "out", FakeDetector([]), FakeEmbedder(), threshold=0.5,
    )
    assert out.exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_matching.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: Implement**

`src/monkepic/matching.py`:
```python
from __future__ import annotations

from pathlib import Path

from .facefilter import filter_background
from .pipeline import process_image
from .recognizer import Recognizer
from .types import FaceRegion, PersonEntry


def process_image_matched(
    src,
    gallery: list[PersonEntry],
    generic_monke,
    out_dir,
    detector,
    embedder,
    *,
    threshold: float = 0.5,
    min_ratio: float = 0.35,
    min_px: int = 40,
    margin: float = 1.0,
    rotate: bool = True,
    crops_dir=None,
) -> Path:
    """Phase 3: cover each (non-background) face with its person's monke, or the
    generic monke when unrecognized. Reuses the Phase 1 compositor via a
    choose_monke callback so background filtering is applied consistently."""
    generic_monke = Path(generic_monke)
    recognizer = Recognizer(gallery, generic_monke, threshold)

    # Detector wrapper that applies the background-face filter, so process_image
    # composes exactly the faces we keep (and exports crops for those only).
    class _FilteringDetector:
        def detect(self, image) -> list[FaceRegion]:
            return filter_background(detector.detect(image), min_ratio, min_px)

    def choose(regions: list[FaceRegion]):
        image = load_image(src)
        out = []
        for r in regions:
            try:
                emb = embedder.embed(image, r)
                out.append(recognizer.match(emb).monke_path)
            except Exception:
                out.append(generic_monke)
        return out

    return process_image(
        src, None, out_dir, _FilteringDetector(),
        margin=margin, rotate=rotate, crops_dir=crops_dir, choose_monke=choose,
    )
```

Add the missing import at the top of the file (it is used in `choose`):
```python
from .loader import load_image
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_matching.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/matching.py tests/test_matching.py
git commit -m "feat: add Phase 3 matching orchestration (AC7,AC9)

Refs: docs/specs/monkepic-phase3-matching.md"
```

---

## Task 9: gallery cache

**Files:**
- Modify: `src/monkepic/gallery.py`
- Test: `tests/test_gallery.py`

Cache the gallery to `.monke-cache/gallery.npz` keyed by a hash of the reference
photos (paths + mtimes), so we re-enroll only when photos change.

- [ ] **Step 1: Add the failing test**

Append to `tests/test_gallery.py`:
```python
from monkepic.gallery import load_or_build_gallery


def test_cache_reuse_then_rebuild_on_change(tmp_path):
    nico = tmp_path / "01 - Nico"
    _img(nico / "Nico - SMB #1.png")
    _img(nico / "face_a.png")
    cache = tmp_path / ".cache"

    emb1 = FakeEmbedder()
    g1 = load_or_build_gallery(tmp_path, emb1, FakeDetector(), cache_dir=cache)
    assert emb1.calls == 1
    assert {p.name for p in g1} == {"Nico"}

    # second call: cache hit, embedder NOT called again
    emb2 = FakeEmbedder()
    g2 = load_or_build_gallery(tmp_path, emb2, FakeDetector(), cache_dir=cache)
    assert emb2.calls == 0
    assert {p.name for p in g2} == {"Nico"}

    # add a new face -> cache invalidated -> rebuild
    _img(nico / "face_b.png")
    emb3 = FakeEmbedder()
    g3 = load_or_build_gallery(tmp_path, emb3, FakeDetector(), cache_dir=cache)
    assert emb3.calls == 2

    # force rebuild ignores cache
    emb4 = FakeEmbedder()
    load_or_build_gallery(tmp_path, emb4, FakeDetector(), cache_dir=cache, rebuild=True)
    assert emb4.calls == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_gallery.py::test_cache_reuse_then_rebuild_on_change -v`
Expected: FAIL (ImportError: load_or_build_gallery)

- [ ] **Step 3: Implement**

Append to `src/monkepic/gallery.py`:
```python
import hashlib
import json


def _gallery_fingerprint(ourmonke_dir: Path) -> str:
    """Hash of every face photo's path + mtime, so the cache invalidates when
    reference photos are added/removed/changed."""
    root = Path(ourmonke_dir)
    parts: list[str] = []
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        if _person_name(folder) is None:
            continue
        _monke, faces = parse_person_folder(folder)
        for f in faces:
            parts.append(f"{f}:{f.stat().st_mtime_ns}")
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()


def load_or_build_gallery(
    ourmonke_dir, embedder, detector, cache_dir=".monke-cache", rebuild: bool = False
) -> list[PersonEntry]:
    """Return the gallery, using a cache keyed by the reference-photo fingerprint.
    Rebuilds when photos change or ``rebuild=True``."""
    cache_dir = Path(cache_dir)
    cache_file = cache_dir / "gallery.json"
    fp = _gallery_fingerprint(ourmonke_dir)

    if not rebuild and cache_file.exists():
        data = json.loads(cache_file.read_text())
        if data.get("fingerprint") == fp:
            return [
                PersonEntry(e["name"], Path(e["monke_path"]),
                            tuple(e["embedding"]), e["n_refs"])
                for e in data["entries"]
            ]

    gallery = build_gallery(ourmonke_dir, embedder, detector)
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps({
        "fingerprint": fp,
        "entries": [
            {"name": e.name, "monke_path": str(e.monke_path),
             "embedding": list(e.embedding), "n_refs": e.n_refs}
            for e in gallery
        ],
    }))
    return gallery
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_gallery.py -v`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/gallery.py tests/test_gallery.py
git commit -m "feat: cache the gallery keyed by reference-photo fingerprint (AC10)

Refs: docs/specs/monkepic-phase3-matching.md"
```

---

## Task 10: CLI --match

**Files:**
- Modify: `src/monkepic/cli.py`
- Test: `tests/test_cli_match.py`

- [ ] **Step 1: Write the failing test**

`tests/test_cli_match.py`:
```python
import numpy as np
from PIL import Image

from monkepic import cli
from monkepic.types import FaceRegion


class FakeDetector:
    def detect(self, image):
        return [FaceRegion(20, 20, 80, 80, (44.0, 52.0), (76.0, 52.0))]


class FakeEmbedder:
    def embed(self, image, region):
        return np.array([1.0, 0.0, 0.0])


def _img(path, rgb=(10, 10, 10), size=(300, 300)):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, rgb).save(path)


def _monke(path, rgb):
    arr = np.full((40, 40, 3), 255, dtype=np.uint8)
    arr[10:30, 10:30] = rgb
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr, "RGB").save(path)


def test_cli_match_assigns_person_monke(tmp_path):
    src = tmp_path / "in.png"
    _img(src)
    # OurMonke layout: one enrolled person with a face photo
    nico = tmp_path / "OurMonke" / "01 - Nico"
    _monke(nico / "Nico - SMB #1.png", [255, 0, 0])
    _img(nico / "face_a.png", size=(50, 50))
    generic = tmp_path / "MonkeDAO_DAOJones.png"
    _monke(generic, [0, 0, 255])

    rc = cli.main(
        ["--match", "--ourmonke", str(tmp_path / "OurMonke"),
         "--generic-monke", str(generic), "--out", str(tmp_path / "out"),
         "--recognition-threshold", "0.5", str(src)],
        detector=FakeDetector(), embedder=FakeEmbedder(),
    )
    assert rc == 0
    out = tmp_path / "out" / "in-monked.png"
    assert out.exists()
    arr = np.array(Image.open(out).convert("RGB"))
    assert arr[60, 60, 0] > 100  # nico's red monke applied


def test_cli_without_match_is_phase1(tmp_path):
    src = tmp_path / "in.png"
    _img(src)
    pool = tmp_path / "monkes"
    _monke(pool / "m.png", [0, 255, 0])
    rc = cli.main(
        ["--monkes", str(pool), "--out", str(tmp_path / "out"), str(src)],
        detector=FakeDetector(),
    )
    assert rc == 0
    assert (tmp_path / "out" / "in-monked.png").exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_cli_match.py -v`
Expected: FAIL (unrecognized arguments: --match)

- [ ] **Step 3: Implement**

In `src/monkepic/cli.py`, add the new arguments in `build_parser` (after
`--min-confidence`):
```python
    p.add_argument("--match", action="store_true", help="enable identity matching (Phase 3)")
    p.add_argument("--ourmonke", default="OurMonke", help="person/monke library dir")
    p.add_argument("--generic-monke", default="MonkeDAO_DAOJones.png",
                   help="monke for unrecognized faces")
    p.add_argument("--recognition-threshold", type=float, default=0.5,
                   help="min cosine similarity to accept a match")
    p.add_argument("--min-face-ratio", type=float, default=0.35,
                   help="background cutoff vs median face size")
    p.add_argument("--min-face-px", type=int, default=40,
                   help="absolute background cutoff in px")
    p.add_argument("--rebuild-gallery", action="store_true",
                   help="ignore the gallery cache and re-enroll")
```

Change the `main` signature to accept an injectable embedder:
```python
def main(argv=None, detector=None, embedder=None) -> int:
```

Then, immediately after the detector is resolved (after the existing
`detector = FaceDetector(...)` block), insert the matching branch that returns
early:
```python
    if args.match:
        from .embedder import FaceEmbedder
        from .gallery import load_or_build_gallery
        from .loader import list_images
        from .matching import process_image_matched

        if embedder is None:
            embedder = FaceEmbedder()
        gallery = load_or_build_gallery(
            args.ourmonke, embedder, detector, rebuild=args.rebuild_gallery
        )
        if not gallery:
            print("warning: no enrolled persons; all faces -> generic", file=sys.stderr)

        inputs = [p for p in list_images(args.input) if not p.stem.endswith("-monked")]
        if not inputs:
            print(f"No images found at {args.input}", file=sys.stderr)
            return 1
        for p in inputs:
            out = process_image_matched(
                p, gallery, args.generic_monke, args.out, detector, embedder,
                threshold=args.recognition_threshold,
                min_ratio=args.min_face_ratio, min_px=args.min_face_px,
                margin=args.margin, rotate=not args.no_rotate,
                crops_dir=args.export_crops,
            )
            print(out)
        return 0
```

(The existing non-match `process_path(...)` block stays as the fallback below.)

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_cli_match.py tests/test_cli.py -v`
Expected: all passed (Phase 1 CLI tests still green)

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/cli.py tests/test_cli_match.py
git commit -m "feat: add --match CLI for identity matching (AC7,AC8)

Refs: docs/specs/monkepic-phase3-matching.md"
```

---

## Task 11: dependency, README, real-model smoke, full verification

**Files:**
- Modify: `pyproject.toml`, `README.md`
- Test: `tests/test_matching_smoke.py`

- [ ] **Step 1: Add insightface dependency**

In `pyproject.toml`, add to `dependencies`:
```toml
    "insightface>=0.7",
```

Run: `uv pip install -e ".[dev]"`
Expected: insightface installs (onnxruntime already present).

- [ ] **Step 2: Write the skippable real-model smoke test**

`tests/test_matching_smoke.py`:
```python
from pathlib import Path

import pytest

from monkepic.loader import load_image

SAMPLE = Path("Photos/Event-MiniGolf-24-04-2026/raw-pic.jpg")
OURMONKE = Path("OurMonke")
GENERIC = Path("MonkeDAO_DAOJones.png")


@pytest.mark.skipif(
    not (SAMPLE.exists() and OURMONKE.exists() and GENERIC.exists()),
    reason="sample data not present",
)
def test_real_matching_assigns_at_least_one_person(tmp_path):
    pytest.importorskip("insightface")
    pytest.importorskip("cv2")
    from monkepic.detector import FaceDetector
    from monkepic.embedder import FaceEmbedder
    from monkepic.gallery import load_or_build_gallery
    from monkepic.recognizer import Recognizer

    detector = FaceDetector()
    embedder = FaceEmbedder()
    gallery = load_or_build_gallery(
        OURMONKE, embedder, detector, cache_dir=tmp_path / "cache"
    )
    assert len(gallery) >= 1  # at least the enrolled persons

    # At least one detected face in the sample should match an enrolled person.
    image = load_image(SAMPLE)
    regions = detector.detect(image)
    rec = Recognizer(gallery, GENERIC, threshold=0.3)
    matched = 0
    for r in regions:
        try:
            if not rec.match(embedder.embed(image, r)).is_generic:
                matched += 1
        except Exception:
            pass
    assert matched >= 1
```

- [ ] **Step 3: Run smoke test (real models — may download on first run)**

Run: `uv run pytest tests/test_matching_smoke.py -v`
Expected: PASS (or SKIP if data absent). If it fails because no face matches at
threshold 0.3, that reflects the cold-start limitation — note it, do not loosen
the assertion below 0.3.

- [ ] **Step 4: Update README — add a Matching section**

In `README.md`, under Usage (after the existing examples), add:
```markdown
### Identity matching (Phase 3)

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
```

Also update the Roadmap: change the Phase 3 line to `- [x]`.

- [ ] **Step 5: Full verification + commit**

Run:
```bash
uv run pytest -q
uv run ruff check src tests
```
Expected: all tests pass (smoke may skip), lint clean.

```bash
git add pyproject.toml README.md tests/test_matching_smoke.py
git commit -m "feat: insightface dep, matching docs, real-model smoke (AC11)

Refs: docs/specs/monkepic-phase3-matching.md"
```

---

## DoD coverage map (acceptance criteria -> task)

- AC1 SMB rule parse -> Task 4
- AC2 build gallery, skip no-face persons, normalized -> Task 6
- AC3 match above threshold -> Task 3
- AC4 generic below threshold -> Task 3
- AC5 keep_face combined rule -> Task 2
- AC6 filter keeps all with <=1 face -> Task 2
- AC7 recognized->own, unknown->generic -> Task 8, Task 10
- AC8 no --match equals Phase 1 -> Task 7, Task 10
- AC9 background faces not composited -> Task 8
- AC10 gallery cache reuse/rebuild -> Task 9
- AC11 real-model smoke -> Task 11

## Self-review notes

- Spec coverage: every AC maps to a task (table above). Embedder (§5.2) is Task 5;
  its real behavior is covered by the Task 11 smoke test, construction by Task 5.
- Type consistency: `PersonEntry(name, monke_path, embedding, n_refs)` and
  `MatchResult(person, similarity, monke_path, is_generic)` are used identically in
  recognizer (Task 3), gallery (Tasks 6/9), matching (Task 8). `embedding` is a
  tuple of floats everywhere; numpy conversion happens only inside recognizer/gallery.
- `choose_monke(regions) -> list[Path]` signature matches between pipeline (Task 7)
  and matching (Task 8).
- DRY: composition stays only in `pipeline.process_image`; matching reuses it via
  the callback + a filtering detector wrapper (no duplicated compositing).
- No placeholders: every code/test step contains complete code.
