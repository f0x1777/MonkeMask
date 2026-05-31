from __future__ import annotations

import math


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
