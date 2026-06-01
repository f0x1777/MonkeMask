from __future__ import annotations

import re
from pathlib import Path

import numpy as np

from .loader import SUPPORTED, load_image
from .types import PersonEntry


def parse_person_folder(folder: str | Path) -> tuple[Path | None, list[Path]]:
    """Split a person folder into (monke, face_photos). The image whose name
    contains 'SMB' (case-insensitive) is the monke; the rest are face photos."""
    folder = Path(folder)
    images = sorted(
        p for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() in SUPPORTED
    )
    monke = next((p for p in images if "smb" in p.name.lower()), None)
    faces = [p for p in images if p is not monke]
    return monke, faces


_PERSON_RE = re.compile(r"^\d+\s*-\s*(.+)$")  # "01 - Nico" -> "Nico"


def _person_name(folder: Path) -> str | None:
    m = _PERSON_RE.match(folder.name)
    return m.group(1).strip() if m else None


def build_gallery(ourmonke_dir, embedder, detector) -> list[PersonEntry]:
    """Enroll every 'NN - Person' folder that has a monke and >=1 usable face
    photo. Each person's embedding is the L2-normalized mean of their face
    embeddings. Folders without an 'NN - ' prefix (e.g. 'Potential - X',
    '_generic') are ignored."""
    root = Path(ourmonke_dir)
    entries: list[PersonEntry] = []
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        name = _person_name(folder)
        if name is None:
            continue
        monke, faces = parse_person_folder(folder)
        if monke is None or not faces:
            continue
        vecs = []
        for face_path in faces:
            try:
                image = load_image(face_path)
                regions = detector.detect(image)
                if not regions:
                    continue
                vecs.append(embedder.embed(image, regions[0]))
            except Exception:
                continue
        if not vecs:
            continue
        mean = np.mean(np.array(vecs, dtype=float), axis=0)
        mean = mean / max(float(np.linalg.norm(mean)), 1e-12)
        entries.append(PersonEntry(name, monke, tuple(mean.tolist()), len(vecs)))
    return entries
