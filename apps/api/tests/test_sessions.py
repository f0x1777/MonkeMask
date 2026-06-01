import asyncio

from apps.api.sessions import SessionStore, periodic_sweep


def test_create_makes_a_dir(tmp_path):
    store = SessionStore(root=tmp_path)
    sid = store.create()
    assert store.exists(sid)
    assert store.path(sid).is_dir()


def test_delete_removes_dir_and_session(tmp_path):
    store = SessionStore(root=tmp_path)
    sid = store.create()
    store.delete(sid)
    assert not store.exists(sid)
    assert not store.path(sid).exists()


def test_unknown_session_does_not_exist(tmp_path):
    store = SessionStore(root=tmp_path)
    assert store.exists("nope") is False


def test_ttl_sweep_removes_old_sessions(tmp_path):
    now = {"t": 1000.0}
    store = SessionStore(root=tmp_path, ttl_seconds=60, clock=lambda: now["t"])
    sid_old = store.create()
    now["t"] = 1100.0  # 100s later -> past the 60s TTL
    sid_new = store.create()

    removed = store.sweep()

    assert sid_old in removed
    assert sid_new not in removed
    assert not store.exists(sid_old)
    assert store.exists(sid_new)


def test_periodic_sweep_deletes_expired_without_compose_traffic(tmp_path):
    # The background loop must delete an expired session on its own — no /api/compose
    # call needed to trigger it (otherwise a photo could linger past the TTL when the
    # app is idle).
    now = {"t": 1000.0}
    store = SessionStore(root=tmp_path, ttl_seconds=60, clock=lambda: now["t"])
    sid = store.create()
    now["t"] = 2000.0  # well past the 60s TTL

    async def run():
        task = asyncio.create_task(periodic_sweep(store, interval=0.01))
        await asyncio.sleep(0.05)  # let the loop tick a few times
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(run())

    assert not store.exists(sid)
    assert not store.path(sid).exists()
