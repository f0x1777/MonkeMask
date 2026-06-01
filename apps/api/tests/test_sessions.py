from apps.api.sessions import SessionStore


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
