from monkepic.facefilter import filter_background, keep_face
from monkepic.types import FaceRegion


def _region(side):
    return FaceRegion(0, 0, side, side, (0.0, 0.0), (float(side), 0.0))


def test_keep_face_drops_only_when_both_small():
    # small relative AND small absolute -> drop
    assert keep_face(_region(20), median_side=200, min_ratio=0.35, min_px=40) is False
    # small relative but big absolute -> keep
    assert keep_face(_region(60), median_side=200, min_ratio=0.35, min_px=40) is True
    # big relative but small absolute -> keep
    assert keep_face(_region(30), median_side=50, min_ratio=0.35, min_px=40) is True


def test_filter_background_drops_tiny_far_face():
    regions = [_region(200), _region(210), _region(190), _region(20)]
    kept = filter_background(regions)
    assert len(kept) == 3
    assert all(r.w >= 190 for r in kept)


def test_filter_background_keeps_all_when_one_face():
    regions = [_region(15)]  # no median to compare against
    assert filter_background(regions) == regions


def test_filter_background_empty():
    assert filter_background([]) == []
