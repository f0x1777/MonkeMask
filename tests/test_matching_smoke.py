from pathlib import Path

import pytest

from monkepic.loader import load_image

SAMPLE = Path("Photos/Event-MiniGolf-24-04-2026/raw-pic.jpg")
OURMONKE = Path("OurMonke")
GENERIC = Path("MonkeDAO_DAOJones.png")


@pytest.mark.smoke
@pytest.mark.skipif(
    not (SAMPLE.exists() and OURMONKE.exists() and GENERIC.exists()),
    reason="sample data not present",
)
def test_real_matching_assigns_at_least_one_person(tmp_path):
    pytest.importorskip("insightface")
    pytest.importorskip("cv2")
    from monkepic.detector import FaceDetector
    from monkepic.embedder import FaceEmbedder
    from monkepic.gallery import load_or_build_gallery
    from monkepic.recognizer import Recognizer

    detector = FaceDetector()
    embedder = FaceEmbedder()
    gallery = load_or_build_gallery(
        OURMONKE, embedder, detector, cache_dir=tmp_path / "cache"
    )
    assert len(gallery) >= 1  # at least the enrolled persons

    # At least one detected face in the sample should match an enrolled person.
    image = load_image(SAMPLE)
    regions = detector.detect(image)
    rec = Recognizer(gallery, GENERIC, threshold=0.3)
    matched = 0
    for r in regions:
        try:
            if not rec.match(embedder.embed(image, r)).is_generic:
                matched += 1
        except Exception:
            pass
    assert matched >= 1
