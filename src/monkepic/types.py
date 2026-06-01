from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


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


@dataclass(frozen=True)
class PersonEntry:
    """An enrolled person: their name, their monke image, and the averaged
    face embedding built from their reference photos."""

    name: str
    monke_path: Path
    embedding: "tuple[float, ...] | None"
    n_refs: int


@dataclass(frozen=True)
class MatchResult:
    """The outcome of matching one face: who it is (or None), the similarity, the
    monke to paste, and whether we fell back to the generic monke."""

    person: str | None
    similarity: float
    monke_path: Path
    is_generic: bool
