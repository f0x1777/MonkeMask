from pathlib import Path

import numpy as np

from monkepic.recognizer import Recognizer
from monkepic.types import PersonEntry


def _person(name, vec):
    v = np.array(vec, dtype=float)
    v = v / np.linalg.norm(v)
    return PersonEntry(name=name, monke_path=Path(f"{name}.png"),
                       embedding=tuple(v.tolist()), n_refs=1)


def _norm(vec):
    v = np.array(vec, dtype=float)
    return v / np.linalg.norm(v)


GALLERY = [_person("nico", [1, 0, 0]), _person("jero", [0, 1, 0])]
GENERIC = Path("MonkeDAO_DAOJones.png")


def test_match_returns_person_above_threshold():
    rec = Recognizer(GALLERY, GENERIC, threshold=0.5)
    res = rec.match(_norm([0.9, 0.1, 0.0]))
    assert res.person == "nico"
    assert res.is_generic is False
    assert res.monke_path == Path("nico.png")
    assert res.similarity > 0.5


def test_match_falls_back_to_generic_below_threshold():
    rec = Recognizer(GALLERY, GENERIC, threshold=0.95)
    res = rec.match(_norm([0.6, 0.55, 0.0]))
    assert res.person is None
    assert res.is_generic is True
    assert res.monke_path == GENERIC


def test_match_empty_gallery_is_generic():
    rec = Recognizer([], GENERIC, threshold=0.5)
    res = rec.match(_norm([1.0, 0.0, 0.0]))
    assert res.is_generic is True
    assert res.person is None
