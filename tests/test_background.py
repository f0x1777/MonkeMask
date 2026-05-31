import numpy as np

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
    out = ensure_transparent(alpha_monke)
    assert out.mode == "RGBA"
    assert np.array_equal(np.array(out), np.array(alpha_monke))


def test_ensure_transparent_uses_ml_fallback(gradient_bg_monke):
    sentinel = gradient_bg_monke.convert("RGBA")
    called = {"n": 0}

    def fake_rembg(image):
        called["n"] += 1
        return sentinel

    out = ensure_transparent(gradient_bg_monke, rembg_fn=fake_rembg)
    assert called["n"] == 1
    assert out is sentinel
