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


def test_ensure_transparent_gradient_uses_border_flood(gradient_bg_monke):
    # Gradient background -> border-flood tier (NOT rembg). The pure gradient has no
    # opaque subject, so the flood removes (nearly) everything; the point is that
    # rembg is NOT invoked for plain gradients.
    called = {"n": 0}

    def fake_rembg(image):
        called["n"] += 1
        return image.convert("RGBA")

    ensure_transparent(gradient_bg_monke, rembg_fn=fake_rembg)
    assert called["n"] == 0  # border-flood handles gradients; rembg untouched


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


def test_border_flood_cutout_removes_gradient_border():
    from monkepic.background import border_flood_cutout

    # gradient background (smooth top->bottom) with an opaque dark block in center.
    arr = np.zeros((60, 60, 3), dtype=np.uint8)
    for y in range(60):
        arr[y, :] = [y * 3, 40, 200 - y * 2]  # vertical gradient
    arr[20:40, 20:40] = [10, 10, 10]  # the "monke": a dark block
    img = Image.fromarray(arr, "RGB")
    out = border_flood_cutout(img, tol=42)
    a = np.array(out)
    assert out.mode == "RGBA"
    assert a[0, 0, 3] == 0  # gradient corner removed
    assert a[30, 30, 3] == 255  # dark center kept


def test_combine_with_silhouette_rescues_and_clips():
    from monkepic.background import combine_with_silhouette

    # An RGBA where flood wrongly removed part of the subject (alpha 0 in center),
    # plus leftover bg in a far corner.
    arr = np.zeros((40, 40, 4), dtype=np.uint8)
    arr[10:30, 10:30] = [200, 50, 50, 255]  # subject, opaque
    arr[15:25, 15:25, 3] = 0  # a hole the flood ate
    arr[0:4, 0:4] = [9, 9, 9, 255]  # leftover bg in corner (opaque)
    img = Image.fromarray(arr, "RGBA")

    # core silhouette = the subject area; far = slightly larger
    core = np.zeros((40, 40), bool)
    core[12:28, 12:28] = True
    far = np.zeros((40, 40), bool)
    far[8:32, 8:32] = True

    out = np.array(combine_with_silhouette(img, core, far))
    assert out[20, 20, 3] == 255  # hole rescued by core
    assert out[1, 1, 3] == 0  # leftover corner clipped (outside far)
