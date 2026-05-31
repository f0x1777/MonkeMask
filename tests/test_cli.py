import numpy as np
from PIL import Image

from monkepic import cli
from monkepic.types import FaceRegion


class FakeDetector:
    def detect(self, image):
        w, h = image.size
        s = min(w, h) // 3
        return [FaceRegion(s, s, s, s, (s * 1.3, s * 1.4), (s * 1.7, s * 1.4))]


def _setup(tmp_path):
    pool = tmp_path / "monkes"
    pool.mkdir()
    arr = np.full((40, 40, 3), 255, dtype=np.uint8)
    arr[10:30, 10:30] = [0, 255, 0]
    Image.fromarray(arr, "RGB").save(pool / "m0.png")
    return pool


def test_cli_single_file(tmp_path):
    src = tmp_path / "in.png"
    Image.new("RGB", (300, 300), (10, 10, 10)).save(src)
    pool = _setup(tmp_path)
    out_dir = tmp_path / "out"
    rc = cli.main(
        ["--monkes", str(pool), "--out", str(out_dir), str(src)], detector=FakeDetector()
    )
    assert rc == 0
    assert (out_dir / "in-monked.png").exists()


def test_cli_directory(tmp_path):
    in_dir = tmp_path / "photos"
    in_dir.mkdir()
    for name in ["a.png", "b.png"]:
        Image.new("RGB", (300, 300), (10, 10, 10)).save(in_dir / name)
    pool = _setup(tmp_path)
    out_dir = tmp_path / "out"
    rc = cli.main(
        ["--monkes", str(pool), "--out", str(out_dir), str(in_dir)], detector=FakeDetector()
    )
    assert rc == 0
    assert {p.name for p in out_dir.glob("*-monked.png")} == {
        "a-monked.png",
        "b-monked.png",
    }
