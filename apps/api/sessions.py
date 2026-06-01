from __future__ import annotations

import asyncio
import shutil
import tempfile
import time
import uuid
from pathlib import Path

# A session is an opaque id naming a tempdir that holds the uploaded photo and
# monke files for one pairing flow. No database; dirs are swept by TTL.

_PREFIX = "monkemask-"


def _is_sid(sid: str) -> bool:
    """A session id is a 32-char uuid4 hex — guards re-adoption of arbitrary dirs."""
    try:
        return len(sid) == 32 and int(sid, 16) >= 0
    except (ValueError, TypeError):
        return False


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
        # Re-adopt a session whose tempdir still exists but isn't in memory yet
        # (e.g. the worker process restarted but the filesystem persisted). This
        # avoids spurious "unknown session" right after a restart.
        if sid not in self._created and self.path(sid).is_dir() and _is_sid(sid):
            self._created[sid] = self._clock()
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


async def periodic_sweep(store: SessionStore, interval: float) -> None:
    """Background loop that calls ``store.sweep()`` every ``interval`` seconds, so an
    uploaded photo is always deleted within its TTL even when the app is idle (the
    per-request sweep only runs when a /api/compose call happens to arrive). Runs
    until cancelled (on app shutdown)."""
    while True:
        await asyncio.sleep(interval)
        store.sweep()
