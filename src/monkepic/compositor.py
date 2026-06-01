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
    # Never let the monke be clipped by the canvas edge: slide it back inside so
    # the whole monke stays visible (it is much larger than the face, so it still
    # covers it). If the monke is larger than the canvas, center it instead.
    if m.width <= canvas.width:
        left = max(0, min(left, canvas.width - m.width))
    else:
        left = (canvas.width - m.width) // 2
    if m.height <= canvas.height:
        top = max(0, min(top, canvas.height - m.height))
    else:
        top = (canvas.height - m.height) // 2
    canvas.alpha_composite(m, (left, top))
    return canvas
