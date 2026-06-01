import numpy as np
from PIL import Image

from monkepic.gallery import build_gallery, load_or_build_gallery, parse_person_folder
from monkepic.types import FaceRegion


def _img(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 8)).save(path)


def test_parse_classifies_smb_as_monke_rest_as_faces(tmp_path):
    d = tmp_path / "01 - Nico"
    _img(d / "Nico - SMB #3053 .png")
    _img(d / "raw-pic__face_3.png")
    _img(d / "selfie.jpg")
    monke, faces = parse_person_folder(d)
    assert monke.name == "Nico - SMB #3053 .png"
    assert {f.name for f in faces} == {"raw-pic__face_3.png", "selfie.jpg"}


def test_parse_no_face_photos(tmp_path):
    d = tmp_path / "02 - SrMessi"
    _img(d / "SrMessi - SMB Gen3 #9566.png")
    monke, faces = parse_person_folder(d)
    assert monke.name == "SrMessi - SMB Gen3 #9566.png"
    assert faces == []


def test_parse_no_monke_returns_none(tmp_path):
    d = tmp_path / "99 - Ghost"
    _img(d / "only_a_face.png")
    monke, faces = parse_person_folder(d)
    assert monke is None
    assert len(faces) == 1


class FakeDetector:
    def detect(self, image):
        return [FaceRegion(0, 0, 8, 8, (0.0, 0.0), (8.0, 0.0))]


class FakeEmbedder:
    """Returns a fixed vector per person based on folder name."""
    def __init__(self):
        self.calls = 0

    def embed(self, image, region):
        self.calls += 1
        return np.array([1.0, 0.0, 0.0])


def test_build_gallery_one_entry_per_enrolled_person(tmp_path):
    nico = tmp_path / "01 - Nico"
    _img(nico / "Nico - SMB #1.png")
    _img(nico / "face_a.png")
    _img(nico / "face_b.png")
    messi = tmp_path / "02 - SrMessi"
    _img(messi / "SrMessi - SMB #2.png")  # monke only, no faces
    potential = tmp_path / "Potential - Turi"
    _img(potential / "Turi - SMB #3.png")
    _img(potential / "face_c.png")

    gallery = build_gallery(tmp_path, FakeEmbedder(), FakeDetector())

    names = {p.name for p in gallery}
    assert names == {"Nico"}              # Messi skipped (no faces), Potential ignored
    entry = gallery[0]
    assert entry.n_refs == 2
    v = np.array(entry.embedding)
    assert np.isclose(np.linalg.norm(v), 1.0)  # normalized


def test_build_gallery_skips_unreadable_face(tmp_path):
    nico = tmp_path / "01 - Nico"
    _img(nico / "Nico - SMB #1.png")
    _img(nico / "face_a.png")

    class OneBadEmbedder(FakeEmbedder):
        def embed(self, image, region):
            super().embed(image, region)
            raise ValueError("no face")

    gallery = build_gallery(tmp_path, OneBadEmbedder(), FakeDetector())
    assert gallery == []  # only face failed -> person not enrolled


def test_build_gallery_warns_on_embed_failure(tmp_path, capsys):
    # A silent enrollment failure once masked a real bug (10/11 people dropped).
    # Embedding failures and "not enrolled" must be reported to stderr.
    nico = tmp_path / "01 - Nico"
    _img(nico / "Nico - SMB #1.png")
    _img(nico / "face_a.png")

    class BadEmbedder(FakeEmbedder):
        def embed(self, image, region):
            raise ValueError("no face found in crop")

    build_gallery(tmp_path, BadEmbedder(), FakeDetector())
    err = capsys.readouterr().err
    assert "face_a.png" in err
    assert "Nico" in err
    assert "not enrolled" in err


def test_cache_reuse_then_rebuild_on_change(tmp_path):
    nico = tmp_path / "01 - Nico"
    _img(nico / "Nico - SMB #1.png")
    _img(nico / "face_a.png")
    cache = tmp_path / ".cache"

    emb1 = FakeEmbedder()
    g1 = load_or_build_gallery(tmp_path, emb1, FakeDetector(), cache_dir=cache)
    assert emb1.calls == 1
    assert {p.name for p in g1} == {"Nico"}

    # second call: cache hit, embedder NOT called again
    emb2 = FakeEmbedder()
    g2 = load_or_build_gallery(tmp_path, emb2, FakeDetector(), cache_dir=cache)
    assert emb2.calls == 0
    assert {p.name for p in g2} == {"Nico"}

    # add a new face -> cache invalidated -> rebuild
    _img(nico / "face_b.png")
    emb3 = FakeEmbedder()
    load_or_build_gallery(tmp_path, emb3, FakeDetector(), cache_dir=cache)
    assert emb3.calls == 2

    # force rebuild ignores cache
    emb4 = FakeEmbedder()
    load_or_build_gallery(tmp_path, emb4, FakeDetector(), cache_dir=cache, rebuild=True)
    assert emb4.calls == 2
