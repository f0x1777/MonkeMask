from __future__ import annotations

import random
from typing import Sequence


class MonkeSelector:
    """Assign one monke per face: random without repetition within a photo when the
    pool is big enough; otherwise allow repeats and flag it."""

    def __init__(self, pool: Sequence, seed: int | None = None):
        if not pool:
            raise ValueError("monke pool is empty")
        self._pool = list(pool)
        self._rng = random.Random(seed)
        self.repeated = False

    def assign(self, n: int) -> list:
        if n <= len(self._pool):
            return self._rng.sample(self._pool, n)
        self.repeated = True
        picks = self._rng.sample(self._pool, len(self._pool))
        picks += self._rng.choices(self._pool, k=n - len(self._pool))
        return picks
