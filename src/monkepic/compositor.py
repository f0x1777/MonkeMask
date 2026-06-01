from __future__ import annotations

from PIL import Image

from .types import Placement


def composite(base: Image.Image, monke: Image.Image, placement: Placement,
              clamp: bool = True) -> Image.Image:
    """Scale + rotate the (RGBA) monke and alpha-blend it onto base, centered at
    (placement.cx, placement.cy). Returns an RGBA copy of base.

    ``clamp`` (default True) keeps the whole monke inside the canvas by sliding it
    back in when an edge would clip it — used for automatic placement. Set it to
    False for a manual user move: the monke stays exactly where placed and any part
    beyond the edge is simply cropped (PIL clips the paste), so dragging toward a
    border actually moves it off-screen instead of snapping it back inside."""
    canvas = base.convert("RGBA")
    m = monke.convert("RGBA").resize((placement.w, placement.h), Image.LANCZOS)
    if placement.roll_deg:
        # PIL rotates counter-clockwise for positive angles; negate so a positive
        # roll (right eye lower) tilts the monke the same way as the head.
        m = m.rotate(-placement.roll_deg, expand=True, resample=Image.BICUBIC)
    left = int(round(placement.cx - m.width / 2))
    top = int(round(placement.cy - m.height / 2))
    if clamp:
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
