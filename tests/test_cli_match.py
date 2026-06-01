import numpy as np
from PIL import Image

from monkepic import cli
from monkepic.types import FaceRegion


class FakeDetector:
    def detect(self, image):
        return [FaceRegion(20, 20, 80, 80, (44.0, 52.0), (76.0, 52.0))]


class FakeEmbedder:
    def embed(self, image, region):
        return np.array([1.0, 0.0, 0.0])


def _img(path, rgb=(10, 10, 10), size=(300, 300)):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, rgb).save(path)


def _monke(path, rgb):
    arr = np.full((40, 40, 3), 255, dtype=np.uint8)
    arr[10:30, 10:30] = rgb
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr, "RGB").save(path)


def test_cli_match_assigns_person_monke(tmp_path):
    src = tmp_path / "in.png"
    _img(src)
    # OurMonke layout: one enrolled person with a face photo
    nico = tmp_path / "OurMonke" / "01 - Nico"
    _monke(nico / "Nico - SMB #1.png", [255, 0, 0])
    _img(nico / "face_a.png", size=(50, 50))
    generic = tmp_path / "MonkeDAO_DAOJones.png"
    _monke(generic, [0, 0, 255])

    rc = cli.main(
        ["--match", "--ourmonke", str(tmp_path / "OurMonke"),
         "--generic-monke", str(generic), "--out", str(tmp_path / "out"),
         "--recognition-threshold", "0.5", str(src)],
        detector=FakeDetector(), embedder=FakeEmbedder(),
    )
    assert rc == 0
    out = tmp_path / "out" / "in-monked.png"
    assert out.exists()
    arr = np.array(Image.open(out).convert("RGB"))
    assert arr[60, 60, 0] > 100  # nico's red monke applied


def test_cli_without_match_is_phase1(tmp_path):
    src = tmp_path / "in.png"
    _img(src)
    pool = tmp_path / "monkes"
    _monke(pool / "m.png", [0, 255, 0])
    rc = cli.main(
        ["--monkes", str(pool), "--out", str(tmp_path / "out"), str(src)],
        detector=FakeDetector(),
    )
    assert rc == 0
    assert (tmp_path / "out" / "in-monked.png").exists()
