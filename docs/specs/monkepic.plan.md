# MonkePic Phase 1 (Tool 1 — auto-anonymizer CLI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local Python CLI that detects every face in a photo and covers each with an SMB monke — background removed, scaled to the head, positioned, and rotated to head tilt — and can export face crops to seed Phase 3 enrollment.

**Architecture:** Small single-purpose modules under `src/monkepic/`. Pure geometry/selection/background-tier functions are unit-tested in isolation; the ML face detector sits behind a thin interface and is mocked in pipeline tests (one separate smoke test uses the real model). Pillow drives image I/O and compositing; rembg is the tier-3 background fallback.

**Tech Stack:** Python ≥3.10, mediapipe (face detection), Pillow + pillow-heif (AVIF/WebP I/O), numpy, rembg (U²-Net), pytest, ruff, uv.

Refs: docs/specs/monkepic.md

---

## File structure

```
pyproject.toml                 # package + deps + console script
src/monkepic/
  __init__.py
  types.py        # FaceRegion, Placement dataclasses
  geometry.py     # pure: roll_degrees, head_box, monke_target_size
  selector.py     # MonkeSelector (seeded, no-repeat-within-photo)
  background.py   # has_alpha, is_solid_background, select_tier, solid_cutout, ml_cutout, ensure_transparent
  loader.py       # AVIF/WebP-aware load/save/list
  compositor.py   # composite(base, monke, placement)
  crops.py        # export_crops
  detector.py     # FaceDetector (mediapipe wrapper)
  pipeline.py     # process_image orchestration
  cli.py          # argparse entrypoint -> main()
tests/
  test_geometry.py test_selector.py test_background.py test_loader.py
  test_compositor.py test_crops.py test_pipeline.py test_cli.py
  test_detector_smoke.py
  conftest.py     # synthetic-image fixtures
```

---

## Task 0: Project scaffolding

**Files:**
- Create: `pyproject.toml`, `src/monkepic/__init__.py`, `tests/conftest.py`

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "monkepic"
version = "0.1.0"
description = "Local face anonymizer that covers faces with SMB monkes"
requires-python = ">=3.10"
dependencies = [
    "mediapipe>=0.10",
    "Pillow>=10.0",
    "pillow-heif>=0.16",
    "numpy>=1.24",
    "rembg>=2.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "ruff>=0.5"]

[project.scripts]
monkepic = "monkepic.cli:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/monkepic"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
```

- [ ] **Step 2: Create package init and conftest**

`src/monkepic/__init__.py`:
```python
"""MonkePic — local face anonymizer using SMB monkes."""
__version__ = "0.1.0"
```

`tests/conftest.py`:
```python
import numpy as np
import pytest
from PIL import Image


@pytest.fixture
def solid_bg_monke():
    """100x100 white background with a red square in the center, no alpha."""
    arr = np.full((100, 100, 3), 255, dtype=np.uint8)
    arr[30:70, 30:70] = [255, 0, 0]
    return Image.fromarray(arr, "RGB")


@pytest.fixture
def alpha_monke():
    """50x50 image that already has a transparent border."""
    arr = np.zeros((50, 50, 4), dtype=np.uint8)
    arr[10:40, 10:40] = [0, 0, 255, 255]
    return Image.fromarray(arr, "RGBA")


@pytest.fixture
def gradient_bg_monke():
    """100x100 horizontal gradient background (corners disagree -> not solid)."""
    arr = np.zeros((100, 100, 3), dtype=np.uint8)
    for x in range(100):
        arr[:, x] = [x * 2, 50, 200 - x]
    return Image.fromarray(arr, "RGB")
```

- [ ] **Step 3: Create env and install**

Run:
```bash
cd "/Users/nico/Projects-personal/MonkePic"
uv venv
uv pip install -e ".[dev]"
```
Expected: install succeeds (mediapipe/rembg pull onnxruntime — may take a few minutes).

- [ ] **Step 4: Verify pytest collects nothing yet**

Run: `uv run pytest -q`
Expected: "no tests ran" (exit 5) — confirms tooling works.

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml src/monkepic/__init__.py tests/conftest.py
git commit -m "chore: scaffold monkepic package (uv, pytest, deps)

Refs: docs/specs/monkepic.md"
```

---

## Task 1: Shared types

**Files:**
- Create: `src/monkepic/types.py`
- Test: `tests/test_geometry.py` (imports the types in Task 2)

- [ ] **Step 1: Write the dataclasses**

`src/monkepic/types.py`:
```python
from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class FaceRegion:
    """A detected face: pixel bounding box + eye keypoints."""
    x: int
    y: int
    w: int
    h: int
    left_eye: tuple[float, float]
    right_eye: tuple[float, float]
    confidence: float = 1.0


@dataclass(frozen=True)
class Placement:
    """Where/how to paste a monke: center, target size, roll in degrees."""
    cx: float
    cy: float
    w: int
    h: int
    roll_deg: float
```

- [ ] **Step 2: Sanity import**

Run: `uv run python -c "from monkepic.types import FaceRegion, Placement; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add src/monkepic/types.py
git commit -m "feat: add FaceRegion and Placement types

Refs: docs/specs/monkepic.md"
```

---

## Task 2: geometry.roll_degrees

**Files:**
- Create: `src/monkepic/geometry.py`
- Test: `tests/test_geometry.py`

- [ ] **Step 1: Write the failing test**

`tests/test_geometry.py`:
```python
import math
from monkepic.geometry import roll_degrees


def test_level_eyes_zero_roll():
    assert roll_degrees((0.0, 0.0), (10.0, 0.0)) == 0.0


def test_tilted_eyes_positive_roll():
    assert math.isclose(roll_degrees((0.0, 0.0), (10.0, 10.0)), 45.0)


def test_tilted_eyes_negative_roll():
    assert math.isclose(roll_degrees((0.0, 0.0), (10.0, -10.0)), -45.0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_geometry.py -v`
Expected: FAIL (ModuleNotFoundError: monkepic.geometry)

- [ ] **Step 3: Write minimal implementation**

`src/monkepic/geometry.py`:
```python
from __future__ import annotations
import math


def roll_degrees(left_eye: tuple[float, float], right_eye: tuple[float, float]) -> float:
    """Angle (degrees) of the eye line vs horizontal. 0 = level, +ve = right eye lower."""
    dx = right_eye[0] - left_eye[0]
    dy = right_eye[1] - left_eye[1]
    return math.degrees(math.atan2(dy, dx))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_geometry.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/geometry.py tests/test_geometry.py
git commit -m "feat: add roll_degrees geometry helper (AC2)

Refs: docs/specs/monkepic.md"
```

---

## Task 3: geometry.head_box

**Files:**
- Modify: `src/monkepic/geometry.py`
- Test: `tests/test_geometry.py`

- [ ] **Step 1: Add the failing test**

Append to `tests/test_geometry.py`:
```python
from monkepic.geometry import head_box


def test_head_box_expands_around_center():
    # face bbox at (10,20) size 100x100, margin 0.4
    cx, cy, w, h = head_box(10, 20, 100, 100, margin=0.4)
    assert (cx, cy) == (60.0, 70.0)
    assert (w, h) == (140.0, 140.0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_geometry.py::test_head_box_expands_around_center -v`
Expected: FAIL (ImportError: head_box)

- [ ] **Step 3: Implement**

Append to `src/monkepic/geometry.py`:
```python
def head_box(x: int, y: int, w: int, h: int, margin: float = 0.4) -> tuple[float, float, float, float]:
    """Expand a face bbox around its center by `margin` to cover the whole head.
    Returns (center_x, center_y, width, height)."""
    cx = x + w / 2
    cy = y + h / 2
    return cx, cy, w * (1 + margin), h * (1 + margin)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_geometry.py -v`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/geometry.py tests/test_geometry.py
git commit -m "feat: add head_box expansion (AC3)

Refs: docs/specs/monkepic.md"
```

---

## Task 4: geometry.monke_target_size

**Files:**
- Modify: `src/monkepic/geometry.py`
- Test: `tests/test_geometry.py`

- [ ] **Step 1: Add the failing test**

Append to `tests/test_geometry.py`:
```python
from monkepic.geometry import monke_target_size


def test_target_size_square_cover():
    assert monke_target_size(140, 140, 100, 100) == (140, 140)


def test_target_size_preserves_aspect_and_covers():
    # wide monke (2:1) covering a square box -> width scales to cover height
    assert monke_target_size(140, 140, 200, 100) == (280, 140)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_geometry.py::test_target_size_square_cover -v`
Expected: FAIL (ImportError)

- [ ] **Step 3: Implement**

Append to `src/monkepic/geometry.py`:
```python
def monke_target_size(box_w: float, box_h: float, monke_w: int, monke_h: int) -> tuple[int, int]:
    """Size the monke to fully COVER the box while preserving the monke's aspect ratio."""
    scale = max(box_w / monke_w, box_h / monke_h)
    return round(monke_w * scale), round(monke_h * scale)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_geometry.py -v`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/geometry.py tests/test_geometry.py
git commit -m "feat: add monke_target_size cover-fit (AC3)

Refs: docs/specs/monkepic.md"
```

---

## Task 5: selector.MonkeSelector

**Files:**
- Create: `src/monkepic/selector.py`
- Test: `tests/test_selector.py`

- [ ] **Step 1: Write the failing test**

`tests/test_selector.py`:
```python
from monkepic.selector import MonkeSelector


def test_no_repeat_within_photo_when_pool_big_enough():
    sel = MonkeSelector(["a", "b", "c", "d"], seed=42)
    picks = sel.assign(3)
    assert len(picks) == 3
    assert len(set(picks)) == 3  # no repeats


def test_deterministic_with_seed():
    a = MonkeSelector(["a", "b", "c", "d"], seed=7).assign(3)
    b = MonkeSelector(["a", "b", "c", "d"], seed=7).assign(3)
    assert a == b


def test_falls_back_to_repeats_when_pool_too_small():
    sel = MonkeSelector(["a", "b"], seed=1)
    picks = sel.assign(5)
    assert len(picks) == 5
    assert set(picks) <= {"a", "b"}
    assert sel.repeated is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_selector.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: Implement**

`src/monkepic/selector.py`:
```python
from __future__ import annotations
import random
from typing import Sequence


class MonkeSelector:
    """Assign one monke per face: random without repetition within a photo when the
    pool is big enough; otherwise allow repeats and flag it."""

    def __init__(self, pool: Sequence, seed: int | None = None):
        if not pool:
            raise ValueError("monke pool is empty")
        self._pool = list(pool)
        self._rng = random.Random(seed)
        self.repeated = False

    def assign(self, n: int) -> list:
        if n <= len(self._pool):
            return self._rng.sample(self._pool, n)
        self.repeated = True
        picks = self._rng.sample(self._pool, len(self._pool))
        picks += self._rng.choices(self._pool, k=n - len(self._pool))
        return picks
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_selector.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/selector.py tests/test_selector.py
git commit -m "feat: add MonkeSelector (no-repeat within photo, seeded) (AC7)

Refs: docs/specs/monkepic.md"
```

---

## Task 6: background tiers — has_alpha, is_solid_background, select_tier

**Files:**
- Create: `src/monkepic/background.py`
- Test: `tests/test_background.py`

- [ ] **Step 1: Write the failing test**

`tests/test_background.py`:
```python
from monkepic.background import has_alpha, is_solid_background, select_tier


def test_has_alpha_true(alpha_monke):
    assert has_alpha(alpha_monke) is True


def test_has_alpha_false(solid_bg_monke):
    assert has_alpha(solid_bg_monke) is False


def test_solid_background_detected(solid_bg_monke):
    assert is_solid_background(solid_bg_monke) is True


def test_gradient_not_solid(gradient_bg_monke):
    assert is_solid_background(gradient_bg_monke) is False


def test_select_tier_alpha(alpha_monke):
    assert select_tier(alpha_monke) == "alpha"


def test_select_tier_solid(solid_bg_monke):
    assert select_tier(solid_bg_monke) == "solid"


def test_select_tier_ml(gradient_bg_monke):
    assert select_tier(gradient_bg_monke) == "ml"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_background.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: Implement**

`src/monkepic/background.py`:
```python
from __future__ import annotations
import numpy as np
from PIL import Image


def has_alpha(img: Image.Image) -> bool:
    """True if the image has an alpha channel with at least one non-opaque pixel."""
    if img.mode not in ("RGBA", "LA"):
        return False
    alpha = np.array(img.convert("RGBA"))[:, :, 3]
    return bool(alpha.min() < 255)


def _corner_colors(img: Image.Image) -> np.ndarray:
    arr = np.array(img.convert("RGB"))
    h, w = arr.shape[:2]
    return np.array([arr[0, 0], arr[0, w - 1], arr[h - 1, 0], arr[h - 1, w - 1]], dtype=np.int16)


def is_solid_background(img: Image.Image, tol: int = 25) -> bool:
    """True if all four corners agree within `tol` (a flat background)."""
    corners = _corner_colors(img)
    spread = corners.max(axis=0) - corners.min(axis=0)
    return bool(spread.max() <= tol)


def select_tier(img: Image.Image, tol: int = 25) -> str:
    """Pick the background-removal strategy: 'alpha' | 'solid' | 'ml'."""
    if has_alpha(img):
        return "alpha"
    if is_solid_background(img, tol):
        return "solid"
    return "ml"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_background.py -v`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/background.py tests/test_background.py
git commit -m "feat: add background tier detection (alpha/solid/ml) (AC4,AC5,AC12)

Refs: docs/specs/monkepic.md"
```

---

## Task 7: background cutouts — solid_cutout, ml_cutout, ensure_transparent

**Files:**
- Modify: `src/monkepic/background.py`
- Test: `tests/test_background.py`

- [ ] **Step 1: Add the failing tests**

Append to `tests/test_background.py`:
```python
import numpy as np
from monkepic.background import solid_cutout, ensure_transparent


def test_solid_cutout_makes_corners_transparent(solid_bg_monke):
    out = solid_cutout(solid_bg_monke)
    arr = np.array(out)
    assert out.mode == "RGBA"
    assert arr[0, 0, 3] == 0       # corner transparent
    assert arr[50, 50, 3] == 255   # red center kept


def test_ensure_transparent_passes_through_alpha(alpha_monke):
    out = ensure_transparent(alpha_monke)
    assert out.mode == "RGBA"
    assert np.array_equal(np.array(out), np.array(alpha_monke))


def test_ensure_transparent_uses_ml_fallback(gradient_bg_monke):
    sentinel = gradient_bg_monke.convert("RGBA")
    called = {"n": 0}

    def fake_rembg(image):
        called["n"] += 1
        return sentinel

    out = ensure_transparent(gradient_bg_monke, rembg_fn=fake_rembg)
    assert called["n"] == 1
    assert out is sentinel
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_background.py::test_solid_cutout_makes_corners_transparent -v`
Expected: FAIL (ImportError: solid_cutout)

- [ ] **Step 3: Implement**

Append to `src/monkepic/background.py`:
```python
from PIL import ImageDraw

_SENTINEL = (1, 254, 2)  # improbable color used as flood-fill marker


def _median_corner_color(img: Image.Image) -> tuple[int, int, int]:
    med = np.median(_corner_colors(img), axis=0).astype(int)
    return int(med[0]), int(med[1]), int(med[2])


def solid_cutout(img: Image.Image, tol: int = 25) -> Image.Image:
    """Remove a flat background by flood-filling from the corners; only the
    background region connected to the borders becomes transparent."""
    rgba = img.convert("RGBA")
    work = rgba.convert("RGB")
    w, h = work.size
    for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(work, corner, _SENTINEL, thresh=tol)
    marked = np.array(work)
    mask = np.all(marked == _SENTINEL, axis=-1)
    out = np.array(rgba)
    out[mask, 3] = 0
    return Image.fromarray(out, "RGBA")


def ml_cutout(img: Image.Image, rembg_fn) -> Image.Image:
    """Tier 3: delegate to an ML segmenter (rembg.remove) for complex backgrounds."""
    return rembg_fn(img).convert("RGBA")


def _default_rembg(image: Image.Image) -> Image.Image:
    from rembg import remove  # imported lazily; heavy dependency
    return remove(image)


def ensure_transparent(img: Image.Image, tol: int = 25, rembg_fn=_default_rembg) -> Image.Image:
    """Return an RGBA monke with its background removed, choosing the tier
    automatically: alpha pass-through -> solid-color cutout -> ML fallback."""
    tier = select_tier(img, tol)
    if tier == "alpha":
        return img.convert("RGBA")
    if tier == "solid":
        return solid_cutout(img, tol)
    return ml_cutout(img, rembg_fn)
```

Note for the ml test: `ml_cutout` calls `.convert("RGBA")`; the test's `sentinel` is already RGBA so `convert` returns the same object — `out is sentinel` holds.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_background.py -v`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/background.py tests/test_background.py
git commit -m "feat: add solid/ML cutouts and ensure_transparent cascade (AC4,AC5,AC12)

Refs: docs/specs/monkepic.md"
```

---

## Task 8: loader (AVIF/WebP-aware I/O)

**Files:**
- Create: `src/monkepic/loader.py`
- Test: `tests/test_loader.py`

- [ ] **Step 1: Write the failing test**

`tests/test_loader.py`:
```python
from pathlib import Path
import numpy as np
from PIL import Image
from monkepic.loader import load_image, save_image, list_images


def test_roundtrip_png(tmp_path):
    src = tmp_path / "m.png"
    Image.fromarray(np.full((10, 10, 4), 200, dtype=np.uint8), "RGBA").save(src)
    img = load_image(src)
    assert img.size == (10, 10)


def test_save_preserves_alpha_as_png(tmp_path):
    img = Image.fromarray(np.zeros((8, 8, 4), dtype=np.uint8), "RGBA")
    out = tmp_path / "out.png"
    save_image(img, out)
    assert load_image(out).mode == "RGBA"


def test_list_images_recursive(tmp_path):
    (tmp_path / "sub").mkdir()
    for name in ["a.png", "sub/b.jpg", "sub/c.webp", "notes.txt"]:
        p = tmp_path / name
        if p.suffix != ".txt":
            Image.new("RGB", (4, 4)).save(p)
        else:
            p.write_text("x")
    found = {p.name for p in list_images(tmp_path)}
    assert found == {"a.png", "b.jpg", "c.webp"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_loader.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: Implement**

`src/monkepic/loader.py`:
```python
from __future__ import annotations
from pathlib import Path
from PIL import Image

# Register AVIF/HEIC openers so Pillow can read SMB .avif files.
try:
    from pillow_heif import register_heif_opener, register_avif_opener
    register_heif_opener()
    register_avif_opener()
except Exception:  # pragma: no cover - environment without pillow-heif
    pass

SUPPORTED = {".png", ".jpg", ".jpeg", ".webp", ".avif", ".heic", ".bmp"}


def load_image(path: str | Path) -> Image.Image:
    return Image.open(Path(path))


def save_image(img: Image.Image, path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)


def list_images(path: str | Path) -> list[Path]:
    path = Path(path)
    if path.is_file():
        return [path] if path.suffix.lower() in SUPPORTED else []
    return sorted(p for p in path.rglob("*") if p.suffix.lower() in SUPPORTED)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_loader.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/loader.py tests/test_loader.py
git commit -m "feat: add AVIF/WebP-aware image loader (AC11)

Refs: docs/specs/monkepic.md"
```

---

## Task 9: compositor

**Files:**
- Create: `src/monkepic/compositor.py`
- Test: `tests/test_compositor.py`

- [ ] **Step 1: Write the failing test**

`tests/test_compositor.py`:
```python
import numpy as np
from PIL import Image
from monkepic.types import Placement
from monkepic.compositor import composite


def _red_square(size):
    return Image.fromarray(np.dstack([
        np.full((size, size), 255, np.uint8),
        np.zeros((size, size), np.uint8),
        np.zeros((size, size), np.uint8),
        np.full((size, size), 255, np.uint8),
    ]).astype(np.uint8), "RGBA")


def test_composite_places_monke_at_center():
    base = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    monke = _red_square(40)
    out = composite(base, monke, Placement(cx=100, cy=100, w=40, h=40, roll_deg=0))
    arr = np.array(out)
    assert tuple(arr[100, 100]) == (255, 0, 0, 255)  # center red
    assert arr[0, 0, 3] == 0                          # corner untouched


def test_composite_returns_rgba():
    base = Image.new("RGB", (50, 50), (255, 255, 255))
    out = composite(base, _red_square(10), Placement(25, 25, 10, 10, 0))
    assert out.mode == "RGBA"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_compositor.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: Implement**

`src/monkepic/compositor.py`:
```python
from __future__ import annotations
from PIL import Image
from .types import Placement


def composite(base: Image.Image, monke: Image.Image, placement: Placement) -> Image.Image:
    """Scale + rotate the (RGBA) monke and alpha-blend it onto base, centered at
    (placement.cx, placement.cy). Returns an RGBA copy of base."""
    canvas = base.convert("RGBA")
    m = monke.convert("RGBA").resize((placement.w, placement.h), Image.LANCZOS)
    if placement.roll_deg:
        # PIL rotates counter-clockwise for positive angles; negate so a positive
        # roll (right eye lower) tilts the monke the same way as the head.
        m = m.rotate(-placement.roll_deg, expand=True, resample=Image.BICUBIC)
    left = int(round(placement.cx - m.width / 2))
    top = int(round(placement.cy - m.height / 2))
    canvas.alpha_composite(m, (left, top))
    return canvas
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_compositor.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/compositor.py tests/test_compositor.py
git commit -m "feat: add monke compositor (scale/rotate/alpha-blend) (AC1,AC2)

Refs: docs/specs/monkepic.md"
```

---

## Task 10: crops (enrollment inbox export)

**Files:**
- Create: `src/monkepic/crops.py`
- Test: `tests/test_crops.py`

- [ ] **Step 1: Write the failing test**

`tests/test_crops.py`:
```python
from PIL import Image
from monkepic.types import FaceRegion
from monkepic.crops import export_crops


def _region(x, y, s):
    return FaceRegion(x, y, s, s, left_eye=(x + s * 0.3, y + s * 0.4),
                      right_eye=(x + s * 0.7, y + s * 0.4))


def test_export_one_crop_per_face(tmp_path):
    img = Image.new("RGB", (300, 300), (120, 120, 120))
    regions = [_region(20, 20, 60), _region(180, 180, 60)]
    paths = export_crops(img, regions, tmp_path, "raw-pic")
    assert [p.name for p in paths] == ["raw-pic__face_0.png", "raw-pic__face_1.png"]
    assert all(p.exists() for p in paths)


def test_export_handles_no_faces(tmp_path):
    img = Image.new("RGB", (50, 50))
    assert export_crops(img, [], tmp_path, "x") == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_crops.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: Implement**

`src/monkepic/crops.py`:
```python
from __future__ import annotations
from pathlib import Path
from PIL import Image
from .types import FaceRegion


def export_crops(image: Image.Image, regions: list[FaceRegion], dest_dir: str | Path,
                 source_stem: str, pad: float = 0.2) -> list[Path]:
    """Write one padded crop per detected face to dest_dir, named deterministically
    `<source_stem>__face_<i>.png`. Returns the written paths."""
    dest = Path(dest_dir)
    if not regions:
        return []
    dest.mkdir(parents=True, exist_ok=True)
    W, H = image.size
    paths: list[Path] = []
    for i, r in enumerate(regions):
        px, py = int(r.w * pad), int(r.h * pad)
        box = (max(0, r.x - px), max(0, r.y - py),
               min(W, r.x + r.w + px), min(H, r.y + r.h + py))
        out = dest / f"{source_stem}__face_{i}.png"
        image.crop(box).save(out)
        paths.append(out)
    return paths
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_crops.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/crops.py tests/test_crops.py
git commit -m "feat: add face-crop export for enrollment inbox (AC8)

Refs: docs/specs/monkepic.md"
```

---

## Task 11: detector (mediapipe wrapper)

**Files:**
- Create: `src/monkepic/detector.py`
- Test: `tests/test_detector_smoke.py`

- [ ] **Step 1: Write the smoke test (skips if model/photo absent)**

`tests/test_detector_smoke.py`:
```python
from pathlib import Path
import pytest
from monkepic.loader import load_image

SAMPLE = Path("Photos/Event-MiniGolf-24-04-2026/raw-pic.jpg")


@pytest.mark.skipif(not SAMPLE.exists(), reason="sample photo not present")
def test_detects_at_least_one_face():
    mediapipe = pytest.importorskip("mediapipe")  # noqa: F841
    from monkepic.detector import FaceDetector
    regions = FaceDetector().detect(load_image(SAMPLE))
    assert len(regions) >= 1
    r = regions[0]
    assert r.w > 0 and r.h > 0
    assert r.left_eye != r.right_eye
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_detector_smoke.py -v`
Expected: FAIL (ImportError: FaceDetector) — or SKIP if sample missing; if skipped, proceed.

- [ ] **Step 3: Implement**

`src/monkepic/detector.py`:
```python
from __future__ import annotations
import numpy as np
from PIL import Image
from .types import FaceRegion


class FaceDetector:
    """Thin wrapper over MediaPipe Face Detection. detect() returns pixel-space
    FaceRegions with left/right eye keypoints."""

    def __init__(self, model_selection: int = 1, min_confidence: float = 0.5):
        self._model_selection = model_selection
        self._min_confidence = min_confidence

    def detect(self, image: Image.Image) -> list[FaceRegion]:
        import mediapipe as mp

        rgb = np.array(image.convert("RGB"))
        h, w = rgb.shape[:2]
        out: list[FaceRegion] = []
        with mp.solutions.face_detection.FaceDetection(
            model_selection=self._model_selection,
            min_detection_confidence=self._min_confidence,
        ) as fd:
            result = fd.process(rgb)
            for det in result.detections or []:
                box = det.location_data.relative_bounding_box
                kps = det.location_data.relative_keypoints
                # MediaPipe keypoint order: 0 = right eye, 1 = left eye (subject's).
                right_eye = (kps[0].x * w, kps[0].y * h)
                left_eye = (kps[1].x * w, kps[1].y * h)
                out.append(FaceRegion(
                    x=max(0, int(box.xmin * w)),
                    y=max(0, int(box.ymin * h)),
                    w=int(box.width * w),
                    h=int(box.height * h),
                    left_eye=left_eye,
                    right_eye=right_eye,
                    confidence=float(det.score[0]) if det.score else 1.0,
                ))
        return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_detector_smoke.py -v`
Expected: PASS (or SKIP if sample photo absent — acceptable)

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/detector.py tests/test_detector_smoke.py
git commit -m "feat: add MediaPipe FaceDetector wrapper

Refs: docs/specs/monkepic.md"
```

---

## Task 12: pipeline (orchestration, detector mocked)

**Files:**
- Create: `src/monkepic/pipeline.py`
- Test: `tests/test_pipeline.py`

- [ ] **Step 1: Write the failing test**

`tests/test_pipeline.py`:
```python
from pathlib import Path
import numpy as np
from PIL import Image
from monkepic.types import FaceRegion
from monkepic.pipeline import process_image


class FakeDetector:
    def __init__(self, regions):
        self._regions = regions

    def detect(self, image):
        return self._regions


def _make_monke_pool(tmp_path, n):
    pool = tmp_path / "monkes"
    pool.mkdir()
    for i in range(n):
        arr = np.full((40, 40, 3), 255, dtype=np.uint8)  # white bg
        arr[10:30, 10:30] = [0, 255, 0]                  # green center
        Image.fromarray(arr, "RGB").save(pool / f"m{i}.png")
    return pool


def _region(x, y, s):
    return FaceRegion(x, y, s, s, (x + s * 0.3, y + s * 0.4), (x + s * 0.7, y + s * 0.4))


def test_covers_all_faces(tmp_path):
    src = tmp_path / "in.png"
    Image.new("RGB", (300, 300), (10, 10, 10)).save(src)
    pool = _make_monke_pool(tmp_path, 3)
    out_dir = tmp_path / "out"
    det = FakeDetector([_region(20, 20, 60), _region(150, 60, 60), _region(60, 180, 60)])

    out = process_image(src, pool, out_dir, det, seed=1)

    assert out.exists()
    arr = np.array(Image.open(out).convert("RGBA"))
    # each face center should now have green from a monke (was dark before)
    for (x, y, s) in [(20, 20, 60), (150, 60, 60), (60, 180, 60)]:
        cx, cy = x + s // 2, y + s // 2
        assert arr[cy, cx, 1] > 100  # green channel raised


def test_no_faces_copies_original(tmp_path):
    src = tmp_path / "in.png"
    Image.new("RGB", (40, 40), (123, 50, 7)).save(src)
    pool = _make_monke_pool(tmp_path, 1)
    out = process_image(src, pool, tmp_path / "out", FakeDetector([]), seed=1)
    assert np.array_equal(
        np.array(Image.open(out).convert("RGB")),
        np.array(Image.open(src).convert("RGB")),
    )


def test_export_crops_writes_inbox(tmp_path):
    src = tmp_path / "in.png"
    Image.new("RGB", (300, 300), (10, 10, 10)).save(src)
    pool = _make_monke_pool(tmp_path, 2)
    faces_dir = tmp_path / "faces_inbox"
    process_image(src, pool, tmp_path / "out", FakeDetector([_region(20, 20, 60), _region(150, 150, 60)]),
                  seed=1, crops_dir=faces_dir)
    assert len(list(faces_dir.glob("in__face_*.png"))) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_pipeline.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: Implement**

`src/monkepic/pipeline.py`:
```python
from __future__ import annotations
import shutil
from pathlib import Path
from PIL import Image
from . import geometry
from .background import ensure_transparent
from .compositor import composite
from .crops import export_crops
from .loader import load_image, save_image, list_images
from .selector import MonkeSelector
from .types import Placement


def process_image(src, monke_pool, out_dir, detector, *, margin: float = 0.4,
                  rotate: bool = True, seed: int | None = None,
                  crops_dir=None, forced_monke=None) -> Path:
    """Anonymize one photo: detect faces, cover each with a monke. Returns output path."""
    src = Path(src)
    out_dir = Path(out_dir)
    out_path = out_dir / f"{src.stem}-monked.png"
    out_dir.mkdir(parents=True, exist_ok=True)

    image = load_image(src)
    regions = detector.detect(image)

    if not regions:
        shutil.copyfile(src, out_dir / src.name)
        return out_dir / src.name

    if crops_dir is not None:
        export_crops(image, regions, crops_dir, src.stem)

    if forced_monke is not None:
        monke_paths = [Path(forced_monke)] * len(regions)
    else:
        pool = list_images(monke_pool)
        if not pool:
            raise ValueError(f"no monkes found in {monke_pool}")
        monke_paths = MonkeSelector(pool, seed=seed).assign(len(regions))

    canvas = image.convert("RGBA")
    for region, monke_path in zip(regions, monke_paths):
        monke = ensure_transparent(load_image(monke_path))
        cx, cy, bw, bh = geometry.head_box(region.x, region.y, region.w, region.h, margin)
        tw, th = geometry.monke_target_size(bw, bh, monke.width, monke.height)
        roll = geometry.roll_degrees(region.left_eye, region.right_eye) if rotate else 0.0
        canvas = composite(canvas, monke, Placement(cx, cy, tw, th, roll))

    save_image(canvas, out_path)
    return out_path


def process_path(src, monke_pool, out_dir, detector, **kwargs) -> list[Path]:
    """Process a single file or every supported image in a directory."""
    return [process_image(p, monke_pool, out_dir, detector, **kwargs)
            for p in list_images(src)]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_pipeline.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/pipeline.py tests/test_pipeline.py
git commit -m "feat: add anonymizer pipeline (AC1,AC6,AC9 + crops AC8)

Refs: docs/specs/monkepic.md"
```

---

## Task 13: CLI

**Files:**
- Create: `src/monkepic/cli.py`
- Test: `tests/test_cli.py`

- [ ] **Step 1: Write the failing test**

`tests/test_cli.py`:
```python
from pathlib import Path
import numpy as np
from PIL import Image
from monkepic.types import FaceRegion
from monkepic import cli


class FakeDetector:
    def detect(self, image):
        w, h = image.size
        s = min(w, h) // 3
        return [FaceRegion(s, s, s, s, (s * 1.3, s * 1.4), (s * 1.7, s * 1.4))]


def _setup(tmp_path):
    pool = tmp_path / "monkes"
    pool.mkdir()
    arr = np.full((40, 40, 3), 255, dtype=np.uint8)
    arr[10:30, 10:30] = [0, 255, 0]
    Image.fromarray(arr, "RGB").save(pool / "m0.png")
    return pool


def test_cli_single_file(tmp_path):
    src = tmp_path / "in.png"
    Image.new("RGB", (300, 300), (10, 10, 10)).save(src)
    pool = _setup(tmp_path)
    out_dir = tmp_path / "out"
    rc = cli.main(["--monkes", str(pool), "--out", str(out_dir), str(src)],
                  detector=FakeDetector())
    assert rc == 0
    assert (out_dir / "in-monked.png").exists()


def test_cli_directory(tmp_path):
    in_dir = tmp_path / "photos"
    in_dir.mkdir()
    for name in ["a.png", "b.png"]:
        Image.new("RGB", (300, 300), (10, 10, 10)).save(in_dir / name)
    pool = _setup(tmp_path)
    out_dir = tmp_path / "out"
    rc = cli.main(["--monkes", str(pool), "--out", str(out_dir), str(in_dir)],
                  detector=FakeDetector())
    assert rc == 0
    assert {p.name for p in out_dir.glob("*-monked.png")} == {"a-monked.png", "b-monked.png"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_cli.py -v`
Expected: FAIL (ModuleNotFoundError / AttributeError: main)

- [ ] **Step 3: Implement**

`src/monkepic/cli.py`:
```python
from __future__ import annotations
import argparse
import sys
from .pipeline import process_path


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="monkepic", description="Cover faces in a photo with SMB monkes.")
    p.add_argument("input", help="photo file or directory")
    p.add_argument("--monkes", default="Argentina Monkes", help="monke pool directory")
    p.add_argument("--monke", default=None, help="force one specific monke for all faces")
    p.add_argument("--out", default="output", help="output directory")
    p.add_argument("--margin", type=float, default=0.4, help="head-box margin")
    p.add_argument("--no-rotate", action="store_true", help="disable 2D roll")
    p.add_argument("--export-crops", default=None, metavar="DIR",
                   help="also write face crops to this directory (e.g. faces/_inbox)")
    p.add_argument("--seed", type=int, default=None, help="RNG seed for selection")
    p.add_argument("--min-confidence", type=float, default=0.5, help="detector threshold")
    return p


def main(argv=None, detector=None) -> int:
    args = build_parser().parse_args(argv)
    if detector is None:
        from .detector import FaceDetector
        detector = FaceDetector(min_confidence=args.min_confidence)

    outputs = process_path(
        args.input, args.monkes, args.out, detector,
        margin=args.margin, rotate=not args.no_rotate, seed=args.seed,
        crops_dir=args.export_crops, forced_monke=args.monke,
    )
    if not outputs:
        print(f"No images found at {args.input}", file=sys.stderr)
        return 1
    for o in outputs:
        print(o)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_cli.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add src/monkepic/cli.py tests/test_cli.py
git commit -m "feat: add monkepic CLI (file + directory) (AC10)

Refs: docs/specs/monkepic.md"
```

---

## Task 14: README + full verification + real-photo smoke run

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# MonkePic

Local, offline tool that covers every face in a photo with a Solana Monkey
Business (SMB) monke — background removed, scaled, positioned and rotated to the
head. Built for MonkeDAO Argentina event-photo privacy.

## Install

```bash
uv venv
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

## Privacy

Everything runs locally. The only network access is a one-time model-weights
download (face detector / rembg) on first run. No photo ever leaves your machine.
```

- [ ] **Step 2: Run the full test suite**

Run: `uv run pytest -v`
Expected: all tests pass (detector smoke test passes or skips).

- [ ] **Step 3: Lint**

Run: `uv run ruff check src tests`
Expected: no errors (fix any reported).

- [ ] **Step 4: Real-photo smoke run (manual verification)**

Run:
```bash
uv run monkepic "Photos/Event-MiniGolf-24-04-2026/raw-pic.jpg" \
  --monkes "Argentina Monkes" --out output --export-crops faces/_inbox --seed 1
```
Expected: prints `output/raw-pic-monked.png`; open it and confirm faces are
covered with monkes (sized/rotated sensibly) and `faces/_inbox/` has one crop per
detected face. Note margin/threshold tuning needs in the spec's "open decisions".

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add README with usage and privacy notes

Refs: docs/specs/monkepic.md"
```

---

## DoD coverage map (acceptance criteria -> task)

- AC1 composite over each face -> Task 9, Task 12
- AC2 rotation matches roll -> Task 2, Task 9
- AC3 scaled to head box -> Task 3, Task 4
- AC4 solid-bg cutout -> Task 6, Task 7
- AC5 alpha preserved -> Task 6, Task 7
- AC6 multi-face all covered -> Task 12
- AC7 no-repeat selection -> Task 5
- AC8 crop export -> Task 10, Task 12
- AC9 no-face passthrough -> Task 12
- AC10 CLI file + dir -> Task 13
- AC11 AVIF/WebP load -> Task 8
- AC12 ML fallback tier -> Task 6, Task 7

## Self-review notes

- Spec coverage: every AC maps to a task (table above); phases 2/3 intentionally
  out of this plan.
- Type consistency: `head_box`/`monke_target_size`/`roll_degrees` signatures match
  their use in `pipeline.process_image`; `Placement`/`FaceRegion` fields are used
  consistently across compositor, crops, detector, pipeline.
- No placeholders: every code/test step contains complete code.
