from __future__ import annotations

from PIL import Image

from .types import Placement


def composite(base: Image.Image, monke: Image.Image, placement: Placement) -> Image.Image:
    """Scale + rotate the (RGBA) monke and alpha-blend it onto base, centered at
    (placement.cx, placement.cy). Returns an RGBA copy of base."""
    canvas = base.convert("RGBA")
    m = monke.convert("RGBA").resize((placement.w, placement.h), Image.LANCZOS)
    if placement.roll_deg:
        # PIL rotates counter-clockwise for positive angles; negate so a positive
        # roll (right eye lower) tilts the monke the same way as the head.
        m = m.rotate(-placement.roll_deg, expand=True, resample=Image.BICUBIC)
    left = int(round(placement.cx - m.width / 2))
    top = int(round(placement.cy - m.height / 2))
    canvas.alpha_composite(m, (left, top))
    return canvas
