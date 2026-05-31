from __future__ import annotations

import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

from .types import FaceRegion

# OpenCV YuNet face detector — robust across face sizes (good for group photos),
# returns 5 landmarks incl. both eyes. Small ONNX model, downloaded once.
_MODEL_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/"
    "face_detection_yunet/face_detection_yunet_2023mar.onnx"
)
_MODEL_DIR = Path("models")
_MODEL_PATH = _MODEL_DIR / "face_detection_yunet_2023mar.onnx"

# YuNet misses very large faces when run at full resolution; detecting on a
# downscaled copy (longest side ~this) is more reliable and faster. Boxes are
# scaled back to the original image coordinates.
_DETECT_LONGEST_SIDE = 1280


def _ensure_model() -> Path:
    """Download the YuNet model once into models/ (gitignored)."""
    if not _MODEL_PATH.exists():
        _MODEL_DIR.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(_MODEL_URL, _MODEL_PATH)  # noqa: S310 (trusted URL)
    return _MODEL_PATH


class FaceDetector:
    """Wrapper over OpenCV's YuNet face detector. detect() returns pixel-space
    FaceRegions with left/right eye keypoints."""

    def __init__(self, min_confidence: float = 0.6, model_path: str | Path | None = None):
        self._min_confidence = min_confidence
        self._model_path = Path(model_path) if model_path else None

    def detect(self, image: Image.Image) -> list[FaceRegion]:
        import cv2

        model = self._model_path or _ensure_model()
        rgb = np.array(image.convert("RGB"))
        h, w = rgb.shape[:2]
        bgr = rgb[:, :, ::-1].copy()

        # Downscale for detection only (never upscale); map results back via 1/scale.
        scale = min(1.0, _DETECT_LONGEST_SIDE / max(w, h))
        if scale < 1.0:
            det = cv2.resize(bgr, (round(w * scale), round(h * scale)))
        else:
            det = bgr
        dh, dw = det.shape[:2]
        inv = 1.0 / scale

        detector = cv2.FaceDetectorYN.create(
            str(model), "", (dw, dh), self._min_confidence, 0.3, 5000
        )
        detector.setInputSize((dw, dh))
        _, faces = detector.detect(det)

        out: list[FaceRegion] = []
        if faces is None:
            return out
        for f in faces:
            x, y, bw, bh = (f[0] * inv, f[1] * inv, f[2] * inv, f[3] * inv)
            # YuNet landmark order: right eye, left eye, nose, right mouth, left mouth.
            right_eye = (float(f[4] * inv), float(f[5] * inv))
            left_eye = (float(f[6] * inv), float(f[7] * inv))
            out.append(
                FaceRegion(
                    x=max(0, int(x)),
                    y=max(0, int(y)),
                    w=int(bw),
                    h=int(bh),
                    left_eye=left_eye,
                    right_eye=right_eye,
                    confidence=float(f[14]),
                )
            )
        return out
