#!/usr/bin/env python3
"""Render the full Flutter launcher icon set (Android mipmaps, iOS + macOS
AppIcon.appiconset, Windows .ico, web icons) from the unified mark.

Usage: python3 gen-icons-flutter.py <mark> <bg-hex> <flutter-app-dir>
"""
import sys
from pathlib import Path
from PIL import Image
import importlib.util

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("genicons", HERE / "gen-icons.py")
gi = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gi)


def main() -> None:
    mark = sys.argv[1].upper()
    bg = tuple(int(sys.argv[2].lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    app = Path(sys.argv[3])

    def save(path: Path, size: int, maskable: bool = False) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        gi.render(mark, bg, size, maskable).save(path)

    # Android launcher mipmaps (legacy + round-ish via maskable).
    for d, px in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        save(app / f"android/app/src/main/res/mipmap-{d}/ic_launcher.png", px)
    # Web icons.
    for px in (192, 512):
        save(app / f"web/icons/Icon-{px}.png", px)
        save(app / f"web/icons/Icon-maskable-{px}.png", px, maskable=True)
    save(app / "web/favicon.png", 32)
    # iOS AppIcon.appiconset.
    ios = app / "ios/Runner/Assets.xcassets/AppIcon.appiconset"
    for name, px in {
        "Icon-App-20x20@1x": 20, "Icon-App-20x20@2x": 40, "Icon-App-20x20@3x": 60,
        "Icon-App-29x29@1x": 29, "Icon-App-29x29@2x": 58, "Icon-App-29x29@3x": 87,
        "Icon-App-40x40@1x": 40, "Icon-App-40x40@2x": 80, "Icon-App-40x40@3x": 120,
        "Icon-App-60x60@2x": 120, "Icon-App-60x60@3x": 180,
        "Icon-App-76x76@1x": 76, "Icon-App-76x76@2x": 152,
        "Icon-App-83.5x83.5@2x": 167, "Icon-App-1024x1024@1x": 1024,
    }.items():
        save(ios / f"{name}.png", px)
    # macOS AppIcon.appiconset.
    mac = app / "macos/Runner/Assets.xcassets/AppIcon.appiconset"
    for px in (16, 32, 64, 128, 256, 512, 1024):
        save(mac / f"app_icon_{px}.png", px)
    # Windows .ico.
    gi.render(mark, bg, 256, False).save(
        app / "windows/runner/resources/app_icon.ico",
        format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
    )
    print(f"wrote Flutter icons ({mark}, {sys.argv[2]}) under {app}")


if __name__ == "__main__":
    main()
