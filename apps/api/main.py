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
# Allowed web origins: comma-separated MONKEMASK_WEB_ORIGIN (e.g. the Vercel URL),
# plus localhost for dev. Vercel preview URLs are matched by regex.
_origins = [o.strip() for o in os.environ.get("MONKEMASK_WEB_ORIGIN", "").split(",") if o.strip()]
_origins += ["http://localhost:3000", "http://127.0.0.1:3000"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_methods=["*"],
    allow_headers=["*"],
)
app.state.sessions = SessionStore()
app.state.detector = None
app.state.embedder = None


def _detector():
    if app.state.detector is None:
        from monkepic.detector import FaceDetector

        app.state.detector = FaceDetector()
    return app.state.detector


def _embedder():
    if app.state.embedder is None:
        from monkepic.embedder import FaceEmbedder

        app.state.embedder = FaceEmbedder()
    return app.state.embedder


def _check(upload: UploadFile, data: bytes, limit: int) -> None:
    ext = Path(upload.filename or "").suffix.lower()
    if ext not in SUPPORTED:
        raise HTTPException(400, f"unsupported file type: {ext or '(none)'}")
    if len(data) > limit:
        raise HTTPException(400, f"file too large ({len(data)} bytes > {limit})")


@app.get("/api/health")
def health():
    return {"status": "ok"}


def _detect_and_store(sid: str):
    """Run detection on a session's photo, persist face regions, return the face
    payload. Shared by /api/detect and /api/rotate."""
    store: SessionStore = app.state.sessions
    photo_path = store.path(sid) / "photo"
    results = service.detect_faces(photo_path, _detector())[:MAX_FACES]
    faces_meta = [
        {"index": i, "x": r.x, "y": r.y, "w": r.w, "h": r.h,
         "left_eye": list(r.left_eye), "right_eye": list(r.right_eye)}
        for i, (r, _) in enumerate(results)
    ]
    (store.path(sid) / "faces.json").write_text(json.dumps(faces_meta))
    return [
        {"index": i, "x": r.x, "y": r.y, "w": r.w, "h": r.h, "thumb": thumb}
        for i, (r, thumb) in enumerate(results)
    ]


@app.post("/api/detect")
async def detect(photo: UploadFile):
    data = await photo.read()
    _check(photo, data, MAX_PHOTO_BYTES)
    store: SessionStore = app.state.sessions
    sid = store.create()
    (store.path(sid) / "photo").write_bytes(data)
    return {"session": sid, "faces": _detect_and_store(sid)}


@app.post("/api/rotate")
async def rotate(payload: dict):
    """Rotate the session photo 90/180/270° clockwise and re-detect faces.
    Resets any prior monke assignments on the client (faces are renumbered)."""
    store: SessionStore = app.state.sessions
    sid = payload.get("session")
    if not sid or not store.exists(sid):
        raise HTTPException(404, "unknown or expired session")
    degrees = int(payload.get("degrees", 90)) % 360
    if degrees not in (0, 90, 180, 270):
        raise HTTPException(400, "degrees must be 0, 90, 180 or 270")
    if degrees:
        service.rotate_photo(store.path(sid) / "photo", degrees)
    return {"session": sid, "faces": _detect_and_store(sid)}


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


@app.post("/api/generic")
async def add_generic(payload: dict):
    """Expose the shipped DAOJones as a session monke (for unmatched faces)."""
    store: SessionStore = app.state.sessions
    sid = payload.get("session")
    if not sid or not store.exists(sid):
        raise HTTPException(404, "unknown or expired session")
    src = Path("MonkeDAO_DAOJones.png")
    if not src.exists():
        raise HTTPException(500, "generic monke asset missing")
    monkes_dir = store.path(sid) / "monkes"
    monkes_dir.mkdir(exist_ok=True)
    mid = "generic-daojones.png"
    (monkes_dir / mid).write_bytes(src.read_bytes())
    return {"id": mid, "thumb": service.monke_thumb(monkes_dir / mid)}


@app.post("/api/people")
async def add_person(
    session: str = Form(...),
    name: str = Form(...),
    monke_id: str = Form(...),
    faces: list[UploadFile] = None,
):
    store: SessionStore = app.state.sessions
    if not store.exists(session):
        raise HTTPException(404, "unknown or expired session")
    monkes_dir = store.path(session) / "monkes"
    if not (monkes_dir / monke_id).exists():
        raise HTTPException(400, f"unknown monke_id: {monke_id}")
    if len(store.people.get(session, [])) >= 200:
        raise HTTPException(400, "too many people")

    faces = faces or []
    pid = f"p{len(store.people[session])}"
    pdir = store.path(session) / "people" / pid
    pdir.mkdir(parents=True, exist_ok=True)
    face_paths = []
    for n, f in enumerate(faces):
        data = await f.read()
        _check(f, data, MAX_MONKE_BYTES)
        ext = Path(f.filename or "").suffix.lower()
        fp = pdir / f"f{n}{ext}"
        fp.write_bytes(data)
        face_paths.append(fp)

    embedding, usable = service.enroll_person(face_paths, _embedder(), _detector())
    person = {
        "person_id": pid,
        "name": name,
        "monke_id": monke_id,
        "embedding": embedding,
        "n_refs": len(face_paths),
    }
    # Only keep enrolled (usable) people in the suggest pool; still report the row.
    if embedding is not None:
        store.people[session].append(person)
    return {
        "person_id": pid,
        "name": name,
        "monke_id": monke_id,
        "n_refs": len(face_paths),
        "usable_refs": usable,
    }


@app.get("/api/people")
def list_people(session: str):
    store: SessionStore = app.state.sessions
    if not store.exists(session):
        raise HTTPException(404, "unknown or expired session")
    return {
        "people": [
            {"person_id": p["person_id"], "name": p["name"], "monke_id": p["monke_id"],
             "n_refs": p["n_refs"]}
            for p in store.people.get(session, [])
        ]
    }


@app.post("/api/suggest")
async def suggest(payload: dict):
    store: SessionStore = app.state.sessions
    sid = payload.get("session")
    if not sid or not store.exists(sid):
        raise HTTPException(404, "unknown or expired session")
    people = store.people.get(sid, [])
    suggestions, unmatched = service.suggest(
        store.path(sid) / "photo", people, _embedder(), _detector()
    )
    return {"suggestions": suggestions, "unmatched": unmatched}


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
        scale = float(a.get("scale", 1.0))
        scale = min(4.0, max(0.25, scale))  # clamp to a sane range
        offsets.append((float(a.get("dx", 0)), float(a.get("dy", 0)), scale))

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
