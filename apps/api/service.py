from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image

import numpy as np

from monkepic import geometry
from monkepic.background import ensure_transparent
from monkepic.compositor import composite
from monkepic.facefilter import filter_background
from monkepic.layout import depth_order, resolve_overlaps
from monkepic.loader import load_image
from monkepic.recognizer import Recognizer
from monkepic.types import Placement, PersonEntry

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


def rotate_photo(photo_path: str | Path, degrees: int) -> None:
    """Rotate the stored photo in place by ``degrees`` (90/180/270, clockwise).
    Saved as PNG bytes so EXIF can't reintroduce a rotation on reload."""
    image = load_image(photo_path).convert("RGB")
    # PIL rotates counter-clockwise for positive angles; negate for clockwise.
    rotated = image.rotate(-degrees, expand=True)
    rotated.save(photo_path, format="PNG")


def monke_thumb(monke_path: str | Path) -> str:
    """Background-removed thumbnail of a monke (data URL)."""
    return _png_b64(_thumb(ensure_transparent(load_image(monke_path))))


def placement_for(region, monke: Image.Image, *, margin: float = 1.0,
                  rotate: bool = True) -> Placement:
    """Build the Placement for a face using the SAME geometry as the CLI."""
    return geometry.placement_for(region, monke.width, monke.height,
                                  margin=margin, rotate=rotate)


def enroll_person(face_paths, embedder, detector):
    """Average the embeddings of a person's reference face photos. Returns
    ``(embedding_tuple | None, usable_refs)``. Reuses the same embedder+detector
    path as the CLI gallery so similarities are comparable at suggest time."""
    vecs = []
    for fp in face_paths:
        try:
            image = load_image(fp)
            regions = detector.detect(image)
            if not regions:
                continue
            vecs.append(embedder.embed(image, regions[0]))
        except Exception:
            continue
    if not vecs:
        return None, 0
    mean = np.mean(np.array(vecs, dtype=float), axis=0)
    mean = mean / max(float(np.linalg.norm(mean)), 1e-12)
    return tuple(mean.tolist()), len(vecs)


def suggest(photo_path, people, embedder, detector, *, threshold: float = 0.5):
    """For each non-background face, match against the session ``people`` and return
    ``(suggestions, unmatched)``. ``people`` is a list of dicts with keys
    ``person_id``, ``monke_id``, ``embedding``. Unmatched = faces below threshold or
    whose embedding fails (never a silent wrong assignment)."""
    image = load_image(photo_path)
    regions = filter_background(detector.detect(image))

    gallery = [
        PersonEntry(p["person_id"], Path(p["monke_id"]), tuple(p["embedding"]), 1)
        for p in people
        if p.get("embedding") is not None
    ]
    by_pid = {p["person_id"]: p for p in people}
    # generic_monke path is irrelevant here; we only read the matched person.
    rec = Recognizer(gallery, Path("generic"), threshold) if gallery else None

    suggestions = []
    unmatched = []
    for i, _r in enumerate(regions):
        if rec is None:
            unmatched.append(i)
            continue
        try:
            emb = embedder.embed(image, _r)
        except Exception:
            unmatched.append(i)
            continue
        result = rec.match(emb)
        if result.is_generic or result.person is None:
            unmatched.append(i)
        else:
            person = by_pid[result.person]
            suggestions.append({
                "face_index": i,
                "person_id": result.person,
                "monke_id": person["monke_id"],
                "similarity": round(result.similarity, 4),
            })
    return suggestions, unmatched


def compose(photo_path: str | Path, pairs, *, margin: float = 1.0,
            rotate: bool = True, offsets=None) -> bytes:
    """``pairs`` is a list of (FaceRegion, monke_path). Returns PNG bytes.

    Overlapping monkes (close faces) are nudged apart automatically. ``offsets`` is
    an optional list of per-pair manual adjustments applied AFTER the auto layout —
    each is ``(dx, dy)`` or ``(dx, dy, scale)`` in original-image pixels (scale is a
    multiplier on the monke size, default 1.0). This is how the web lets a user
    drag/resize a monke by hand. Faces not present in ``pairs`` are left uncovered."""
    canvas = load_image(photo_path).convert("RGBA")
    monkes = [ensure_transparent(load_image(mp)) for _, mp in pairs]
    placements = [placement_for(r, m, margin=margin, rotate=rotate)
                  for (r, _), m in zip(pairs, monkes)]
    faces = [(r.x, r.y, r.w, r.h) for r, _ in pairs]
    placements = resolve_overlaps(placements, faces)
    if offsets:
        adjusted = []
        for p, off in zip(placements, offsets):
            dx, dy = off[0], off[1]
            scale = off[2] if len(off) > 2 else 1.0
            adjusted.append(Placement(
                p.cx + dx, p.cy + dy,
                max(1, round(p.w * scale)), max(1, round(p.h * scale)),
                p.roll_deg,
            ))
        placements = adjusted
    # Paint back-to-front so a nearer monke covers a farther one's residual overlap.
    # clamp=False always: a face near/over an image edge keeps its monke centred on it
    # (cropped at the border) instead of sliding inward and leaving the face exposed —
    # both for auto-placement and for manual drags/resizes.
    for i in depth_order(faces):
        canvas = composite(canvas, monkes[i], placements[i], clamp=False)
    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return buf.getvalue()


def layout(photo_path: str | Path, pairs, *, margin: float = 1.0,
           rotate: bool = True, max_cutout: int = 512):
    """Return the data the web client needs to preview placement WITHOUT a server
    render: ``(image_w, image_h, items)``. Each item is the background-removed monke
    (trimmed, as a data URL) plus its base placement in original-image pixels
    (``cx, cy, w, h, roll_deg``) and paint order ``z`` (back-to-front rank). The
    client overlays these and applies the user's live offsets in the browser; only
    the final download calls :func:`compose`. Uses the SAME geometry as compose so the
    preview matches the final render. ``offsets`` are intentionally NOT applied here —
    they are the client's live state on top of these base placements."""
    canvas = load_image(photo_path).convert("RGBA")
    monkes = [ensure_transparent(load_image(mp)) for _, mp in pairs]
    placements = [placement_for(r, m, margin=margin, rotate=rotate)
                  for (r, _), m in zip(pairs, monkes)]
    faces = [(r.x, r.y, r.w, r.h) for r, _ in pairs]
    placements = resolve_overlaps(placements, faces)
    zrank = {idx: rank for rank, idx in enumerate(depth_order(faces))}
    items = []
    for i, (m, pl) in enumerate(zip(monkes, placements)):
        thumb = m.copy()
        thumb.thumbnail((max_cutout, max_cutout))  # cap preview weight; w/h are in img px
        items.append({
            "monke": _png_b64(thumb),
            "cx": pl.cx, "cy": pl.cy, "w": pl.w, "h": pl.h,
            "roll_deg": pl.roll_deg, "z": zrank[i],
        })
    return canvas.width, canvas.height, items
