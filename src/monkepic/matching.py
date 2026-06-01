from __future__ import annotations

from pathlib import Path

from .facefilter import filter_background
from .loader import load_image
from .pipeline import process_image
from .recognizer import Recognizer
from .types import FaceRegion, PersonEntry


def process_image_matched(
    src,
    gallery: list[PersonEntry],
    generic_monke,
    out_dir,
    detector,
    embedder,
    *,
    threshold: float = 0.5,
    min_ratio: float = 0.35,
    min_px: int = 40,
    margin: float = 1.0,
    rotate: bool = True,
    crops_dir=None,
) -> Path:
    """Phase 3: cover each (non-background) face with its person's monke, or the
    generic monke when unrecognized. Reuses the Phase 1 compositor via a
    choose_monke callback so background filtering is applied consistently."""
    generic_monke = Path(generic_monke)
    recognizer = Recognizer(gallery, generic_monke, threshold)

    # Detector wrapper that applies the background-face filter, so process_image
    # composes exactly the faces we keep (and exports crops for those only).
    class _FilteringDetector:
        def detect(self, image) -> list[FaceRegion]:
            return filter_background(detector.detect(image), min_ratio, min_px)

    def choose(regions: list[FaceRegion]):
        image = load_image(src)
        out = []
        for r in regions:
            try:
                emb = embedder.embed(image, r)
                out.append(recognizer.match(emb).monke_path)
            except Exception:
                out.append(generic_monke)
        return out

    return process_image(
        src, None, out_dir, _FilteringDetector(),
        margin=margin, rotate=rotate, crops_dir=crops_dir, choose_monke=choose,
    )
