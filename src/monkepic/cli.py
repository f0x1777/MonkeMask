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
    p.add_argument(
        "--out",
        default=None,
        help="output directory (default: same folder as the input photo)",
    )
    p.add_argument(
        "--margin",
        type=float,
        default=1.0,
        help="how much bigger than the detected face the monke is (1.0 = ~2x the face box)",
    )
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
    p.add_argument("--match", action="store_true", help="enable identity matching (Phase 3)")
    p.add_argument("--ourmonke", default="OurMonke", help="person/monke library dir")
    p.add_argument("--generic-monke", default="MonkeDAO_DAOJones.png",
                   help="monke for unrecognized faces")
    p.add_argument("--recognition-threshold", type=float, default=0.5,
                   help="min cosine similarity to accept a match")
    p.add_argument("--min-face-ratio", type=float, default=0.35,
                   help="background cutoff vs median face size")
    p.add_argument("--min-face-px", type=int, default=40,
                   help="absolute background cutoff in px")
    p.add_argument("--rebuild-gallery", action="store_true",
                   help="ignore the gallery cache and re-enroll")
    return p


def main(argv=None, detector=None, embedder=None) -> int:
    args = build_parser().parse_args(argv)
    if detector is None:
        from .detector import FaceDetector

        detector = FaceDetector(min_confidence=args.min_confidence)

    if args.match:
        from .embedder import FaceEmbedder
        from .gallery import load_or_build_gallery
        from .loader import list_images
        from .matching import process_image_matched

        if embedder is None:
            embedder = FaceEmbedder()
        gallery = load_or_build_gallery(
            args.ourmonke, embedder, detector, rebuild=args.rebuild_gallery
        )
        if not gallery:
            print("warning: no enrolled persons; all faces -> generic", file=sys.stderr)

        inputs = [p for p in list_images(args.input) if not p.stem.endswith("-monked")]
        if not inputs:
            print(f"No images found at {args.input}", file=sys.stderr)
            return 1
        for p in inputs:
            out = process_image_matched(
                p, gallery, args.generic_monke, args.out, detector, embedder,
                threshold=args.recognition_threshold,
                min_ratio=args.min_face_ratio, min_px=args.min_face_px,
                margin=args.margin, rotate=not args.no_rotate,
                crops_dir=args.export_crops,
            )
            print(out)
        return 0

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
