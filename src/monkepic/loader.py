from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageOps

# Register AVIF/HEIC openers so Pillow can read SMB .avif files.
try:
    from pillow_heif import register_avif_opener, register_heif_opener

    register_heif_opener()
    register_avif_opener()
except Exception:  # pragma: no cover - environment without pillow-heif
    pass

SUPPORTED = {".png", ".jpg", ".jpeg", ".webp", ".avif", ".heic", ".bmp"}


def load_image(path: str | Path) -> Image.Image:
    """Open an image and apply its EXIF orientation, so phone photos (which are
    often stored sideways/upside-down with an orientation flag) come out upright.
    Without this, faces are detected rotated and the monkes end up crooked."""
    img = Image.open(Path(path))
    return ImageOps.exif_transpose(img)


def save_image(img: Image.Image, path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)


def list_images(path: str | Path) -> list[Path]:
    path = Path(path)
    if path.is_file():
        return [path] if path.suffix.lower() in SUPPORTED else []
    return sorted(p for p in path.rglob("*") if p.suffix.lower() in SUPPORTED)
