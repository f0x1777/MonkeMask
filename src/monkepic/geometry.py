from __future__ import annotations

import math


def roll_degrees(left_eye: tuple[float, float], right_eye: tuple[float, float]) -> float:
    """Angle (degrees) of the eye line vs horizontal. 0 = level, +ve = right eye lower."""
    dx = right_eye[0] - left_eye[0]
    dy = right_eye[1] - left_eye[1]
    return math.degrees(math.atan2(dy, dx))


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
