import numpy as np
import pytest
from PIL import Image


@pytest.fixture
def solid_bg_monke():
    """100x100 white background with a red square in the center, no alpha."""
    arr = np.full((100, 100, 3), 255, dtype=np.uint8)
    arr[30:70, 30:70] = [255, 0, 0]
    return Image.fromarray(arr, "RGB")


@pytest.fixture
def alpha_monke():
    """50x50 image that already has a transparent border."""
    arr = np.zeros((50, 50, 4), dtype=np.uint8)
    arr[10:40, 10:40] = [0, 0, 255, 255]
    return Image.fromarray(arr, "RGBA")


@pytest.fixture
def gradient_bg_monke():
    """100x100 horizontal gradient background (corners disagree -> not solid)."""
    arr = np.zeros((100, 100, 3), dtype=np.uint8)
    for x in range(100):
        arr[:, x] = [x * 2, 50, 200 - x]
    return Image.fromarray(arr, "RGB")
