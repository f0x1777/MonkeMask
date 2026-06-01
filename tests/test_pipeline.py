import numpy as np
from PIL import Image

from monkepic.pipeline import process_image
from monkepic.types import FaceRegion


class FakeDetector:
    def __init__(self, regions):
        self._regions = regions

    def detect(self, image):
        return self._regions


def _make_monke_pool(tmp_path, n):
    pool = tmp_path / "monkes"
    pool.mkdir()
    for i in range(n):
        arr = np.full((40, 40, 3), 255, dtype=np.uint8)  # white bg
        arr[10:30, 10:30] = [0, 255, 0]  # green center
        Image.fromarray(arr, "RGB").save(pool / f"m{i}.png")
    return pool


def _region(x, y, s):
    return FaceRegion(x, y, s, s, (x + s * 0.3, y + s * 0.4), (x + s * 0.7, y + s * 0.4))


def test_covers_all_faces(tmp_path):
    src = tmp_path / "in.png"
    Image.new("RGB", (300, 300), (10, 10, 10)).save(src)
    pool = _make_monke_pool(tmp_path, 3)
    out_dir = tmp_path / "out"
    det = FakeDetector([_region(20, 20, 60), _region(150, 60, 60), _region(60, 180, 60)])

    out = process_image(src, pool, out_dir, det, seed=1)

    assert out.exists()
    arr = np.array(Image.open(out).convert("RGBA"))
    for x, y, s in [(20, 20, 60), (150, 60, 60), (60, 180, 60)]:
        cx, cy = x + s // 2, y + s // 2
        assert arr[cy, cx, 1] > 100  # green channel raised


def test_default_output_next_to_input(tmp_path):
    photos = tmp_path / "photos"
    photos.mkdir()
    src = photos / "in.png"
    Image.new("RGB", (300, 300), (10, 10, 10)).save(src)
    pool = _make_monke_pool(tmp_path, 2)
    out = process_image(src, pool, None, FakeDetector([_region(20, 20, 60)]), seed=1)
    assert out.parent == photos  # written next to the input, not in output/
    assert out.name == "in-monked.png"
    assert out.exists()


def test_no_faces_copies_original(tmp_path):
    src = tmp_path / "in.png"
    Image.new("RGB", (40, 40), (123, 50, 7)).save(src)
    pool = _make_monke_pool(tmp_path, 1)
    out = process_image(src, pool, tmp_path / "out", FakeDetector([]), seed=1)
    assert np.array_equal(
        np.array(Image.open(out).convert("RGB")),
        np.array(Image.open(src).convert("RGB")),
    )


def test_export_crops_writes_inbox(tmp_path):
    src = tmp_path / "in.png"
    Image.new("RGB", (300, 300), (10, 10, 10)).save(src)
    pool = _make_monke_pool(tmp_path, 2)
    faces_dir = tmp_path / "faces_inbox"
    process_image(
        src,
        pool,
        tmp_path / "out",
        FakeDetector([_region(20, 20, 60), _region(150, 150, 60)]),
        seed=1,
        crops_dir=faces_dir,
    )
    assert len(list(faces_dir.glob("in__face_*.png"))) == 2
