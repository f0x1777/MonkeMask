from __future__ import annotations

import numpy as np
from PIL import Image

from .types import FaceRegion


class FaceEmbedder:
    """InsightFace ArcFace embedder. Lazy-loads the model on first embed().
    Returns a 512-d L2-normalized vector for a face region."""

    def __init__(self, model_name: str = "buffalo_l", pad: float = 0.25, border: float = 0.6):
        self._model_name = model_name
        self._pad = pad
        self._border = border
        self._app = None

    def _ensure_app(self):
        if self._app is None:
            from insightface.app import FaceAnalysis

            app = FaceAnalysis(name=self._model_name)
            app.prepare(ctx_id=-1, det_size=(640, 640))  # ctx_id=-1 -> CPU
            self._app = app
        return self._app

    def embed(self, image: Image.Image, region: FaceRegion) -> np.ndarray:
        """Embed the face in ``region``. Crops with padding, runs ArcFace on the
        crop, returns an L2-normalized 512-d vector.

        InsightFace re-detects the face inside the crop, and its detector fails on
        tight, already-cropped faces (it expects context around the face). We pad
        the crop with a gray border so the detector reliably finds the face — this
        is what makes enrollment work on small face crops."""
        from PIL import ImageOps

        app = self._ensure_app()
        W, H = image.size
        px, py = int(region.w * self._pad), int(region.h * self._pad)
        box = (
            max(0, region.x - px), max(0, region.y - py),
            min(W, region.x + region.w + px), min(H, region.y + region.h + py),
        )
        crop = image.convert("RGB").crop(box)
        # Pad with a neutral gray border so InsightFace's detector has the context
        # it needs to localize an already-cropped face.
        border = int(max(crop.size) * self._border)
        crop = ImageOps.expand(crop, border=border, fill=(128, 128, 128))

        faces = app.get(np.array(crop)[:, :, ::-1])  # RGB->BGR
        if not faces:
            raise ValueError("no face found in crop for embedding")
        # Largest detected face in the crop.
        face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
        vec = np.asarray(face.normed_embedding, dtype=float)
        return vec / max(float(np.linalg.norm(vec)), 1e-12)
