import math

from monkepic.geometry import (
    eye_roll,
    head_box,
    iou,
    monke_target_size,
    roll_degrees,
)


def test_level_eyes_zero_roll():
    assert roll_degrees((0.0, 0.0), (10.0, 0.0)) == 0.0


def test_tilted_eyes_positive_roll():
    assert math.isclose(roll_degrees((0.0, 0.0), (10.0, 10.0)), 45.0)


def test_tilted_eyes_negative_roll():
    assert math.isclose(roll_degrees((0.0, 0.0), (10.0, -10.0)), -45.0)


def test_eye_roll_upright_when_eyes_swapped():
    # subject-left eye is at larger image-x than subject-right eye -> still upright
    assert eye_roll((10.0, 0.0), (0.0, 0.0)) == 0.0


def test_eye_roll_is_order_independent():
    assert math.isclose(eye_roll((0.0, 0.0), (10.0, 10.0)), 45.0)
    assert math.isclose(eye_roll((10.0, 10.0), (0.0, 0.0)), 45.0)


def test_head_box_expands_around_center():
    cx, cy, w, h = head_box(10, 20, 100, 100, margin=0.4)
    assert (cx, cy) == (60.0, 70.0)
    assert (w, h) == (140.0, 140.0)


def test_target_size_square_cover():
    assert monke_target_size(140, 140, 100, 100) == (140, 140)


def test_target_size_preserves_aspect_and_covers():
    assert monke_target_size(140, 140, 200, 100) == (280, 140)


def test_iou_identical_is_one():
    assert iou((0, 0, 10, 10), (0, 0, 10, 10)) == 1.0


def test_iou_disjoint_is_zero():
    assert iou((0, 0, 10, 10), (100, 100, 10, 10)) == 0.0


def test_iou_half_overlap():
    # two 10x10 boxes overlapping in a 5x10 strip: inter=50, union=150
    assert math.isclose(iou((0, 0, 10, 10), (5, 0, 10, 10)), 50 / 150)
