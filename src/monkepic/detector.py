from __future__ import annotations

import numpy as np
from PIL import Image

from .types import FaceRegion


class FaceDetector:
    """Thin wrapper over MediaPipe Face Detection. detect() returns pixel-space
    FaceRegions with left/right eye keypoints."""

    def __init__(self, model_selection: int = 1, min_confidence: float = 0.5):
        self._model_selection = model_selection
        self._min_confidence = min_confidence

    def detect(self, image: Image.Image) -> list[FaceRegion]:
        import mediapipe as mp

        rgb = np.array(image.convert("RGB"))
        h, w = rgb.shape[:2]
        out: list[FaceRegion] = []
        with mp.solutions.face_detection.FaceDetection(
            model_selection=self._model_selection,
            min_detection_confidence=self._min_confidence,
        ) as fd:
            result = fd.process(rgb)
            for det in result.detections or []:
                box = det.location_data.relative_bounding_box
                kps = det.location_data.relative_keypoints
                # MediaPipe keypoint order: 0 = right eye, 1 = left eye (subject's).
                right_eye = (kps[0].x * w, kps[0].y * h)
                left_eye = (kps[1].x * w, kps[1].y * h)
                out.append(
                    FaceRegion(
                        x=max(0, int(box.xmin * w)),
                        y=max(0, int(box.ymin * h)),
                        w=int(box.width * w),
                        h=int(box.height * h),
                        left_eye=left_eye,
                        right_eye=right_eye,
                        confidence=float(det.score[0]) if det.score else 1.0,
                    )
                )
        return out
