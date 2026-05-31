from monkepic.selector import MonkeSelector


def test_no_repeat_within_photo_when_pool_big_enough():
    sel = MonkeSelector(["a", "b", "c", "d"], seed=42)
    picks = sel.assign(3)
    assert len(picks) == 3
    assert len(set(picks)) == 3  # no repeats


def test_deterministic_with_seed():
    a = MonkeSelector(["a", "b", "c", "d"], seed=7).assign(3)
    b = MonkeSelector(["a", "b", "c", "d"], seed=7).assign(3)
    assert a == b


def test_falls_back_to_repeats_when_pool_too_small():
    sel = MonkeSelector(["a", "b"], seed=1)
    picks = sel.assign(5)
    assert len(picks) == 5
    assert set(picks) <= {"a", "b"}
    assert sel.repeated is True
