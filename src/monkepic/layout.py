from __future__ import annotations

from .types import Placement

# When two faces are close, their monkes (≈2× the face) overlap. This module nudges
# the monkes apart, and—only if they still overlap too much—shrinks them, never
# below the size needed to keep covering their own face. Pure geometry; the overlap
# math uses each monke's axis-aligned w×h box (rotation, usually small, is ignored).

Box = list  # [cx, cy, w, h]
Face = tuple  # (x, y, w, h) of the detected face that must stay covered


def _aabb(b: Box) -> tuple[float, float, float, float]:
    cx, cy, w, h = b
    return cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2


def _penetration(b1: Box, b2: Box) -> tuple[float, float]:
    l1, t1, r1, bo1 = _aabb(b1)
    l2, t2, r2, bo2 = _aabb(b2)
    return min(r1, r2) - max(l1, l2), min(bo1, bo2) - max(t1, t2)


def overlap_ratio(b1: Box, b2: Box) -> float:
    """Overlap area as a fraction of the smaller box. 0 = disjoint, 1 = contained."""
    ox, oy = _penetration(b1, b2)
    if ox <= 0 or oy <= 0:
        return 0.0
    return (ox * oy) / min(b1[2] * b1[3], b2[2] * b2[3])


def _worst_ratio(boxes: list[Box]) -> float:
    worst = 0.0
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            worst = max(worst, overlap_ratio(boxes[i], boxes[j]))
    return worst


def _clamp_to_cover(b: Box, face: Face) -> None:
    """Keep the monke box fully covering its face: bound its center so the face box
    never pokes outside the (possibly shrunk) monke box."""
    fx, fy, fw, fh = face
    fcx, fcy = fx + fw / 2, fy + fh / 2
    mx = max(0.0, (b[2] - fw) / 2)
    my = max(0.0, (b[3] - fh) / 2)
    b[0] = min(max(b[0], fcx - mx), fcx + mx)
    b[1] = min(max(b[1], fcy - my), fcy + my)


def _push_round(boxes: list[Box], faces: list[Face], max_overlap: float) -> bool:
    """One relaxation pass: push overlapping pairs apart along their least-penetrating
    axis, then re-clamp each to keep covering its face. Returns True if anything moved."""
    moved = False
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            if overlap_ratio(boxes[i], boxes[j]) <= max_overlap:
                continue
            ox, oy = _penetration(boxes[i], boxes[j])
            if ox <= 0 or oy <= 0:
                continue
            if ox < oy:  # separate horizontally (least penetration)
                s = ox / 2 + 1
                lo, hi = (i, j) if boxes[i][0] <= boxes[j][0] else (j, i)
                boxes[lo][0] -= s
                boxes[hi][0] += s
            else:  # separate vertically
                s = oy / 2 + 1
                lo, hi = (i, j) if boxes[i][1] <= boxes[j][1] else (j, i)
                boxes[lo][1] -= s
                boxes[hi][1] += s
            _clamp_to_cover(boxes[i], faces[i])
            _clamp_to_cover(boxes[j], faces[j])
            moved = True
    return moved


def _shrink_round(boxes: list[Box], faces: list[Face], factor: float) -> bool:
    """Shrink every box that still overlaps another, toward its face size (the floor).
    Returns True if any box actually shrank."""
    involved: set[int] = set()
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            if overlap_ratio(boxes[i], boxes[j]) > 0:
                involved.update((i, j))
    changed = False
    for i in involved:
        fw, fh = faces[i][2], faces[i][3]
        nw = max(float(fw), boxes[i][2] * factor)
        nh = max(float(fh), boxes[i][3] * factor)
        if (nw, nh) != (boxes[i][2], boxes[i][3]):
            boxes[i][2], boxes[i][3] = nw, nh
            _clamp_to_cover(boxes[i], faces[i])
            changed = True
    return changed


def resolve_overlaps(
    placements: list[Placement],
    faces: list[Face],
    *,
    max_overlap: float = 0.2,
    push_iters: int = 60,
    shrink: bool = False,
    shrink_passes: int = 12,
    shrink_factor: float = 0.92,
) -> list[Placement]:
    """Separate overlapping monke placements by pushing them apart (each kept fully
    covering its own face). Coverage-first by default: monkes are NEVER shrunk, so a
    face is always covered even when faces are very close — residual overlap is
    handled at paint time by drawing front monkes over back ones (see depth_order).
    Pass ``shrink=True`` to also shrink toward face size when pushing can't reach
    ``max_overlap`` (legacy behaviour). Roll is preserved."""
    if len(placements) < 2:
        return list(placements)

    boxes: list[Box] = [[p.cx, p.cy, float(p.w), float(p.h)] for p in placements]
    passes = shrink_passes if shrink else 1
    for _ in range(passes):
        for _ in range(push_iters):
            if not _push_round(boxes, faces, max_overlap):
                break
        if _worst_ratio(boxes) <= max_overlap:
            break
        if not shrink or not _shrink_round(boxes, faces, shrink_factor):
            break

    return [
        Placement(b[0], b[1], max(1, round(b[2])), max(1, round(b[3])), p.roll_deg)
        for b, p in zip(boxes, placements)
    ]


def depth_order(faces: list[Face]) -> list[int]:
    """Return face indices ordered back-to-front for painting. Heuristic for group
    photos: a face that is lower in the frame and larger is nearer the camera, so it
    should be painted last (on top). Sort by (bottom_edge, area) ascending."""
    def key(i: int):
        x, y, w, h = faces[i]
        return (y + h, w * h)

    return sorted(range(len(faces)), key=key)
