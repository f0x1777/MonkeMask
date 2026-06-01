from __future__ import annotations

import shutil
from pathlib import Path

from . import geometry
from .background import ensure_transparent
from .compositor import composite
from .crops import export_crops
from .layout import resolve_overlaps
from .loader import list_images, load_image, save_image
from .selector import MonkeSelector


def process_image(
    src,
    monke_pool,
    out_dir,
    detector,
    *,
    margin: float = 1.0,
    rotate: bool = True,
    seed: int | None = None,
    crops_dir=None,
    forced_monke=None,
    choose_monke=None,
) -> Path:
    """Anonymize one photo: detect faces, cover each with a monke. Returns output path.

    ``out_dir=None`` writes the result next to the input photo.
    """
    src = Path(src)
    out_dir = Path(out_dir) if out_dir is not None else src.parent
    out_path = out_dir / f"{src.stem}-monked.png"
    out_dir.mkdir(parents=True, exist_ok=True)

    image = load_image(src)
    regions = detector.detect(image)

    if not regions:
        # Keep the original format/pixels but never clobber the source file.
        dest = out_dir / f"{src.stem}-monked{src.suffix}"
        shutil.copyfile(src, dest)
        return dest

    if crops_dir is not None:
        export_crops(image, regions, crops_dir, src.stem)

    if choose_monke is not None:
        monke_paths = [Path(p) for p in choose_monke(regions)]
    elif forced_monke is not None:
        monke_paths = [Path(forced_monke)] * len(regions)
    else:
        pool = list_images(monke_pool)
        if not pool:
            raise ValueError(f"no monkes found in {monke_pool}")
        monke_paths = MonkeSelector(pool, seed=seed).assign(len(regions))

    # Compute every placement first, nudge overlapping monkes apart, then composite.
    monkes = [ensure_transparent(load_image(p)) for p in monke_paths]
    placements = [
        geometry.placement_for(r, m.width, m.height, margin=margin, rotate=rotate)
        for r, m in zip(regions, monkes)
    ]
    face_boxes = [(r.x, r.y, r.w, r.h) for r in regions]
    placements = resolve_overlaps(placements, face_boxes)

    canvas = image.convert("RGBA")
    for monke, placement in zip(monkes, placements):
        canvas = composite(canvas, monke, placement)

    save_image(canvas, out_path)
    return out_path


def process_path(src, monke_pool, out_dir, detector, **kwargs) -> list[Path]:
    """Process a single file or every supported image in a directory.

    Skips already-processed ``*-monked.*`` files so re-running on a folder that
    holds its own outputs (default same-folder output) is safe.
    """
    inputs = [p for p in list_images(src) if not p.stem.endswith("-monked")]
    return [process_image(p, monke_pool, out_dir, detector, **kwargs) for p in inputs]
