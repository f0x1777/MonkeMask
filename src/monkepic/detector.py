from __future__ import annotations

import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

from .geometry import iou
from .types import FaceRegion

# OpenCV YuNet face detector — robust across face sizes (good for group photos),
# returns 5 landmarks incl. both eyes. Small ONNX model, downloaded once.
_MODEL_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/"
    "face_detection_yunet/face_detection_yunet_2023mar.onnx"
)
_MODEL_DIR = Path("models")
_MODEL_PATH = _MODEL_DIR / "face_detection_yunet_2023mar.onnx"

# No single input resolution catches every face: full-res YuNet misses very large
# faces, while downscaling misses small ones. We detect at several scales (longest
# side in px) and union the results, deduplicated by IoU. Boxes are mapped back to
# original image coordinates.
_DETECT_SCALES = (2560, 1600, 1280, 1024, 800)
_DEDUP_IOU = 0.3


def _ensure_model() -> Path:
    """Download the YuNet model once into models/ (gitignored)."""
    if not _MODEL_PATH.exists():
        _MODEL_DIR.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(_MODEL_URL, _MODEL_PATH)  # noqa: S310 (trusted URL)
    return _MODEL_PATH


class FaceDetector:
    """Wrapper over OpenCV's YuNet face detector. detect() returns pixel-space
    FaceRegions with left/right eye keypoints, found via a multi-scale union."""

    def __init__(self, min_confidence: float = 0.6, model_path: str | Path | None = None):
        self._min_confidence = min_confidence
        self._model_path = Path(model_path) if model_path else None

    def _detect_at(self, cv2, model, bgr, longest: int) -> list[FaceRegion]:
        """Detect at one input resolution; boxes/landmarks mapped to original coords."""
        h, w = bgr.shape[:2]
        scale = min(1.0, longest / max(w, h))
        det = bgr if scale == 1.0 else cv2.resize(bgr, (round(w * scale), round(h * scale)))
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
            # YuNet landmark order: right eye, left eye, nose, right mouth, left mouth.
            right_eye = (float(f[4] * inv), float(f[5] * inv))
            left_eye = (float(f[6] * inv), float(f[7] * inv))
            out.append(
                FaceRegion(
                    x=max(0, int(f[0] * inv)),
                    y=max(0, int(f[1] * inv)),
                    w=int(f[2] * inv),
                    h=int(f[3] * inv),
                    left_eye=left_eye,
                    right_eye=right_eye,
                    confidence=float(f[14]),
                )
            )
        return out

    def detect(self, image: Image.Image) -> list[FaceRegion]:
        import cv2

        model = self._model_path or _ensure_model()
        rgb = np.array(image.convert("RGB"))
        bgr = rgb[:, :, ::-1].copy()

        candidates: list[FaceRegion] = []
        for longest in _DETECT_SCALES:
            candidates.extend(self._detect_at(cv2, model, bgr, longest))

        # Highest-confidence first, then greedily drop overlapping duplicates.
        candidates.sort(key=lambda r: r.confidence, reverse=True)
        kept: list[FaceRegion] = []
        for cand in candidates:
            cbox = (cand.x, cand.y, cand.w, cand.h)
            if all(iou(cbox, (k.x, k.y, k.w, k.h)) < _DEDUP_IOU for k in kept):
                kept.append(cand)
        return kept
