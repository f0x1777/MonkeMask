from monkepic.layout import overlap_ratio, resolve_overlaps
from monkepic.types import Placement


def test_overlap_ratio_disjoint_and_identical():
    a = [0, 0, 10, 10]
    assert overlap_ratio(a, [100, 100, 10, 10]) == 0.0
    assert overlap_ratio(a, [0, 0, 10, 10]) == 1.0


def test_no_change_when_already_separated():
    faces = [(0, 0, 20, 20), (200, 0, 20, 20)]
    pls = [Placement(10, 10, 40, 40, 0), Placement(210, 10, 40, 40, 0)]
    out = resolve_overlaps(pls, faces)
    assert out == pls  # nothing to do


def test_single_placement_untouched():
    pls = [Placement(10, 10, 40, 40, 5)]
    assert resolve_overlaps(pls, [(0, 0, 20, 20)]) == pls


def _box(p):
    return [p.cx, p.cy, float(p.w), float(p.h)]


def test_overlapping_monkes_are_pushed_apart():
    # Two faces close together; monkes 2x the face overlap heavily.
    faces = [(40, 40, 40, 40), (80, 40, 40, 40)]  # centers 40px apart, 40px wide
    pls = [Placement(60, 60, 80, 80, 0), Placement(100, 60, 80, 80, 0)]
    before = overlap_ratio(_box(pls[0]), _box(pls[1]))
    out = resolve_overlaps(pls, faces, max_overlap=0.2)
    after = overlap_ratio(_box(out[0]), _box(out[1]))
    assert before > 0.2
    assert after <= 0.2 + 1e-6
    # left monke moved left, right monke moved right (or shrank) — centers spread
    assert out[0].cx <= pls[0].cx
    assert out[1].cx >= pls[1].cx


def test_each_monke_still_covers_its_face():
    faces = [(40, 40, 40, 40), (80, 40, 40, 40)]
    pls = [Placement(60, 60, 80, 80, 0), Placement(100, 60, 80, 80, 0)]
    out = resolve_overlaps(pls, faces, max_overlap=0.2)
    for p, (fx, fy, fw, fh) in zip(out, faces):
        # face box must be inside the monke box
        assert p.cx - p.w / 2 <= fx and p.cx + p.w / 2 >= fx + fw
        assert p.cy - p.h / 2 <= fy and p.cy + p.h / 2 >= fy + fh


def test_very_close_faces_trigger_shrink():
    # Faces almost on top of each other -> pushing alone can't fix it -> shrink.
    # Shrinking is opt-in now (coverage-first is the default); pass shrink=True.
    faces = [(48, 40, 40, 40), (52, 40, 40, 40)]  # centers only 4px apart
    pls = [Placement(68, 60, 80, 80, 0), Placement(72, 60, 80, 80, 0)]
    out = resolve_overlaps(pls, faces, max_overlap=0.3, shrink=True)
    # at least one monke shrank below the original 80 to reduce overlap
    assert min(out[0].w, out[1].w) < 80
    # but never below the face size (still covers)
    assert out[0].w >= 40 and out[1].w >= 40


def test_coverage_first_never_shrinks_below_face():
    # Two faces 40px apart, monkes 80px: must stay >= face size and keep covering.
    from monkepic.layout import resolve_overlaps as ro
    faces = [(40, 40, 40, 40), (80, 40, 40, 40)]
    pls = [Placement(60, 60, 80, 80, 0), Placement(100, 60, 80, 80, 0)]
    out = ro(pls, faces)  # coverage-first by default
    for p, (fx, fy, fw, fh) in zip(out, faces):
        # monke still fully covers its face box
        assert p.cx - p.w / 2 <= fx and p.cx + p.w / 2 >= fx + fw
        assert p.cy - p.h / 2 <= fy and p.cy + p.h / 2 >= fy + fh
        # and it was not shrunk below the original size
        assert p.w >= 80 and p.h >= 80


def test_depth_order_back_to_front():
    from monkepic.layout import depth_order
    # face A small/high (back), face B large/low (front)
    faces = [(0, 0, 40, 40), (0, 200, 120, 120)]
    order = depth_order(faces)
    assert order == [0, 1]  # back (small/high) first, front (large/low) last
    # reversed input -> same back-to-front result
    assert depth_order([faces[1], faces[0]]) == [1, 0]
