import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from apps.api import main
from apps.api.sessions import SessionStore
from monkepic.types import FaceRegion


class FakeDetector:
    def detect(self, image):
        # two clearly-foreground faces of similar size
        return [
            FaceRegion(20, 20, 80, 80, (44.0, 52.0), (76.0, 52.0)),
            FaceRegion(180, 180, 80, 80, (204.0, 212.0), (236.0, 212.0)),
        ]


@pytest.fixture
def client(tmp_path):
    main.app.state.sessions = SessionStore(root=tmp_path)
    main.app.state.detector = FakeDetector()
    return TestClient(main.app)


def _photo_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (300, 300), (10, 10, 10)).save(buf, format="PNG")
    return buf.getvalue()


def _monke_bytes(rgb):
    arr = np.full((40, 40, 3), 255, dtype=np.uint8)
    arr[10:30, 10:30] = rgb
    buf = io.BytesIO()
    Image.fromarray(arr, "RGB").save(buf, format="PNG")
    return buf.getvalue()


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_full_flow_detect_monkes_compose(client):
    # detect
    r = client.post("/api/detect", files={"photo": ("p.png", _photo_bytes(), "image/png")})
    assert r.status_code == 200
    body = r.json()
    sid = body["session"]
    assert len(body["faces"]) == 2
    assert body["faces"][0]["thumb"].startswith("data:image/png;base64,")

    # upload a monke
    r = client.post(
        "/api/monkes",
        data={"session": sid},
        files=[("files", ("g.png", _monke_bytes([0, 255, 0]), "image/png"))],
    )
    assert r.status_code == 200
    mid = r.json()["monkes"][0]["id"]

    # compose: assign the monke to face 0 only
    r = client.post(
        "/api/compose",
        json={"session": sid, "assignments": [{"face_index": 0, "monke_id": mid}]},
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    arr = np.array(Image.open(io.BytesIO(r.content)).convert("RGB"))
    assert arr[60, 60, 1] > 100  # face 0 covered with green monke
    assert arr[220, 220, 1] < 80  # face 1 left uncovered

    # session is kept after compose so the user can adjust and re-compose
    assert client.app.state.sessions.exists(sid)
    # ...and explicit "Start over" deletes it
    assert client.delete(f"/api/session/{sid}").status_code == 204
    assert not client.app.state.sessions.exists(sid)


def test_compose_per_monke_flip_mirrors_the_monke(client):
    sid = client.post("/api/detect", files={"photo": ("p.png", _photo_bytes(), "image/png")}).json()["session"]
    # An asymmetric monke: left half red, right half blue (opaque), so a mirror is visible.
    arr = np.zeros((40, 40, 4), dtype=np.uint8)
    arr[:, :20] = [255, 0, 0, 255]
    arr[:, 20:] = [0, 0, 255, 255]
    buf = io.BytesIO()
    Image.fromarray(arr, "RGBA").save(buf, format="PNG")
    mid = client.post(
        "/api/monkes", data={"session": sid}, files=[("files", ("m.png", buf.getvalue(), "image/png"))]
    ).json()["monkes"][0]["id"]

    def composed(flip):
        r = client.post(
            "/api/compose",
            json={"session": sid, "assignments": [{"face_index": 0, "monke_id": mid, "flip": flip}]},
        )
        assert r.status_code == 200
        return np.array(Image.open(io.BytesIO(r.content)).convert("RGB"))

    no, fl = composed(False), composed(True)
    # Face 0 is at (20,20,80,80); sample left-of-centre (~40,60). Flipping swaps red<->blue.
    lx, ly = 40, 60
    assert no[ly, lx][0] > no[ly, lx][2]  # left is red-dominant without flip
    assert fl[ly, lx][2] > fl[ly, lx][0]  # left is blue-dominant with flip


def test_recompose_with_offset_keeps_session(client):
    r = client.post("/api/detect", files={"photo": ("p.png", _photo_bytes(), "image/png")})
    sid = r.json()["session"]
    mr = client.post(
        "/api/monkes",
        data={"session": sid},
        files=[("files", ("g.png", _monke_bytes([0, 255, 0]), "image/png"))],
    )
    mid = mr.json()["monkes"][0]["id"]
    body = {"session": sid, "assignments": [{"face_index": 0, "monke_id": mid, "dx": 40, "dy": 0}]}
    assert client.post("/api/compose", json=body).status_code == 200
    # second compose on the same session still works (adjust-and-regenerate)
    assert client.post("/api/compose", json=body).status_code == 200


def test_layout_returns_cutouts_and_placements(client):
    r = client.post("/api/detect", files={"photo": ("p.png", _photo_bytes(), "image/png")})
    sid = r.json()["session"]
    mid = client.post(
        "/api/monkes",
        data={"session": sid},
        files=[("files", ("g.png", _monke_bytes([0, 255, 0]), "image/png"))],
    ).json()["monkes"][0]["id"]
    r = client.post(
        "/api/layout",
        json={"session": sid, "assignments": [{"face_index": 0, "monke_id": mid}]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["image"] == {"w": 300, "h": 300}
    assert len(body["items"]) == 1
    it = body["items"][0]
    assert it["face_index"] == 0
    assert it["monke"].startswith("data:image/png;base64,")
    for k in ("cx", "cy", "w", "h", "roll_deg", "z"):
        assert k in it


def test_layout_unknown_session_is_404(client):
    assert client.post("/api/layout", json={"session": "nope", "assignments": []}).status_code == 404


def test_photo_returns_png(client):
    r = client.post("/api/detect", files={"photo": ("p.png", _photo_bytes(), "image/png")})
    sid = r.json()["session"]
    pr = client.get("/api/photo", params={"session": sid})
    assert pr.status_code == 200
    assert pr.headers["content-type"] == "image/png"
    assert np.array(Image.open(io.BytesIO(pr.content))).shape[:2] == (300, 300)


def test_photo_unknown_session_is_404(client):
    assert client.get("/api/photo", params={"session": "nope"}).status_code == 404


def test_unsupported_upload_is_400(client):
    r = client.post("/api/detect", files={"photo": ("note.txt", b"hello", "text/plain")})
    assert r.status_code == 400


def test_compose_unknown_session_is_404(client):
    r = client.post("/api/compose", json={"session": "nope", "assignments": []})
    assert r.status_code == 404


def test_delete_session(client):
    r = client.post("/api/detect", files={"photo": ("p.png", _photo_bytes(), "image/png")})
    sid = r.json()["session"]
    assert client.delete(f"/api/session/{sid}").status_code == 204
    assert not client.app.state.sessions.exists(sid)


def test_generic_endpoint_adds_daojones(client):
    r = client.post("/api/detect", files={"photo": ("p.png", _photo_bytes(), "image/png")})
    sid = r.json()["session"]
    g = client.post("/api/generic", json={"session": sid})
    assert g.status_code == 200
    assert g.json()["id"] == "generic-daojones.png"
    assert g.json()["thumb"].startswith("data:image/png;base64,")


def test_rotate_redetects_and_returns_faces(client):
    r = client.post("/api/detect", files={"photo": ("p.png", _photo_bytes(), "image/png")})
    sid = r.json()["session"]
    n0 = len(r.json()["faces"])
    rr = client.post("/api/rotate", json={"session": sid, "degrees": 90})
    assert rr.status_code == 200
    assert rr.json()["session"] == sid
    # FakeDetector returns a fixed set, so the count is stable after rotation.
    assert len(rr.json()["faces"]) == n0


def test_rotate_bad_degrees_is_400(client):
    r = client.post("/api/detect", files={"photo": ("p.png", _photo_bytes(), "image/png")})
    sid = r.json()["session"]
    assert client.post("/api/rotate", json={"session": sid, "degrees": 45}).status_code == 400


def test_rotate_unknown_session_is_404(client):
    assert client.post("/api/rotate", json={"session": "nope", "degrees": 90}).status_code == 404


def test_flip_redetects_and_returns_faces(client):
    r = client.post("/api/detect", files={"photo": ("p.png", _photo_bytes(), "image/png")})
    sid = r.json()["session"]
    n0 = len(r.json()["faces"])
    fr = client.post("/api/flip", json={"session": sid})
    assert fr.status_code == 200
    assert fr.json()["session"] == sid
    # FakeDetector returns a fixed set, so the count is stable after mirroring.
    assert len(fr.json()["faces"]) == n0


def test_flip_mirrors_pixels_and_is_its_own_inverse(client):
    # An asymmetric photo (right half lighter) so a horizontal mirror is observable.
    arr = np.zeros((300, 300, 3), dtype=np.uint8)
    arr[:, 150:] = 200
    buf = io.BytesIO()
    Image.fromarray(arr, "RGB").save(buf, format="PNG")
    sid = client.post("/api/detect", files={"photo": ("p.png", buf.getvalue(), "image/png")}).json()["session"]
    photo = client.app.state.sessions.path(sid) / "photo"

    def pixels():
        # Close the file handle immediately so Windows doesn't keep the photo locked
        # (which would make the next /api/flip overwrite fail) — keeps CI non-flaky.
        with Image.open(photo) as im:
            return np.asarray(im.convert("RGB"))

    original = pixels()
    assert client.post("/api/flip", json={"session": sid}).status_code == 200
    once = pixels()
    assert not np.array_equal(once, original)  # mirroring changed the image
    assert np.array_equal(once, original[:, ::-1])  # exactly a left-right mirror
    assert client.post("/api/flip", json={"session": sid}).status_code == 200
    assert np.array_equal(pixels(), original)  # flipping twice restores it


def test_flip_unknown_session_is_404(client):
    assert client.post("/api/flip", json={"session": "nope"}).status_code == 404
