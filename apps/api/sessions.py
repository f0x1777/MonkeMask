from __future__ import annotations

import shutil
import tempfile
import time
import uuid
from pathlib import Path

# A session is an opaque id naming a tempdir that holds the uploaded photo and
# monke files for one pairing flow. No database; dirs are swept by TTL.

_PREFIX = "monkemask-"


class SessionStore:
    """Manages per-flow tempdirs. ``clock`` is injectable for testing the TTL."""

    def __init__(self, root: str | Path | None = None, ttl_seconds: float = 1800,
                 clock=time.time):
        self._root = Path(root) if root is not None else Path(tempfile.gettempdir())
        self._ttl = ttl_seconds
        self._clock = clock
        self._created: dict[str, float] = {}

    def create(self) -> str:
        sid = uuid.uuid4().hex
        self.path(sid).mkdir(parents=True, exist_ok=True)
        self._created[sid] = self._clock()
        return sid

    def path(self, sid: str) -> Path:
        return self._root / f"{_PREFIX}{sid}"

    def exists(self, sid: str) -> bool:
        return sid in self._created and self.path(sid).is_dir()

    def delete(self, sid: str) -> None:
        shutil.rmtree(self.path(sid), ignore_errors=True)
        self._created.pop(sid, None)

    def sweep(self) -> list[str]:
        """Delete sessions older than the TTL. Returns the ids removed."""
        now = self._clock()
        expired = [s for s, t in self._created.items() if now - t >= self._ttl]
        for sid in expired:
            self.delete(sid)
        return expired
