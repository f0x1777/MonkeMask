import numpy as np
from PIL import Image

from monkepic.pipeline import process_image
from monkepic.types import FaceRegion


class FakeDetector:
    def __init__(self, regions):
        self._r = regions

    def detect(self, image):
        return self._r


def _monke(tmp_path, name, rgb):
    arr = np.full((40, 40, 3), 255, dtype=np.uint8)
    arr[10:30, 10:30] = rgb
    p = tmp_path / name
    Image.fromarray(arr, "RGB").save(p)
    return p


def _region(x, y, s):
    return FaceRegion(x, y, s, s, (x + s * 0.3, y + s * 0.4), (x + s * 0.7, y + s * 0.4))


def test_choose_monke_callback_controls_assignment(tmp_path):
    src = tmp_path / "in.png"
    Image.new("RGB", (300, 300), (10, 10, 10)).save(src)
    red = _monke(tmp_path, "red.png", [255, 0, 0])
    blue = _monke(tmp_path, "blue.png", [0, 0, 255])
    regions = [_region(20, 20, 60), _region(170, 170, 60)]

    # first face -> red, second -> blue
    def choose(rs):
        return [red, blue]

    out = process_image(src, None, tmp_path / "out", FakeDetector(regions),
                        choose_monke=choose)
    arr = np.array(Image.open(out).convert("RGB"))
    assert arr[50, 50, 0] > 100 and arr[50, 50, 2] < 100   # face 0 reddish
    assert arr[200, 200, 2] > 100 and arr[200, 200, 0] < 100  # face 1 bluish
