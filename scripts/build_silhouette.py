#!/usr/bin/env python
"""Regenerate the bundled consensus SMB silhouette asset.

The asset (``src/monkepic/assets/smb_silhouette.npz``) is a tiny bit-packed pair of
256x256 boolean masks — ``core`` (pixels almost every monke fills) and ``far`` (pixels
at least a few monkes ever fill) — averaged from the opaque silhouettes of many
solid-background SMB monkes. It encodes the shared SMB head+body shape so that
gradient/checker-background monkes (which the per-image cutout can't fully separate)
get their suit rescued and stray background clipped. See
``monkepic.background.combine_with_silhouette``.

The committed asset contains NO identifiable monke — it is an averaged, abstract
opacity mask. Source monke images are private (not in the repo); pass your own folder.

Usage:
    python scripts/build_silhouette.py <folder-with-monkes> [<folder2> ...]
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

from monkepic import background as bg
from monkepic.loader import SUPPORTED, load_image

OUT = Path(__file__).resolve().parent.parent / "src" / "monkepic" / "assets" / "smb_silhouette.npz"
SIZE = 256


def main(folders: list[str]) -> int:
    if not folders:
        print(__doc__)
        return 2
    solids = []
    for folder in folders:
        for p in sorted(Path(folder).rglob("*")):
            if not (p.is_file() and p.suffix.lower() in SUPPORTED):
                continue
            if p.name.startswith("raw-pic"):  # cropped human faces, not monkes
                continue
            try:
                im = load_image(p)
            except Exception:
                continue
            # Only cleanly-cuttable solid-background monkes feed the consensus shape.
            if not bg.has_alpha(im) and bg.is_solid_background(im):
                solids.append(im)
    if not solids:
        print("no solid-background monkes found in the given folders")
        return 1
    core, far = bg.build_silhouette(solids, size=SIZE)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(OUT, core=np.packbits(core), far=np.packbits(far), size=SIZE)
    print(f"wrote {OUT} from {len(solids)} solid monkes "
          f"(core={int(core.sum())} px, far={int(far.sum())} px, {OUT.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
