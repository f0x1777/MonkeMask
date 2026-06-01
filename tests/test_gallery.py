from PIL import Image

from monkepic.gallery import parse_person_folder


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
