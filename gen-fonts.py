#!/usr/bin/env python3
"""Generate the four clients' static UI fonts from the single variable source.

WHY: all four clients must rasterize the same glyphs, but the variable
`NotoSansSC.ttf` defaults to its **Thin (wght=100)** instance, and the four
engines disagree about how to select a named instance / synthesize bold:

  * Flutter  -> rendered Thin because no `fontVariations` was set
  * WebUI    -> CSS `font-weight: 100 900` worked, but variable-axis rendering
               differs from the engines that cannot do it
  * Compose  -> Skia never even loaded the file (no Compose FontFamily existed)
  * SwiftUI  -> CoreText does not drive variable axes through `Font.custom`

Instancing the axis into plain Regular(400)/SemiBold(600) statics removes the
ambiguity: every engine picks the same outlines for the same `font-weight`.

Usage:
    python3 tools/gen-fonts.py [outdir]

Inputs (preferred order):
    ~/abcp-sdk/agent-flutter/assets/fonts/NotoSansSC.ttf   (variable, CJK subset)
    <outdir>/src/mono/NotoSansMono-*.ttf             (already-static mono)

Outputs, per family, with a normalized `name` table so `Font.custom` /
CSS `font-family` / Flutter `family:` all resolve to one family + two weights:
    NotoSansSC-Regular.ttf   NotoSansSC-SemiBold.ttf
    NotoSansMono-Regular.ttf NotoSansMono-SemiBold.ttf
"""

import os
import shutil
import subprocess
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

VAR_SANS = os.path.join(ROOT, "agent-flutter/assets/fonts/NotoSansSC.ttf")

# Static mono sources: fetched once and cached here so the generator is
# reproducible without network access on later runs.
MONO_CACHE = "/tmp/opencode/noto-mono"
MONO_SRC = {
    400: "NotoSansMono-Regular.ttf",
    600: "NotoSansMono-SemiBold.ttf",
}
MONO_URL = (
    "https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/"
    "fonts/NotoSansMono/hinted/ttf/{}"
)

# (family, weight, subfamily, postscript name)
FAMILIES = {
    "NotoSansSC": [(400, "Regular"), (600, "SemiBold")],
    "NotoSansMono": [(400, "Regular"), (600, "SemiBold")],
}


def set_names(font: TTFont, family: str, weight: int, style: str) -> None:
    """Normalize the name table so both weights share ONE family."""
    full = f"{family} {style}"
    ps = f"{family}-{style}"
    win = {
        1: family, 2: style, 3: f"{ps};{weight}", 4: full,
        6: ps, 16: family, 17: style,
    }
    mac = {1: family, 2: style, 3: f"{ps};{weight}", 4: full, 6: ps}
    name = font["name"]
    for nid, value in win.items():
        name.setName(value, nid, 3, 1, 0x409)
    for nid, value in mac.items():
        name.setName(value, nid, 1, 0, 0)
    font["OS/2"].usWeightClass = weight
    # fsSelection / head.macStyle must agree with the weight: REGULAR (bit 6)
    # only for 400, BOLD (bit 5) only for >=700 (no SemiBold here).
    fs = font["OS/2"].fsSelection & ~0b1100000
    if weight == 400:
        fs |= 0b1000000
    font["OS/2"].fsSelection = fs
    font["head"].macStyle = 0



def instance_sans(weight: int) -> TTFont:
    src = TTFont(VAR_SANS)
    out = instancer.instantiateVariableFont(
        src, {"wght": weight}, inplace=False, optimize=True
    )
    return out


def mono_path(weight: int) -> str:
    os.makedirs(MONO_CACHE, exist_ok=True)
    dest = os.path.join(MONO_CACHE, MONO_SRC[weight])
    if not os.path.exists(dest):
        url = MONO_URL.format(MONO_SRC[weight])
        print(f"  fetching {url}")
        subprocess.check_call(["curl", "-sS", "--max-time", "60", "-o", dest, "-L", url])
    return dest


def main() -> int:
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "tools/fonts")
    os.makedirs(outdir, exist_ok=True)
    made = []

    for family, weights in FAMILIES.items():
        for weight, style in weights:
            if family == "NotoSansSC":
                font = instance_sans(weight)
            else:
                font = TTFont(mono_path(weight))
            set_names(font, family, weight, style)
            dest = os.path.join(outdir, f"{family}-{style}.ttf")
            font.save(dest)
            made.append((dest, os.path.getsize(dest)))
            print(f"  {dest}  {os.path.getsize(dest)/1e6:.2f} MB")

    print("generated:")
    for path, size in made:
        print(f"  {path}  {size} bytes")
    total = sum(s for _, s in made)
    print(f"total {total/1e6:.2f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
