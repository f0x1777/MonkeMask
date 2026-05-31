from PIL import Image

from monkepic.crops import export_crops
from monkepic.types import FaceRegion


def _region(x, y, s):
    return FaceRegion(
        x, y, s, s, left_eye=(x + s * 0.3, y + s * 0.4), right_eye=(x + s * 0.7, y + s * 0.4)
    )


def test_export_one_crop_per_face(tmp_path):
    img = Image.new("RGB", (300, 300), (120, 120, 120))
    regions = [_region(20, 20, 60), _region(180, 180, 60)]
    paths = export_crops(img, regions, tmp_path, "raw-pic")
    assert [p.name for p in paths] == ["raw-pic__face_0.png", "raw-pic__face_1.png"]
    assert all(p.exists() for p in paths)


def test_export_handles_no_faces(tmp_path):
    img = Image.new("RGB", (50, 50))
    assert export_crops(img, [], tmp_path, "x") == []
