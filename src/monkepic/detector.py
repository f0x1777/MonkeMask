from __future__ import annotations

import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

from .types import FaceRegion

# BlazeFace short-range model (faces within ~2m). Downloaded once and cached.
_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
)
_MODEL_DIR = Path("models")
_MODEL_PATH = _MODEL_DIR / "blaze_face_short_range.tflite"


def _ensure_model() -> Path:
    """Download the BlazeFace model once into models/ (gitignored)."""
    if not _MODEL_PATH.exists():
        _MODEL_DIR.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(_MODEL_URL, _MODEL_PATH)  # noqa: S310 (trusted URL)
    return _MODEL_PATH


class FaceDetector:
    """Wrapper over the MediaPipe Tasks Face Detector (BlazeFace). detect() returns
    pixel-space FaceRegions with left/right eye keypoints."""

    def __init__(self, min_confidence: float = 0.5, model_path: str | Path | None = None):
        self._min_confidence = min_confidence
        self._model_path = Path(model_path) if model_path else None

    def _build(self):
        import mediapipe as mp
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision

        model = self._model_path or _ensure_model()
        options = vision.FaceDetectorOptions(
            base_options=python.BaseOptions(model_asset_path=str(model)),
            min_detection_confidence=self._min_confidence,
        )
        return mp, vision.FaceDetector.create_from_options(options)

    def detect(self, image: Image.Image) -> list[FaceRegion]:
        mp, detector = self._build()
        rgb = np.array(image.convert("RGB"))
        h, w = rgb.shape[:2]
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = detector.detect(mp_image)

        out: list[FaceRegion] = []
        for det in result.detections or []:
            box = det.bounding_box
            kps = det.keypoints
            # BlazeFace keypoint order: 0 = right eye, 1 = left eye (subject's),
            # given as normalized coordinates.
            right_eye = (kps[0].x * w, kps[0].y * h)
            left_eye = (kps[1].x * w, kps[1].y * h)
            score = det.categories[0].score if det.categories else 1.0
            out.append(
                FaceRegion(
                    x=max(0, int(box.origin_x)),
                    y=max(0, int(box.origin_y)),
                    w=int(box.width),
                    h=int(box.height),
                    left_eye=left_eye,
                    right_eye=right_eye,
                    confidence=float(score),
                )
            )
        return out
