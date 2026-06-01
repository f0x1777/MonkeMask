from __future__ import annotations

from collections import Counter, deque
from pathlib import Path

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


def _border_palette(rgb: np.ndarray, dark_lum: int, min_frac: float) -> np.ndarray | None:
    """NON-dark colours of the 2px border ring that each cover at least ``min_frac``
    of the (non-dark) border, as an (k,3) int16 array. A frequency floor (rather than
    a cumulative cover) keeps BOTH a dominant gradient and the recurring checker-dot
    colour (each a few percent), while excluding a thin subject intrusion at the edge
    (e.g. a suit corner) and pixel noise. Always keeps at least the top colour."""
    ring = np.concatenate([
        rgb[0:2].reshape(-1, 3), rgb[-2:].reshape(-1, 3),
        rgb[:, 0:2].reshape(-1, 3), rgb[:, -2:].reshape(-1, 3),
    ])
    ring = ring[ring.mean(axis=1) >= dark_lum]  # drop dark outline/suit at the border
    if len(ring) == 0:
        return None
    quant = (ring // 12 * 12)
    counts = Counter(map(tuple, quant.tolist()))
    total = len(ring)
    palette = [c for c, n in counts.most_common() if n / total >= min_frac]
    if not palette:  # everything below the floor: fall back to the single top colour
        palette = [counts.most_common(1)[0][0]]
    return np.array(palette, dtype=np.int16)


def palette_border_cutout(
    img: Image.Image, tol: int = 46, dark_lum: int = 105, min_frac: float = 0.02,
    core: np.ndarray | None = None,
) -> Image.Image:
    """Remove an SMB-style background (smooth pastel gradient + a regular checker-dot
    overlay) that the local-similarity ``border_flood_cutout`` mishandles — it tunnels
    into a similarly-coloured suit and leaves high-contrast checker specks.

    Builds the background palette from the non-dark border ring, then floods inward
    from the border marking any border-connected pixel within ``tol`` of SOME palette
    colour as background. The dark monke outline (luminance < ``dark_lum``) is a wall
    the flood cannot cross, so it can't tunnel into the suit. When ``core`` (a boolean
    subject mask the size of the image) is given, a second colour pass also clears
    palette-matching pixels OUTSIDE the core — removing background trapped inside the
    outline (e.g. between hat and face) while protecting the suit the core covers."""
    rgb = np.array(img.convert("RGB"), dtype=np.int16)
    h, w = rgb.shape[:2]
    lum = rgb.mean(axis=2)
    palette = _border_palette(rgb, dark_lum, min_frac)
    if palette is None:
        return img.convert("RGBA")  # all-dark border: can't infer a background
    # match[y,x] = pixel is background-coloured (near some palette colour) and not the
    # dark outline. Computed via broadcasting over the small palette.
    dist = np.abs(rgb[:, :, None, :] - palette[None, None, :, :]).max(axis=3)
    match = (dist.min(axis=2) <= tol) & (lum >= dark_lum)
    # ``core`` pixels are known subject: never removable, and impassable to the flood
    # (so it can't reach a suit even on a flat field with no enclosing outline).
    removable = match if core is None else (match & ~core)
    bg = np.zeros((h, w), dtype=bool)
    dq: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if removable[y, x] and not bg[y, x]:
                bg[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if removable[y, x] and not bg[y, x]:
                bg[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not bg[ny, nx] and removable[ny, nx]:
                bg[ny, nx] = True
                dq.append((ny, nx))
    if core is not None:
        bg |= removable  # colour pass: clear trapped bg everywhere outside the core
    out = np.array(img.convert("RGBA"))
    out[bg, 3] = 0
    return Image.fromarray(out, "RGBA")


def clean_background_fringe(
    img: Image.Image, cut: Image.Image, tol: int = 52, dark_lum: int = 105,
    min_frac: float = 0.02,
) -> Image.Image:
    """Second pass: eat residual background still clinging to an already-cut monke.

    After the palette cut + silhouette refinement, a halo of background-coloured
    pixels can survive around the dark outline (the SMB checker/gradient dithered
    against the hair, or a stray blob the silhouette rescued). Flood INWARD from the
    cut's transparent region, removing any opaque pixel that is within ``tol`` of the
    border background palette and not part of the dark monke outline. The flood is
    walled by that dark outline, so it strips the outer halo without entering the
    subject (the face/suit enclosed by the outline stays). ``img`` is the original
    (for colours), ``cut`` the current RGBA."""
    rgb = np.array(img.convert("RGB"), dtype=np.int16)
    h, w = rgb.shape[:2]
    lum = rgb.mean(axis=2)
    palette = _border_palette(rgb, dark_lum, min_frac)
    rgba = np.array(cut.convert("RGBA"))
    if palette is None:
        return Image.fromarray(rgba, "RGBA")
    dist = np.abs(rgb[:, :, None, :] - palette[None, None, :, :]).max(axis=3)
    opaque = rgba[:, :, 3] > 16
    # Pixels eligible to be eaten: opaque, background-coloured, not the dark outline.
    removable = (dist.min(axis=2) <= tol) & (lum >= dark_lum) & opaque
    transparent = ~opaque
    # Grow the transparent region into adjacent removable pixels until it stops
    # (vectorised flood: each dilation step adds one ring, bounded by the outline).
    import cv2

    kernel = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=np.uint8)
    reach = transparent.astype(np.uint8)
    allowed = transparent | removable
    while True:
        grown = (cv2.dilate(reach, kernel) > 0) & allowed
        if int(grown.sum()) == int(reach.sum()):
            break
        reach = grown.astype(np.uint8)
    eaten = (reach > 0) & removable
    rgba[eaten, 3] = 0
    return Image.fromarray(rgba, "RGBA")


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


_SILHOUETTE_ASSET = Path(__file__).parent / "assets" / "smb_silhouette.npz"
_silhouette_cache: tuple[np.ndarray, np.ndarray] | None | str = "unset"


def load_smb_silhouette() -> tuple[np.ndarray, np.ndarray] | None:
    """Load the bundled consensus SMB silhouette ``(core, far)`` (cached). The asset
    is a tiny bit-packed pair of 256x256 masks averaged from many solid-background
    monkes; it encodes the shared SMB head+body shape so gradient/checker-background
    monkes can be reconstructed. Returns ``None`` if the asset is absent."""
    global _silhouette_cache
    if _silhouette_cache == "unset":
        if _SILHOUETTE_ASSET.exists():
            data = np.load(_SILHOUETTE_ASSET)
            size = int(data["size"])
            n = size * size
            core = np.unpackbits(data["core"])[:n].reshape(size, size).astype(bool)
            far = np.unpackbits(data["far"])[:n].reshape(size, size).astype(bool)
            _silhouette_cache = (core, far)
        else:
            _silhouette_cache = None
    return _silhouette_cache if _silhouette_cache != "unset" else None


def ensure_transparent(
    img: Image.Image, tol: int = 25, rembg_fn=_default_rembg, silhouette="auto"
) -> Image.Image:
    """Return an RGBA monke with its background removed AND trimmed to its opaque
    content. Tier is chosen automatically:
    - alpha pass-through (already transparent);
    - solid-colour cutout (flat background);
    - gradient/checker background: a palette-aware border cutout (handles the SMB
      pastel-gradient + checker-dot background), refined by a consensus monke
      silhouette, then a fringe-cleanup pass that strips any residual background halo.
      ``silhouette`` is ``"auto"`` (load the bundled SMB template), an explicit
      ``(core, far)`` pair, or ``None`` (no silhouette refinement).
    Trimming ensures the monke actually covers the head."""
    tier = select_tier(img, tol)
    if tier == "alpha":
        cut = img.convert("RGBA")
    elif tier == "solid":
        cut = solid_cutout(img, tol)
    else:
        if silhouette == "auto":
            silhouette = load_smb_silhouette()
        if silhouette is not None:
            core, far = silhouette
            w, h = img.size
            core_m, far_m = _resize_mask(core, (w, h)), _resize_mask(far, (w, h))
            # Palette cutout with the core protecting the suit; silhouette then
            # rescues any subject the cut still ate and clips leftover background.
            cut = combine_with_silhouette(
                palette_border_cutout(img, core=core_m), core_m, far_m
            )
        else:
            cut = palette_border_cutout(img)
        # Second pass: strip any background halo still clinging to the outline.
        cut = clean_background_fringe(img, cut)
    return trim_transparent(cut)
