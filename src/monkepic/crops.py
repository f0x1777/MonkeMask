from __future__ import annotations

from pathlib import Path

from PIL import Image

from .types import FaceRegion


def export_crops(
    image: Image.Image,
    regions: list[FaceRegion],
    dest_dir: str | Path,
    source_stem: str,
    pad: float = 0.2,
) -> list[Path]:
    """Write one padded crop per detected face to dest_dir, named deterministically
    ``<source_stem>__face_<i>.png``. Returns the written paths."""
    dest = Path(dest_dir)
    if not regions:
        return []
    dest.mkdir(parents=True, exist_ok=True)
    W, H = image.size
    paths: list[Path] = []
    for i, r in enumerate(regions):
        px, py = int(r.w * pad), int(r.h * pad)
        box = (
            max(0, r.x - px),
            max(0, r.y - py),
            min(W, r.x + r.w + px),
            min(H, r.y + r.h + py),
        )
        out = dest / f"{source_stem}__face_{i}.png"
        image.crop(box).save(out)
        paths.append(out)
    return paths
