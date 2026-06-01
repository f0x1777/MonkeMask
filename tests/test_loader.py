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


def test_load_applies_exif_orientation(tmp_path):
    # Build a landscape image with a unique top-left marker and tag it
    # orientation=6 (rotate 90° CW on display). load_image must return it
    # already rotated to portrait, with the marker moved to the top-right.
    arr = np.zeros((100, 200, 3), dtype=np.uint8)  # H=100, W=200 (landscape)
    arr[0:10, 0:10] = [255, 0, 0]  # red marker, top-left of the stored pixels
    img = Image.fromarray(arr, "RGB")
    exif = img.getexif()
    exif[274] = 6  # Orientation: rotate 90° CW
    src = tmp_path / "phone.jpg"
    img.save(src, exif=exif)

    loaded = load_image(src)
    # 90° rotation swaps dimensions -> portrait
    assert loaded.size == (100, 200)  # (W, H) = (100, 200)
    a = np.array(loaded.convert("RGB"))

    def is_red(px):
        return px[0] > 200 and px[1] < 60 and px[2] < 60

    # the red marker should now be at the TOP-RIGHT corner (JPEG-tolerant).
    assert is_red(a[5, -5])
    assert not is_red(a[5, 5])


def test_load_no_exif_is_unchanged(tmp_path):
    src = tmp_path / "plain.png"
    Image.fromarray(np.full((12, 20, 3), 80, dtype=np.uint8), "RGB").save(src)
    assert load_image(src).size == (20, 12)
