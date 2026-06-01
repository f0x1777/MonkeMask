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


class VecEmbedder:
    """Embeds a face to a fixed unit vector keyed by the face's x position."""

    def __init__(self, mapping):
        # mapping: x -> 3-vector
        self._m = mapping

    def embed(self, image, region):
        v = np.array(self._m.get(region.x, [0.0, 0.0, 1.0]), dtype=float)
        return v / np.linalg.norm(v)


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


def test_enroll_person_averages_usable_refs(tmp_path):
    photo = _save_photo(tmp_path)  # reuse as a stand-in reference face image
    det = FakeDetector([_region(10, 10, 40)])
    emb = VecEmbedder({10: [1.0, 0.0, 0.0]})
    vec, usable = service.enroll_person([photo, photo], emb, det)
    assert usable == 2
    assert vec is not None
    assert abs(np.linalg.norm(np.array(vec)) - 1.0) < 1e-6


def test_enroll_person_no_usable_faces(tmp_path):
    photo = _save_photo(tmp_path)
    det = FakeDetector([])  # no face detected in references
    emb = VecEmbedder({})
    vec, usable = service.enroll_person([photo], emb, det)
    assert vec is None and usable == 0


def test_suggest_matches_and_unmatched(tmp_path):
    photo = _save_photo(tmp_path)
    # face at x=20 -> nico-ish vector; face at x=200 -> unrelated vector
    det = FakeDetector([_region(20, 20, 80), _region(200, 20, 80)])
    emb = VecEmbedder({20: [1.0, 0.0, 0.0], 200: [0.0, 0.0, 1.0]})
    nico_vec = tuple((np.array([1.0, 0.0, 0.0])).tolist())
    people = [{"person_id": "p1", "monke_id": "m0.png", "embedding": nico_vec}]
    suggestions, unmatched = service.suggest(photo, people, emb, det, threshold=0.5)
    assert suggestions == [
        {"face_index": 0, "person_id": "p1", "monke_id": "m0.png", "similarity": 1.0}
    ]
    assert unmatched == [1]


def test_suggest_no_people_all_unmatched(tmp_path):
    photo = _save_photo(tmp_path)
    det = FakeDetector([_region(20, 20, 80), _region(200, 20, 80)])
    emb = VecEmbedder({})
    suggestions, unmatched = service.suggest(photo, [], emb, det)
    assert suggestions == []
    assert unmatched == [0, 1]
