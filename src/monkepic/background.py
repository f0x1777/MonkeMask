from __future__ import annotations

from collections import deque

import numpy as np
from PIL import Image, ImageDraw

_SENTINEL = (1, 254, 2)  # improbable color used as flood-fill marker


def border_flood_cutout(img: Image.Image, tol: int = 42) -> Image.Image:
    """Remove a gradient/multi-color background by flooding inward from EVERY border
    pixel, following local color similarity (a neighbour joins the background if its
    colour is within ``tol`` of the current pixel). Handles smooth gradients that a
    single corner-colour flood (solid_cutout) and rembg both mishandle on pixel-art.

    On its own this can over- or under-shoot; pair with combine_with_silhouette."""
    rgb = np.array(img.convert("RGB"), dtype=np.int16)
    h, w = rgb.shape[:2]
    bg = np.zeros((h, w), dtype=bool)
    dq: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not bg[y, x]:
                bg[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not bg[y, x]:
                bg[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        c = rgb[y, x]
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not bg[ny, nx]:
                if int(np.abs(rgb[ny, nx] - c).max()) <= tol:
                    bg[ny, nx] = True
                    dq.append((ny, nx))
    out = np.array(img.convert("RGBA"))
    out[bg, 3] = 0
    return Image.fromarray(out, "RGBA")


def combine_with_silhouette(
    img: Image.Image, core: np.ndarray, far: np.ndarray
) -> Image.Image:
    """Refine an already-cut RGBA using a consensus monke silhouette:
    - keep anything the cut kept (alpha>0) OR inside ``core`` (rescues subject parts
      the flood wrongly ate), then
    - drop anything outside ``far`` (removes background the flood missed).
    ``core``/``far`` are boolean masks the size of ``img`` (core ⊂ far)."""
    rgba = np.array(img.convert("RGBA"))
    kept = rgba[:, :, 3] > 16
    monke = (kept | core) & far
    rgba[~monke, 3] = 0
    # Rescue subject pixels the cut wrongly erased: anything in core that is now
    # transparent gets restored to fully opaque.
    rescued = core & far & (rgba[:, :, 3] == 0)
    rgba[rescued, 3] = 255
    return Image.fromarray(rgba, "RGBA")


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


def trim_transparent(img: Image.Image, alpha_thresh: int = 16) -> Image.Image:
    """Crop an RGBA image to the bounding box of its opaque content.

    SMB monke PNGs carry large transparent padding (often ~20-30% at the top and
    none at the bottom). Without trimming, scaling+centering the WHOLE PNG over a
    head leaves the monke too small and shifted down, exposing the forehead/eyes.
    Trimming makes the visible monke fill the head box."""
    rgba = img.convert("RGBA")
    alpha = np.array(rgba)[:, :, 3]
    ys, xs = np.where(alpha > alpha_thresh)
    if len(xs) == 0:
        return rgba
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    if box == (0, 0, rgba.width, rgba.height):
        return rgba
    return rgba.crop(box)


def build_silhouette(solid_imgs, size: int = 256, thresh: float = 0.35):
    """Average the opaque masks of cleanly-cut (solid-background) monkes into a
    consensus silhouette. Returns (core, far) boolean masks at ``size``x``size``:
    ``core`` = pixels almost all monkes fill (rescue zone), ``far`` = pixels at
    least a few monkes ever fill (clip zone). SMB monkes share a centred head+body
    layout, so this template reconstructs the shape when per-image cutting fails."""
    acc = np.zeros((size, size), dtype=float)
    n = 0
    for im in solid_imgs:
        cut = solid_cutout(im).resize((size, size))
        acc += (np.array(cut)[:, :, 3] > 16).astype(float)
        n += 1
    if n == 0:
        return None
    consensus = acc / n
    core = consensus >= thresh
    far = consensus >= 0.05
    return core, far


def _resize_mask(mask: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    m = Image.fromarray((mask.astype(np.uint8) * 255)).resize(size)
    return np.array(m) > 127


def ensure_transparent(
    img: Image.Image, tol: int = 25, rembg_fn=_default_rembg, silhouette=None
) -> Image.Image:
    """Return an RGBA monke with its background removed AND trimmed to its opaque
    content. Tier is chosen automatically:
    - alpha pass-through (already transparent);
    - solid-colour cutout (flat background);
    - gradient/multi-colour background: border-flood, refined by a consensus monke
      silhouette when ``silhouette=(core, far)`` is supplied (recommended), else a
      plain border-flood; rembg is the last resort.
    Trimming ensures the monke actually covers the head."""
    tier = select_tier(img, tol)
    if tier == "alpha":
        cut = img.convert("RGBA")
    elif tier == "solid":
        cut = solid_cutout(img, tol)
    else:
        flooded = border_flood_cutout(img)
        if silhouette is not None:
            core, far = silhouette
            w, h = flooded.size
            cut = combine_with_silhouette(
                flooded, _resize_mask(core, (w, h)), _resize_mask(far, (w, h))
            )
        else:
            cut = flooded
    return trim_transparent(cut)
