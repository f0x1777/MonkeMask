from __future__ import annotations

import shutil
from pathlib import Path

from . import geometry
from .background import ensure_transparent
from .compositor import composite
from .crops import export_crops
from .loader import list_images, load_image, save_image
from .selector import MonkeSelector
from .types import Placement


def process_image(
    src,
    monke_pool,
    out_dir,
    detector,
    *,
    margin: float = 0.4,
    rotate: bool = True,
    seed: int | None = None,
    crops_dir=None,
    forced_monke=None,
) -> Path:
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
    return [
        process_image(p, monke_pool, out_dir, detector, **kwargs)
        for p in list_images(src)
    ]
