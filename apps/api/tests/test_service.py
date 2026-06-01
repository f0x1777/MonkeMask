import io

import numpy as np
from PIL import Image

from apps.api import service
from monkepic import geometry
from monkepic.types import FaceRegion


def _region(x, y, s):
    return FaceRegion(x, y, s, s, (x + s * 0.3, y + s * 0.4), (x + s * 0.7, y + s * 0.4))


def _save_photo(tmp_path):
    p = tmp_path / "photo.png"
    Image.new("RGB", (300, 300), (10, 10, 10)).save(p)
    return p


def _save_monke(tmp_path, name, rgb):
    arr = np.full((40, 40, 3), 255, dtype=np.uint8)  # white bg -> solid cutout
    arr[10:30, 10:30] = rgb
    p = tmp_path / name
    Image.fromarray(arr, "RGB").save(p)
    return p


class FakeDetector:
    def __init__(self, regions):
        self._r = regions

    def detect(self, image):
        return self._r


def test_detect_faces_returns_thumb_per_face(tmp_path):
    photo = _save_photo(tmp_path)
    det = FakeDetector([_region(20, 20, 80), _region(180, 180, 80)])
    out = service.detect_faces(photo, det)
    assert len(out) == 2
    for region, thumb in out:
        assert thumb.startswith("data:image/png;base64,")


def test_placement_matches_cli_geometry(tmp_path):
    region = _region(50, 60, 100)
    monke = Image.new("RGBA", (40, 40))
    pl = service.placement_for(region, monke, margin=1.0, rotate=True)
    cx, cy, bw, bh = geometry.head_box(region.x, region.y, region.w, region.h, 1.0)
    tw, th = geometry.monke_target_size(bw, bh, monke.width, monke.height)
    roll = geometry.eye_roll(region.left_eye, region.right_eye)
    assert (pl.cx, pl.cy, pl.w, pl.h, pl.roll_deg) == (cx, cy, tw, th, roll)


def test_compose_covers_assigned_face_only(tmp_path):
    photo = _save_photo(tmp_path)
    green = _save_monke(tmp_path, "g.png", [0, 255, 0])
    covered = _region(20, 20, 80)
    png = service.compose(photo, [(covered, green)])
    arr = np.array(Image.open(__import__("io").BytesIO(png)).convert("RGB"))
    assert arr[60, 60, 1] > 100  # covered face center is green
    assert arr[220, 220, 1] < 80  # uncovered face stays dark


def test_compose_applies_manual_offset(tmp_path):
    # A single face (no auto-overlap nudge); a manual offset shifts the monke.
    photo = _save_photo(tmp_path)
    green = _save_monke(tmp_path, "g.png", [0, 255, 0])
    face = _region(40, 40, 40)  # head-box center ~ (60,60), monke ~80x80
    base = service.placement_for(face, Image.open(green))
    png = service.compose(photo, [(face, green)], offsets=[(80.0, 0.0)])
    arr = np.array(Image.open(__import__("io").BytesIO(png)).convert("RGB"))
    # monke center moved +80px in x -> green now present well to the right of base
    shifted_x = int(base.cx + 80)
    assert arr[int(base.cy), shifted_x, 1] > 100


def test_compose_applies_manual_rotation(tmp_path):
    # An asymmetric monke: green top half, red bottom half, fully opaque (alpha tier,
    # so it passes through background removal unchanged). A 180° rotation swaps them.
    photo = _save_photo(tmp_path)
    arr = np.zeros((40, 40, 4), np.uint8)
    arr[:20, :] = [0, 255, 0, 255]  # top: green
    arr[20:, :] = [255, 0, 0, 255]  # bottom: red
    monke = tmp_path / "tb.png"
    Image.fromarray(arr, "RGBA").save(monke)
    face = _region(80, 80, 40)  # level eyes -> base roll ~0
    base = service.placement_for(face, Image.open(monke))
    above = (int(base.cy - base.h * 0.3), int(base.cx))  # a point in the top half

    up = np.array(Image.open(io.BytesIO(
        service.compose(photo, [(face, monke)], offsets=[(0.0, 0.0, 1.0, 0.0)])
    )).convert("RGB"))
    down = np.array(Image.open(io.BytesIO(
        service.compose(photo, [(face, monke)], offsets=[(0.0, 0.0, 1.0, 180.0)])
    )).convert("RGB"))
    assert up[above][1] > 150 and up[above][0] < 100  # top is green at rot=0
    assert down[above][0] > 150 and down[above][1] < 100  # top is red at rot=180


def test_layout_returns_placements_and_cutouts(tmp_path):
    photo = _save_photo(tmp_path)
    green = _save_monke(tmp_path, "g.png", [0, 255, 0])
    red = _save_monke(tmp_path, "r.png", [255, 0, 0])
    # two faces: a small high one and a big low one (low+big paints on top -> z higher)
    high = _region(40, 30, 40)
    low = _region(180, 200, 80)
    w, h, items = service.layout(photo, [(high, green), (low, red)])
    assert (w, h) == (300, 300)
    assert len(items) == 2
    for it in items:
        assert it["monke"].startswith("data:image/png;base64,")
        for k in ("cx", "cy", "w", "h", "roll_deg", "z"):
            assert k in it
    # placements match the shared geometry (same as compose), before any offset
    base_high = service.placement_for(high, Image.open(green))
    assert items[0]["cx"] == base_high.cx and items[0]["cy"] == base_high.cy
    # the lower+bigger face paints last -> strictly higher z than the upper one
    assert items[1]["z"] > items[0]["z"]


def test_rotate_photo_swaps_dimensions(tmp_path):
    p = tmp_path / "photo"
    Image.new("RGB", (200, 100), (10, 20, 30)).save(p, format="PNG")
    service.rotate_photo(p, 90)
    from PIL import Image as PILImage
    assert PILImage.open(p).size == (100, 200)  # 90° swaps W/H


def test_compose_scale_enlarges_monke(tmp_path):
    photo = _save_photo(tmp_path)
    green = _save_monke(tmp_path, "g.png", [0, 255, 0])
    face = _region(120, 120, 40)
    small = service.compose(photo, [(face, green)], offsets=[(0.0, 0.0, 1.0)])
    big = service.compose(photo, [(face, green)], offsets=[(0.0, 0.0, 2.0)])
    import numpy as _np
    from PIL import Image as _Img
    import io as _io
    a_small = _np.array(_Img.open(_io.BytesIO(small)).convert("RGB"))
    a_big = _np.array(_Img.open(_io.BytesIO(big)).convert("RGB"))
    green_small = ((a_small[:, :, 1] > 150) & (a_small[:, :, 0] < 100)).sum()
    green_big = ((a_big[:, :, 1] > 150) & (a_big[:, :, 0] < 100)).sum()
    assert green_big > green_small  # 2x scale -> more green pixels
