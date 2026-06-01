import numpy as np
from PIL import Image

from monkepic.matching import process_image_matched
from monkepic.types import FaceRegion, PersonEntry


def _monke(tmp_path, name, rgb):
    arr = np.full((40, 40, 3), 255, dtype=np.uint8)
    arr[10:30, 10:30] = rgb
    p = tmp_path / name
    Image.fromarray(arr, "RGB").save(p)
    return p


def _region(x, y, s):
    return FaceRegion(x, y, s, s, (x + s * 0.3, y + s * 0.4), (x + s * 0.7, y + s * 0.4))


class FakeDetector:
    def __init__(self, regions):
        self._r = regions

    def detect(self, image):
        return self._r


class FakeEmbedder:
    """Maps a face to a vector by its x position: left face -> nico, right -> unknown."""
    def embed(self, image, region):
        return np.array([1.0, 0.0, 0.0]) if region.x < 100 else np.array([0.0, 0.0, 1.0])


def test_recognized_gets_own_monke_unknown_gets_generic(tmp_path):
    src = tmp_path / "in.png"
    Image.new("RGB", (300, 300), (10, 10, 10)).save(src)
    nico_monke = _monke(tmp_path, "nico_red.png", [255, 0, 0])
    generic = _monke(tmp_path, "generic_blue.png", [0, 0, 255])

    nico = PersonEntry("Nico", nico_monke, tuple([1.0, 0.0, 0.0]), 1)
    gallery = [nico]

    regions = [_region(20, 20, 60), _region(200, 20, 60)]  # left known, right unknown

    out = process_image_matched(
        src, gallery, generic, tmp_path / "out", FakeDetector(regions), FakeEmbedder(),
        threshold=0.5,
    )
    arr = np.array(Image.open(out).convert("RGB"))
    # left face -> nico's red monke
    assert arr[50, 50, 0] > 100 and arr[50, 50, 2] < 100
    # right face -> generic blue monke
    assert arr[50, 230, 2] > 100 and arr[50, 230, 0] < 100


def test_background_face_not_covered(tmp_path, monkeypatch):
    # Verify the tiny background face is dropped by the size filter — i.e. it never
    # gets its own monke placement — rather than asserting on a pixel, which is
    # fragile near a neighbouring monke's edge.
    from monkepic import layout

    src = tmp_path / "in.png"
    Image.new("RGB", (300, 300), (10, 10, 10)).save(src)
    generic = _monke(tmp_path, "generic_blue.png", [0, 0, 255])

    seen = {}

    real_resolve = layout.resolve_overlaps

    def spy(placements, faces, **kw):
        seen["n"] = len(placements)
        return real_resolve(placements, faces, **kw)

    monkeypatch.setattr("monkepic.pipeline.resolve_overlaps", spy)

    # two normal faces + one tiny background face (10px among 80px faces)
    regions = [_region(20, 20, 80), _region(180, 20, 80), _region(150, 150, 10)]
    process_image_matched(
        src, [], generic, tmp_path / "out", FakeDetector(regions), FakeEmbedder(),
        threshold=0.5,
    )
    # only the two foreground faces produce a monke; the tiny one is filtered out
    assert seen["n"] == 2


def test_no_faces_copies_through(tmp_path):
    src = tmp_path / "in.png"
    Image.new("RGB", (40, 40), (123, 50, 7)).save(src)
    generic = _monke(tmp_path, "g.png", [0, 0, 255])
    out = process_image_matched(
        src, [], generic, tmp_path / "out", FakeDetector([]), FakeEmbedder(), threshold=0.5,
    )
    assert out.exists()
