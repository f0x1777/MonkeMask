from __future__ import annotations

from pathlib import Path

from .loader import SUPPORTED


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
