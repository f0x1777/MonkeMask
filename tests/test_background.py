import numpy as np
from PIL import Image

from monkepic.background import (
    ensure_transparent,
    has_alpha,
    is_solid_background,
    select_tier,
    solid_cutout,
)


def test_has_alpha_true(alpha_monke):
    assert has_alpha(alpha_monke) is True


def test_has_alpha_false(solid_bg_monke):
    assert has_alpha(solid_bg_monke) is False


def test_solid_background_detected(solid_bg_monke):
    assert is_solid_background(solid_bg_monke) is True


def test_gradient_not_solid(gradient_bg_monke):
    assert is_solid_background(gradient_bg_monke) is False


def test_select_tier_alpha(alpha_monke):
    assert select_tier(alpha_monke) == "alpha"


def test_select_tier_solid(solid_bg_monke):
    assert select_tier(solid_bg_monke) == "solid"


def test_select_tier_ml(gradient_bg_monke):
    assert select_tier(gradient_bg_monke) == "ml"


def test_solid_cutout_makes_corners_transparent(solid_bg_monke):
    out = solid_cutout(solid_bg_monke)
    arr = np.array(out)
    assert out.mode == "RGBA"
    assert arr[0, 0, 3] == 0  # corner transparent
    assert arr[50, 50, 3] == 255  # red center kept


def test_ensure_transparent_passes_through_alpha(alpha_monke):
    # alpha_monke is 50x50 with a 30x30 opaque square (rows/cols 10:40).
    # The alpha tier is preserved, then the result is trimmed to the opaque box.
    out = ensure_transparent(alpha_monke)
    assert out.mode == "RGBA"
    assert out.size == (30, 30)
    assert (np.array(out)[:, :, 3] > 0).all()  # no transparent padding remains


def test_ensure_transparent_uses_ml_fallback(gradient_bg_monke):
    # A fully-opaque RGBA result: ml tier is used and trim is a no-op (full bbox).
    sentinel = gradient_bg_monke.convert("RGBA")
    called = {"n": 0}

    def fake_rembg(image):
        called["n"] += 1
        return sentinel

    out = ensure_transparent(gradient_bg_monke, rembg_fn=fake_rembg)
    assert called["n"] == 1
    assert out.size == sentinel.size  # fully opaque -> trim changes nothing
    assert np.array_equal(np.array(out), np.array(sentinel))


def test_trim_transparent_removes_padding():
    from monkepic.background import trim_transparent

    # 100x100 with a 40x40 opaque square offset toward bottom-right.
    arr = np.zeros((100, 100, 4), dtype=np.uint8)
    arr[50:90, 40:80] = [10, 200, 30, 255]
    img = Image.fromarray(arr, "RGBA")
    out = trim_transparent(img)
    assert out.size == (40, 40)  # cropped to opaque bbox
    a = np.array(out)
    assert (a[:, :, 3] > 0).all()  # no transparent border left


def test_trim_transparent_noop_when_full():
    from monkepic.background import trim_transparent

    arr = np.full((20, 20, 4), 255, dtype=np.uint8)
    img = Image.fromarray(arr, "RGBA")
    assert trim_transparent(img).size == (20, 20)


def test_ensure_transparent_trims_alpha_padding():
    from monkepic.background import ensure_transparent

    # already-alpha image with big transparent top padding (the SMB-monke shape)
    arr = np.zeros((100, 80, 4), dtype=np.uint8)
    arr[30:100, 10:70] = [0, 0, 255, 255]
    img = Image.fromarray(arr, "RGBA")
    out = ensure_transparent(img)
    # opaque content is 70 tall x 60 wide -> output must equal that, no padding
    assert out.size == (60, 70)
