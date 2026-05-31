import numpy as np
from PIL import Image

from monkepic.compositor import composite
from monkepic.types import Placement


def _red_square(size):
    return Image.fromarray(
        np.dstack(
            [
                np.full((size, size), 255, np.uint8),
                np.zeros((size, size), np.uint8),
                np.zeros((size, size), np.uint8),
                np.full((size, size), 255, np.uint8),
            ]
        ).astype(np.uint8),
        "RGBA",
    )


def test_composite_places_monke_at_center():
    base = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    monke = _red_square(40)
    out = composite(base, monke, Placement(cx=100, cy=100, w=40, h=40, roll_deg=0))
    arr = np.array(out)
    assert tuple(arr[100, 100]) == (255, 0, 0, 255)  # center red
    assert arr[0, 0, 3] == 0  # corner untouched


def test_composite_returns_rgba():
    base = Image.new("RGB", (50, 50), (255, 255, 255))
    out = composite(base, _red_square(10), Placement(25, 25, 10, 10, 0))
    assert out.mode == "RGBA"
