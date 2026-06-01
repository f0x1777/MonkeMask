from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image

from monkepic import geometry
from monkepic.background import ensure_transparent
from monkepic.compositor import composite
from monkepic.facefilter import filter_background
from monkepic.loader import load_image
from monkepic.types import Placement

# Adapter layer: bytes in -> monkepic core -> bytes/JSON out. No image logic of its
# own; it only marshals data and calls the shared core so the web cannot drift from
# the CLI.

_THUMB = 128


def _png_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.convert("RGBA").save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _thumb(img: Image.Image, size: int = _THUMB) -> Image.Image:
    t = img.convert("RGBA").copy()
    t.thumbnail((size, size))
    return t


def detect_faces(photo_path: str | Path, detector, *, min_confidence=None):
    """Return [(FaceRegion, thumbnail_b64), ...] for non-background faces."""
    image = load_image(photo_path)
    regions = filter_background(detector.detect(image))
    out = []
    rgb = image.convert("RGB")
    for r in regions:
        crop = rgb.crop((r.x, r.y, r.x + r.w, r.y + r.h))
        out.append((r, _png_b64(_thumb(crop))))
    return out


def monke_thumb(monke_path: str | Path) -> str:
    """Background-removed thumbnail of a monke (data URL)."""
    return _png_b64(_thumb(ensure_transparent(load_image(monke_path))))


def placement_for(region, monke: Image.Image, *, margin: float = 1.0,
                  rotate: bool = True) -> Placement:
    """Build the Placement for a face using the SAME geometry as the CLI."""
    cx, cy, bw, bh = geometry.head_box(region.x, region.y, region.w, region.h, margin)
    tw, th = geometry.monke_target_size(bw, bh, monke.width, monke.height)
    roll = geometry.eye_roll(region.left_eye, region.right_eye) if rotate else 0.0
    return Placement(cx, cy, tw, th, roll)


def compose(photo_path: str | Path, pairs, *, margin: float = 1.0,
            rotate: bool = True) -> bytes:
    """``pairs`` is a list of (FaceRegion, monke_path). Returns PNG bytes.

    Faces not present in ``pairs`` are left uncovered (the UI warns the user)."""
    canvas = load_image(photo_path).convert("RGBA")
    for region, monke_path in pairs:
        monke = ensure_transparent(load_image(monke_path))
        canvas = composite(canvas, monke, placement_for(region, monke,
                                                         margin=margin, rotate=rotate))
    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return buf.getvalue()
