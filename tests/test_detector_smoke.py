from pathlib import Path

import pytest

from monkepic.loader import load_image

SAMPLE = Path("Photos/Event-MiniGolf-24-04-2026/raw-pic.jpg")


@pytest.mark.smoke
@pytest.mark.skipif(not SAMPLE.exists(), reason="sample photo not present")
def test_detects_at_least_one_face():
    pytest.importorskip("cv2")
    from monkepic.detector import FaceDetector

    regions = FaceDetector().detect(load_image(SAMPLE))
    # Multi-scale union finds 12 faces in this hard low-light group photo (a single
    # resolution finds only 11-12). Not every face is guaranteed on difficult
    # photos; this guards against regressions in the multi-scale union.
    assert len(regions) >= 12
    r = regions[0]
    assert r.w > 0 and r.h > 0
    assert r.left_eye != r.right_eye
