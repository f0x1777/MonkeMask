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


class FakeEmbedder:
    """Face at x<100 -> vector A, else vector B (deterministic for suggest tests)."""

    def embed(self, image, region):
        v = np.array([1.0, 0.0, 0.0] if region.x < 100 else [0.0, 0.0, 1.0], dtype=float)
        return v / np.linalg.norm(v)


@pytest.fixture
def client(tmp_path):
    main.app.state.sessions = SessionStore(root=tmp_path)
    main.app.state.detector = FakeDetector()
    main.app.state.embedder = FakeEmbedder()
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


def test_people_and_suggest_flow(client):
    # detect -> upload a monke -> add a person (monke + a reference face) -> suggest
    r = client.post("/api/detect", files={"photo": ("p.png", _photo_bytes(), "image/png")})
    sid = r.json()["session"]
    mid = client.post(
        "/api/monkes",
        data={"session": sid},
        files=[("files", ("g.png", _monke_bytes([0, 255, 0]), "image/png"))],
    ).json()["monkes"][0]["id"]

    # The reference face embeds (via FakeEmbedder) to vector A (x<100 in FakeDetector).
    rp = client.post(
        "/api/people",
        data={"session": sid, "name": "Nico", "monke_id": mid},
        files=[("faces", ("ref.png", _photo_bytes(), "image/png"))],
    )
    assert rp.status_code == 200
    assert rp.json()["usable_refs"] == 1

    s = client.post("/api/suggest", json={"session": sid})
    body = s.json()
    # face 0 (x=20 -> vector A) matches Nico; face 1 (x=180 -> vector B) unmatched
    assert len(body["suggestions"]) == 1
    assert body["suggestions"][0]["face_index"] == 0
    assert body["suggestions"][0]["monke_id"] == mid
    assert body["unmatched"] == [1]


def test_suggest_no_people_all_unmatched(client):
    r = client.post("/api/detect", files={"photo": ("p.png", _photo_bytes(), "image/png")})
    sid = r.json()["session"]
    body = client.post("/api/suggest", json={"session": sid}).json()
    assert body["suggestions"] == []
    assert body["unmatched"] == [0, 1]


def test_people_cleared_on_session_delete(client):
    r = client.post("/api/detect", files={"photo": ("p.png", _photo_bytes(), "image/png")})
    sid = r.json()["session"]
    mid = client.post(
        "/api/monkes",
        data={"session": sid},
        files=[("files", ("g.png", _monke_bytes([0, 255, 0]), "image/png"))],
    ).json()["monkes"][0]["id"]
    client.post(
        "/api/people",
        data={"session": sid, "name": "Nico", "monke_id": mid},
        files=[("faces", ("ref.png", _photo_bytes(), "image/png"))],
    )
    assert client.app.state.sessions.people.get(sid)
    client.delete(f"/api/session/{sid}")
    assert sid not in client.app.state.sessions.people
