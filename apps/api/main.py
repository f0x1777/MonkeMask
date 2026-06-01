from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from monkepic.loader import SUPPORTED

from . import service
from .sessions import SessionStore

MAX_PHOTO_BYTES = 25 * 1024 * 1024
MAX_MONKE_BYTES = 5 * 1024 * 1024
MAX_FACES = 50
MAX_MONKES = 200

# A detector is created lazily and reused (model load is expensive). Tests inject
# their own via app.state.detector.
app = FastAPI(title="MonkeMask API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("MONKEMASK_WEB_ORIGIN", "http://localhost:3000")],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.state.sessions = SessionStore()
app.state.detector = None


def _detector():
    if app.state.detector is None:
        from monkepic.detector import FaceDetector

        app.state.detector = FaceDetector()
    return app.state.detector


def _check(upload: UploadFile, data: bytes, limit: int) -> None:
    ext = Path(upload.filename or "").suffix.lower()
    if ext not in SUPPORTED:
        raise HTTPException(400, f"unsupported file type: {ext or '(none)'}")
    if len(data) > limit:
        raise HTTPException(400, f"file too large ({len(data)} bytes > {limit})")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/detect")
async def detect(photo: UploadFile):
    data = await photo.read()
    _check(photo, data, MAX_PHOTO_BYTES)
    store: SessionStore = app.state.sessions
    sid = store.create()
    photo_path = store.path(sid) / "photo"
    photo_path.write_bytes(data)

    results = service.detect_faces(photo_path, _detector())[:MAX_FACES]
    # Persist the face regions so /compose can rebuild placements without the client
    # round-tripping geometry.
    faces_meta = [
        {"index": i, "x": r.x, "y": r.y, "w": r.w, "h": r.h,
         "left_eye": list(r.left_eye), "right_eye": list(r.right_eye)}
        for i, (r, _) in enumerate(results)
    ]
    (store.path(sid) / "faces.json").write_text(json.dumps(faces_meta))

    return {
        "session": sid,
        "faces": [
            {"index": i, "x": r.x, "y": r.y, "w": r.w, "h": r.h, "thumb": thumb}
            for i, (r, thumb) in enumerate(results)
        ],
    }


@app.post("/api/monkes")
async def add_monkes(session: str = Form(...), files: list[UploadFile] = None):
    store: SessionStore = app.state.sessions
    if not store.exists(session):
        raise HTTPException(404, "unknown or expired session")
    files = files or []
    monkes_dir = store.path(session) / "monkes"
    monkes_dir.mkdir(exist_ok=True)
    out = []
    existing = len(list(monkes_dir.glob("*")))
    for n, f in enumerate(files):
        data = await f.read()
        _check(f, data, MAX_MONKE_BYTES)
        if existing + n >= MAX_MONKES:
            raise HTTPException(400, "too many monkes")
        ext = Path(f.filename or "").suffix.lower()
        mid = f"m{existing + n}{ext}"
        (monkes_dir / mid).write_bytes(data)
        out.append({"id": mid, "thumb": service.monke_thumb(monkes_dir / mid)})
    return {"monkes": out}


@app.post("/api/compose")
async def compose(payload: dict):
    store: SessionStore = app.state.sessions
    sid = payload.get("session")
    if not sid or not store.exists(sid):
        raise HTTPException(404, "unknown or expired session")

    from monkepic.types import FaceRegion

    faces_meta = json.loads((store.path(sid) / "faces.json").read_text())
    by_index = {
        m["index"]: FaceRegion(m["x"], m["y"], m["w"], m["h"],
                               tuple(m["left_eye"]), tuple(m["right_eye"]))
        for m in faces_meta
    }
    monkes_dir = store.path(sid) / "monkes"

    pairs = []
    offsets = []
    for a in payload.get("assignments", []):
        region = by_index.get(a["face_index"])
        monke = monkes_dir / a["monke_id"]
        if region is None or not monke.exists():
            raise HTTPException(400, f"bad assignment: {a}")
        pairs.append((region, monke))
        offsets.append((float(a.get("dx", 0)), float(a.get("dy", 0))))

    png = service.compose(store.path(sid) / "photo", pairs, offsets=offsets)
    # Keep the session so the user can nudge a monke and re-compose; it is deleted
    # explicitly via DELETE /api/session (the UI's "Start over") and by the TTL
    # sweep. Opportunistically sweep expired sessions on every compose.
    store.sweep()
    return Response(content=png, media_type="image/png")


@app.delete("/api/session/{sid}", status_code=204)
def delete_session(sid: str):
    app.state.sessions.delete(sid)
    return Response(status_code=204)
