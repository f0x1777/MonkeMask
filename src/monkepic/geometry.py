from __future__ import annotations

import math

from .types import Placement


def placement_for(region, monke_w: int, monke_h: int, *, margin: float = 1.0,
                  rotate: bool = True) -> Placement:
    """Build the Placement for a face: head-box center, monke size that covers it,
    and the head-tilt roll. The single source of truth for face→monke geometry,
    used by both the CLI pipeline and the web service."""
    cx, cy, bw, bh = head_box(region.x, region.y, region.w, region.h, margin)
    tw, th = monke_target_size(bw, bh, monke_w, monke_h)
    roll = eye_roll(region.left_eye, region.right_eye) if rotate else 0.0
    return Placement(cx, cy, tw, th, roll)


def roll_degrees(left_eye: tuple[float, float], right_eye: tuple[float, float]) -> float:
    """Angle (degrees) of the eye line vs horizontal, where ``left_eye`` is the
    left-most point in the image. 0 = level, +ve = right point lower."""
    dx = right_eye[0] - left_eye[0]
    dy = right_eye[1] - left_eye[1]
    return math.degrees(math.atan2(dy, dx))


def eye_roll(eye_a: tuple[float, float], eye_b: tuple[float, float]) -> float:
    """Head-tilt roll from two eye points, independent of which one is the subject's
    left/right eye. Orders the points by image-x first, so an upright face yields
    ~0 (not 180). Assumes the head tilt is under 90 degrees."""
    left, right = sorted((eye_a, eye_b), key=lambda p: p[0])
    return roll_degrees(left, right)


def head_box(
    x: int, y: int, w: int, h: int, margin: float = 0.4
) -> tuple[float, float, float, float]:
    """Expand a face bbox around its center by ``margin`` to cover the whole head.

    Returns ``(center_x, center_y, width, height)``.
    """
    cx = x + w / 2
    cy = y + h / 2
    return cx, cy, w * (1 + margin), h * (1 + margin)


def monke_target_size(
    box_w: float, box_h: float, monke_w: int, monke_h: int
) -> tuple[int, int]:
    """Size the monke to fully COVER the box while preserving its aspect ratio."""
    scale = max(box_w / monke_w, box_h / monke_h)
    return round(monke_w * scale), round(monke_h * scale)


def iou(
    box_a: tuple[float, float, float, float],
    box_b: tuple[float, float, float, float],
) -> float:
    """Intersection-over-union of two (x, y, w, h) boxes. 0 = disjoint, 1 = identical."""
    ax, ay, aw, ah = box_a
    bx, by, bw, bh = box_b
    ix = max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0.0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0
