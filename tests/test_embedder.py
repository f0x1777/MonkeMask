from monkepic.embedder import FaceEmbedder


def test_embedder_constructs_without_loading_model():
    # Must not import/download insightface at construction time (lazy load).
    emb = FaceEmbedder()
    assert emb is not None
    assert emb._app is None  # model not loaded yet
