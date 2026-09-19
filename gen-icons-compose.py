#!/usr/bin/env python3
"""Render the Compose Multiplatform icon set (Android mipmaps, desktop
.icns/icon.png, wasm web icons + favicon) from the unified mark.

Usage: python3 gen-icons-compose.py <mark> <bg-hex> <compose-app-dir>
"""
import sys
from pathlib import Path
import importlib.util

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("genicons", HERE / "gen-icons.py")
gi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gi)


def main() -> None:
    mark = sys.argv[1].upper()
    bg_hex = sys.argv[2]
    bg = tuple(int(bg_hex.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    app = Path(sys.argv[3])

    def save(path: Path, size: int, maskable: bool = False) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        gi.render(mark, bg, size, maskable).save(path)

    # Android launcher mipmaps (legacy + round-ish via maskable).
    for d, px in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        save(app / f"android/src/main/res/mipmap-{d}/ic_launcher.png", px)
    # Desktop ICNS + PNG (jpackage wants a PNG for linux bundles).
    save(app / "src/desktopMain/resources/app-icon.icns", 1024)
    save(app / "src/desktopMain/resources/icon.png", 256)
    # Web (wasm) icons + favicon.
    for px in (192, 512):
        save(app / f"src/wasmJsMain/resources/icons/Icon-{px}.png", px)
        save(app / f"src/wasmJsMain/resources/icons/Icon-maskable-{px}.png", px, maskable=True)
    save(app / "src/wasmJsMain/resources/favicon.png", 192)
    print(f"wrote Compose icons ({mark}, {bg_hex}) under {app}")


if __name__ == "__main__":
    main()
