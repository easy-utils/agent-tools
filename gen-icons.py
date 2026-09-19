#!/usr/bin/env python3
"""Generate the unified EasyLab client icons.

One visual language for every front end: the SAME foreground colour and the
SAME type treatment (DejaVu Sans Bold), differing ONLY in the background hue
and the two-letter mark:

    EF = Flutter   (blue)      EC = Compose (green)
    ES = SwiftUI   (amber)

Layout rule (this is what makes the icons agree visually):
  * the mark is scaled to CONTAIN into a fixed ink box — 0.62 x 0.34 of the
    canvas — so every mark has the same horizontal footprint regardless of how
    wide its glyphs are ("EC" is much wider than "EF" at equal cap height);
  * the ink box is optically centred (crop-to-ink, then centre) so the layout
    does not depend on the font's side bearings;
  * the MASKABLE variant scales that box by 0.80 (Material's safe zone) so an
    adaptive/maskable launcher does not crop the mark, and all clients
    install at the same apparent size.

Usage:
    python3 tools/gen-icons.py <mark> <bg-hex> <out-dir>
Writes icon-192/512 + maskable pair, favicon, Flutter Icon-* aliases, and the
desktop .icns/.ico bundles.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# A MONOSPACE bold face: both letters occupy identical, fixed-width cells, so
# the "A" (and everything after it) sits at exactly the same position in every
# mark. A proportional face cannot guarantee that.
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
# Shared foreground for every client (near-white, matching the app palettes).
FG = (250, 250, 250)
# The mark is fitted by CAP HEIGHT (constant for every client, so the letters
# are visually the SAME SIZE) — not by width. Fitting by width made the wide
# "AW" render with a shorter cap height, i.e. it looked smaller than EF/EC/ES.
CAP_H = 0.30
# Advance-width ceiling: the widest mark ("EC") must still clear the corners.
MAX_ADVANCE = 0.74
# Maskable content scale (Material safe zone: keep content inside the middle
# 80% circle). Applied to BOTH axes around the centre.
MASKABLE_SCALE = 0.80
# Rounded-square corner radius (fraction of canvas) for the "any" variant.
RADIUS_RATIO = 0.22


def _font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    raise SystemExit("no bold sans font found (install dejavu)")


def _cap_height(ss: int) -> int:
    """Ink height of a flat-topped capital, used as the shared scale reference.

    Using the mark's OWN ink height is wrong: the round letters (C, S) overshoot
    the cap line, which changed the scale a hair and pushed their "A" a few
    pixels sideways. A reference glyph keeps every mark on one scale.
    """
    font = _font(int(ss * 0.8))
    scratch = Image.new("RGBA", (ss * 3, ss * 2), (0, 0, 0, 0))
    ImageDraw.Draw(scratch).text((0, 0), "A", font=font, fill=(*FG, 255))
    box = scratch.getbbox()
    if box is None:
        raise SystemExit("empty glyph render")
    return box[3] - box[1]


def _mark_layer(mark: str, ss: int) -> tuple[Image.Image, float, tuple[int, int, int, int]]:
    """Draw the mark at a large reference size.

    Returns (ink image, advance width, ink bbox in glyph coordinates).

    The scratch canvas is deliberately WIDER than it is tall: two bold caps are
    far wider than one em, and drawing them onto an `ss x ss` layer silently
    CLIPPED the right half of the second letter (the corrupt icons).
    """
    font = _font(int(ss * 0.8))
    scratch = Image.new("RGBA", (ss * 3, ss * 2), (0, 0, 0, 0))
    ImageDraw.Draw(scratch).text((0, 0), mark, font=font, fill=(*FG, 255))
    box = scratch.getbbox()
    if box is None:
        raise SystemExit("empty glyph render")
    return scratch.crop(box), font.getlength(mark), box


def render(mark: str, bg: tuple[int, int, int], size: int, maskable: bool) -> Image.Image:
    """One rounded-square icon. `maskable` adds the 80% safe-zone inset."""
    ss = size * 4  # supersample, then downscale for clean edges
    img = Image.new("RGBA", (ss, ss), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle(
        (0, 0, ss - 1, ss - 1), radius=int(ss * RADIUS_RATIO), fill=(*bg, 255)
    )

    glyph, advance, (ink_l, ink_t, ink_r, ink_b) = _mark_layer(mark, ss)
    # Scale by CAP HEIGHT so the letters are the same size in every mark, and
    # clamp the ADVANCE so the widest mark still clears the rounded corners.
    scale = CAP_H * ss / _cap_height(ss)
    scale = min(scale, MAX_ADVANCE * ss / advance)
    if maskable:
        scale *= MASKABLE_SCALE
    w = max(1, round((ink_r - ink_l) * scale))
    h = max(1, round((ink_b - ink_t) * scale))
    glyph = glyph.resize((w, h), Image.LANCZOS)
    # Centre the ADVANCE box horizontally (=> the "A" starts at the same x in
    # every mark, since the monospace cells are fixed-width); the ink is
    # centred vertically.
    x = round((ss - advance * scale) / 2 - ink_l * scale)
    y = (ss - h) // 2
    img.alpha_composite(glyph, (x, y))
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("mark", help="two-letter mark, e.g. AF")
    ap.add_argument("bg", help="background hex, e.g. #2563eb")
    ap.add_argument("out", help="output directory (created if missing)")
    args = ap.parse_args()

    bg = tuple(int(args.bg.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    mark = args.mark.upper()

    for px in (192, 512):
        render(mark, bg, px, False).save(out / f"icon-{px}.png")
        render(mark, bg, px, True).save(out / f"icon-{px}-maskable.png")
    render(mark, bg, 192, False).save(out / "favicon.png")
    # Flutter web icon naming.
    for px in (192, 512):
        render(mark, bg, px, False).save(out / f"Icon-{px}.png")
        render(mark, bg, px, True).save(out / f"Icon-maskable-{px}.png")
    # Desktop/bundle formats: macOS .icns and Windows .ico.
    render(mark, bg, 1024, False).save(
        out / "app-icon.icns",
        format="ICNS",
        sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512)],
    )
    render(mark, bg, 256, False).save(
        out / "icon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)]
    )
    print(f"wrote {mark} ({args.bg}) -> {out}")


if __name__ == "__main__":
    main()
