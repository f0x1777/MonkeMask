from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FaceRegion:
    """A detected face: pixel bounding box + eye keypoints."""

    x: int
    y: int
    w: int
    h: int
    left_eye: tuple[float, float]
    right_eye: tuple[float, float]
    confidence: float = 1.0


@dataclass(frozen=True)
class Placement:
    """Where/how to paste a monke: center, target size, roll in degrees."""

    cx: float
    cy: float
    w: int
    h: int
    roll_deg: float
