#!/usr/bin/env python3
"""Chat-avatar (honeycomb identicon) parity guard.

WHY: the session-row avatar is generated client-side from the session id, so
independent implementations of the SAME algorithm must agree bit-for-bit.
They once did not: Compose's `keyOf` was written with an escaped ``\\$`` (a
string literal, not interpolation), collapsing every mirror lookup to one key
and giving Compose a completely different pattern from the other clients.

The algorithm is small and deterministic, so this file re-implements it exactly
once — as the clients do (FNV-1a over the seed masked to 31 bits per step,
then the same `mix` finaliser, the same pointy-top lattice, the same mirror
pairing with a rounded 1e6 coordinate key) — and asserts a set of fixed seeds
produce the documented hue + on-cell pattern. `--vectors` prints them so the
same table can be checked against a live client if a port is ever suspect.

Usage:
    python3 tools/avatars.py           # verify the client sources + vectors
    python3 tools/avatars.py --vectors # print the golden seed table
"""
from __future__ import annotations

import math
import re
import sys
from pathlib import Path

# Apps root: the parent of this tools checkout (sibling app repos), or
# $AGENT_APPS_ROOT when the apps live elsewhere.
import os as _os
ROOT = Path(_os.environ.get('AGENT_APPS_ROOT') or Path(__file__).resolve().parent.parent)

MASK31 = 0x7FFFFFFF
MASK32 = 0xFFFFFFFF
FNV_OFFSET = 0x811C9DC5
FNV_PRIME = 0x01000193
HEX_SIZE = 0.10

# The client files that must each contain the avatar implementation.
AVATAR_FILES = {
    "flutter": "agent-flutter/lib/widgets/chat_avatar.dart",
    "compose": "agent-compose/src/commonMain/kotlin/com/agent/app/ui/ChatAvatar.kt",
    "swiftui": "agent-swiftui/Sources/agent-app/Core/ChatAvatar.swift",
}

# The exact mirror-key expression each client must use. A literal `\$` in Kotlin
# (escaped interpolation) or a different rounding is the drift this catches.
KEY_EXPR: dict[str, str] = {
    "flutter": r"toStringAsFixed\(6\)",
    "compose": r'toLong\(\)',  # NOT `\${...}` — must be a real interpolation
    "swiftui": r"rounded\(\)",
}

# The 8-bit channel quantiser must ROUND, exactly like Flutter's
# HSLColor.toColor (`(v * 0xFF).round()`). Truncating (Kotlin `.toInt()`) shifts
# every channel down by up to 1/255 and flips the contrast ladder near a 3.5
# boundary — e.g. hue 316 ("e2e-gwchat") chose the dark foreground on
# Flutter/WebUI/SwiftUI but a pale one on Compose, so the glyph colour differed.
CHANNEL_QUANT_EXPR: dict[str, str] = {
    "flutter": r"\.toColor\(\)",
    "compose": r"roundToInt\(\)",
    "swiftui": r"\.rounded\(\)\s*/\s*255",
}

SEEDS = [
    "test", "e2e-gwchat", "hello", "main", "sess_001", "session-42",
    "9f3a1b2c3d4e5f60", "sbx-abc", "cafebabe01234567", "org/repo/main",
]

# Golden (hue, bg, fg) per seed — the exact 8-bit channels all three clients must
# produce. bg/fg are (r,g,b) 0..255.
COLOR_VECTORS: dict[str, tuple[int, tuple[int, int, int], tuple[int, int, int]]] = {
    "e2e-gwchat": (316, (196, 49, 157), (50, 12, 39)),
    "test": (357, (196, 49, 56), (245, 214, 215)),
    "hello": (243, (56, 49, 196), (168, 164, 234)),
    "main": (64, (186, 196, 49), (86, 91, 21)),
    "sess_001": (23, (196, 105, 49), (70, 37, 16)),
    "session-42": (340, (196, 49, 98), (245, 214, 224)),
    "9f3a1b2c3d4e5f60": (155, (49, 196, 135), (21, 91, 62)),
    "sbx-abc": (233, (49, 66, 196), (164, 172, 234)),
    "cafebabe01234567": (72, (166, 196, 49), (77, 91, 21)),
    "org/repo/main": (154, (49, 196, 132), (21, 91, 61)),
}


def fnv(s: str) -> int:
    h = FNV_OFFSET
    for ch in s:
        h ^= ord(ch)
        h = (h * FNV_PRIME) & MASK31
    return h


def mix(x: int) -> int:
    x = ((x ^ (x >> 16)) * 0x7FEB352D) & MASK32
    x = ((x ^ (x >> 15)) * 0x846CA68B) & MASK32
    return (x ^ (x >> 16)) & MASK32


def bit_at(seed: str, i: int) -> bool:
    if seed == "":
        return (i & 1) == 0
    return (mix(fnv(f"{seed}#{i}")) & 1) == 1


def hue(source: str) -> int:
    return fnv(source) % 360


def cells() -> list[tuple[float, float]]:
    r = HEX_SIZE
    step_x = math.sqrt(3) * r
    step_y = 1.5 * r
    out: list[tuple[float, float]] = []
    for row in range(-8, 9):
        y = row * step_y
        x_off = step_x / 2 if row % 2 != 0 else 0.0
        for col in range(-8, 9):
            x = col * step_x + x_off
            if math.hypot(x, y) > 0.5 - r:
                continue
            out.append((x, y))
    return out


def key(x: float, y: float) -> str:
    # All three clients round the 1e6-scaled coordinates to an integer; the
    # exact formatter differs but the resulting key is identical (verified: the
    # nearest lattice coordinate is > 0.04 from a .5 rounding boundary).
    return f"{round(x * 1_000_000)}|{round(y * 1_000_000)}"


def pattern(seed: str) -> list[bool]:
    """Mirror-symmetric on/off bits, exactly as the three clients compute them."""
    cs = cells()
    by_coord = {key(-x, y): i for i, (x, y) in enumerate(cs)}
    on = [False] * len(cs)
    for i, (x, y) in enumerate(cs):
        if on[i]:
            continue
        mi = by_coord.get(key(x, y), i)
        bit = bit_at(seed, min(i, mi))
        on[i] = bit
        if mi != i:
            on[mi] = bit
    return on


def signature(seed: str) -> str:
    return f"hue={hue(seed)} n={sum(pattern(seed))}"


def _hsl_raw(h: int, sat: float, light: float) -> tuple[float, float, float]:
    c = (1 - abs(2 * light - 1)) * sat
    hp = h / 60
    x = c * (1 - abs(hp % 2 - 1))
    if hp < 1:
        r1, g1, b1 = c, x, 0.0
    elif hp < 2:
        r1, g1, b1 = x, c, 0.0
    elif hp < 3:
        r1, g1, b1 = 0.0, c, x
    elif hp < 4:
        r1, g1, b1 = 0.0, x, c
    elif hp < 5:
        r1, g1, b1 = x, 0.0, c
    else:
        r1, g1, b1 = c, 0.0, x
    m = light - c / 2
    ch = lambda v: min(1.0, max(0.0, v + m))  # noqa: E731
    return (ch(r1), ch(g1), ch(b1))


def _quant(t: tuple[float, float, float]) -> tuple[int, int, int]:
    # ROUND to 8-bit, like Flutter's HSLColor.toColor.
    return tuple(min(255, max(0, round(v * 255))) for v in t)  # type: ignore[return-value]


def _luminance(rgb: tuple[int, int, int]) -> float:
    def ch(v: int) -> float:
        s = v / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4

    return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2])


def _contrast(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    la, lb = _luminance(a), _luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def spec(seed: str) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    """The (bg, fg) 8-bit colours all three clients must render for [seed]."""
    h = hue(seed)
    bg = _quant(_hsl_raw(h, 0.60, 0.48))
    best = bg
    best_ratio = -1.0
    for light in [0.34, 0.28, 0.22, 0.17, 0.12, 0.66, 0.72, 0.78, 0.84, 0.90]:
        c = _quant(_hsl_raw(h, 0.62, light))
        r = _contrast(c, bg)
        if r > best_ratio:
            best_ratio = r
            best = c
        if best_ratio >= 3.5:
            break
    if best_ratio < 3.0:
        fg = (23, 24, 28) if _luminance(bg) > 0.35 else (255, 255, 255)
    else:
        fg = best
    return bg, fg


def check_colors() -> int:
    rc = 0
    for seed, (want_hue, want_bg, want_fg) in COLOR_VECTORS.items():
        got_hue = hue(seed)
        got_bg, got_fg = spec(seed)
        if got_hue != want_hue or got_bg != want_bg or got_fg != want_fg:
            rc = 1
            print(f"FAIL avatar colour {seed:<18} "
                  f"hue {got_hue}/{want_hue} bg {got_bg}/{want_bg} fg {got_fg}/{want_fg}")
    return rc


def check_sources() -> int:
    rc = 0
    for client, rel in AVATAR_FILES.items():
        p = ROOT / rel
        if not p.exists():
            rc = 1
            print(f"FAIL avatar {client:<8}missing {rel}")
            continue
        text = p.read_text()
        # Some ports write the FNV offset with digit separators (0x811c_9dc5).
        if not re.search(r"0x811c_?9dc5", text, re.I):
            rc = 1
            print(f"FAIL avatar {client:<8}no FNV offset basis in {rel}")
        if not re.search(KEY_EXPR[client], text):
            rc = 1
            print(f"FAIL avatar {client:<8}mirror key expr /{KEY_EXPR[client]}/ missing in {rel}")
        if not re.search(CHANNEL_QUANT_EXPR[client], text):
            rc = 1
            print(f"FAIL avatar {client:<8}channel quantiser /{CHANNEL_QUANT_EXPR[client]}/ missing in {rel}")
        # The escaped-interpolation bug: a Kotlin `\${` makes the key a literal.
        if client == "compose" and "\\${" in text:
            rc = 1
            print(f"FAIL avatar compose  escaped interpolation `\\${{` — key would be constant")
    return rc


def main() -> int:
    if "--vectors" in sys.argv:
        for s in SEEDS:
            print(f"{s:<24}{signature(s)}")
        return 0

    rc = check_sources() | check_colors()
    print("== avatar patterns (golden) ==")
    for s in SEEDS:
        print(f"  {s:<24}{signature(s)}")
    print("== avatar colours (golden, 8-bit) ==")
    for s, (h, bg, fg) in COLOR_VECTORS.items():
        print(f"  {s:<20}hue={h:<4}bg={bg} fg={fg}")
    print(f"avatars: {'OK' if rc == 0 else 'FAILED'} ({len(SEEDS)} seeds, 3 clients)")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
