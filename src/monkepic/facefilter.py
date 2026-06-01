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
