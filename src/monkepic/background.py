from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw

_SENTINEL = (1, 254, 2)  # improbable color used as flood-fill marker


def has_alpha(img: Image.Image) -> bool:
    """True if the image has an alpha channel with at least one non-opaque pixel."""
    if img.mode not in ("RGBA", "LA"):
        return False
    alpha = np.array(img.convert("RGBA"))[:, :, 3]
    return bool(alpha.min() < 255)


def _corner_colors(img: Image.Image) -> np.ndarray:
    arr = np.array(img.convert("RGB"))
    h, w = arr.shape[:2]
    return np.array(
        [arr[0, 0], arr[0, w - 1], arr[h - 1, 0], arr[h - 1, w - 1]], dtype=np.int16
    )


def is_solid_background(img: Image.Image, tol: int = 25) -> bool:
    """True if all four corners agree within ``tol`` (a flat background)."""
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
    result = rembg_fn(img)
    return result if result.mode == "RGBA" else result.convert("RGBA")


def _default_rembg(image: Image.Image) -> Image.Image:
    from rembg import remove  # imported lazily; heavy dependency

    return remove(image)


def ensure_transparent(
    img: Image.Image, tol: int = 25, rembg_fn=_default_rembg
) -> Image.Image:
    """Return an RGBA monke with its background removed, choosing the tier
    automatically: alpha pass-through -> solid-color cutout -> ML fallback."""
    tier = select_tier(img, tol)
    if tier == "alpha":
        return img.convert("RGBA")
    if tier == "solid":
        return solid_cutout(img, tol)
    return ml_cutout(img, rembg_fn)
