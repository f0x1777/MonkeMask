import numpy as np
from PIL import Image

from monkepic.loader import list_images, load_image, save_image


def test_roundtrip_png(tmp_path):
    src = tmp_path / "m.png"
    Image.fromarray(np.full((10, 10, 4), 200, dtype=np.uint8), "RGBA").save(src)
    img = load_image(src)
    assert img.size == (10, 10)


def test_save_preserves_alpha_as_png(tmp_path):
    img = Image.fromarray(np.zeros((8, 8, 4), dtype=np.uint8), "RGBA")
    out = tmp_path / "out.png"
    save_image(img, out)
    assert load_image(out).mode == "RGBA"


def test_list_images_recursive(tmp_path):
    (tmp_path / "sub").mkdir()
    for name in ["a.png", "sub/b.jpg", "sub/c.webp", "notes.txt"]:
        p = tmp_path / name
        if p.suffix != ".txt":
            Image.new("RGB", (4, 4)).save(p)
        else:
            p.write_text("x")
    found = {p.name for p in list_images(tmp_path)}
    assert found == {"a.png", "b.jpg", "c.webp"}
