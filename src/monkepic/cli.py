from __future__ import annotations

import argparse
import sys

from .pipeline import process_path


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="monkepic", description="Cover faces in a photo with SMB monkes."
    )
    p.add_argument("input", help="photo file or directory")
    p.add_argument("--monkes", default="Argentina Monkes", help="monke pool directory")
    p.add_argument("--monke", default=None, help="force one specific monke for all faces")
    p.add_argument("--out", default="output", help="output directory")
    p.add_argument("--margin", type=float, default=0.4, help="head-box margin")
    p.add_argument("--no-rotate", action="store_true", help="disable 2D roll")
    p.add_argument(
        "--export-crops",
        default=None,
        metavar="DIR",
        help="also write face crops to this directory (e.g. faces/_inbox)",
    )
    p.add_argument("--seed", type=int, default=None, help="RNG seed for selection")
    p.add_argument(
        "--min-confidence", type=float, default=0.5, help="detector threshold"
    )
    return p


def main(argv=None, detector=None) -> int:
    args = build_parser().parse_args(argv)
    if detector is None:
        from .detector import FaceDetector

        detector = FaceDetector(min_confidence=args.min_confidence)

    outputs = process_path(
        args.input,
        args.monkes,
        args.out,
        detector,
        margin=args.margin,
        rotate=not args.no_rotate,
        seed=args.seed,
        crops_dir=args.export_crops,
        forced_monke=args.monke,
    )
    if not outputs:
        print(f"No images found at {args.input}", file=sys.stderr)
        return 1
    for o in outputs:
        print(o)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
