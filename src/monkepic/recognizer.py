from __future__ import annotations

from pathlib import Path

import numpy as np

from .types import MatchResult, PersonEntry


class Recognizer:
    """Match a face embedding against the enrolled gallery by cosine similarity.
    Best match wins if it meets the threshold; otherwise fall back to generic."""

    def __init__(self, gallery: list[PersonEntry], generic_monke: Path, threshold: float = 0.5):
        self._generic = Path(generic_monke)
        self._threshold = threshold
        # Defensive: skip any entry without an embedding (the type allows None,
        # though build_gallery never produces one).
        gallery = [p for p in gallery if p.embedding is not None]
        self._names = [p.name for p in gallery]
        self._monkes = [p.monke_path for p in gallery]
        if gallery:
            mat = np.array([p.embedding for p in gallery], dtype=float)
            # Rows are expected pre-normalized; normalize defensively anyway.
            norms = np.linalg.norm(mat, axis=1, keepdims=True)
            self._mat = mat / np.clip(norms, 1e-12, None)
        else:
            self._mat = None

    def match(self, embedding) -> MatchResult:
        vec = np.asarray(embedding, dtype=float)
        vec = vec / max(float(np.linalg.norm(vec)), 1e-12)
        if self._mat is None:
            return MatchResult(None, 0.0, self._generic, True)
        sims = self._mat @ vec
        best = int(np.argmax(sims))
        best_sim = float(sims[best])
        if best_sim >= self._threshold:
            return MatchResult(self._names[best], best_sim, self._monkes[best], False)
        return MatchResult(None, best_sim, self._generic, True)
