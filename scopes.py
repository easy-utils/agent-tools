#!/usr/bin/env python3
"""Connection-scope parity guard.

WHY: every per-connection cache (the sqlite mirror + read watermarks) is keyed
by `scopeOf(baseUrl, token)` so two users / tenants on one device never share
state. The clients each implement that hash independently, so this file
pins the algorithm and a golden vector table; `--check` asserts the same
expression is present in each client's source.

The algorithm is djb2 mod 2^31 over the UTF-8 bytes of `<baseUrl>\n<token>`,
written so every intermediate stays below 2^53 (float-exact on the web too).

Usage:
    python3 tools/scopes.py            # verify sources + golden vectors
    python3 tools/scopes.py --vectors  # print the golden table
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# Apps root: the parent of this tools checkout (sibling app repos), or
# $AGENT_APPS_ROOT when the apps live elsewhere.
import os as _os
ROOT = Path(_os.environ.get('AGENT_APPS_ROOT') or Path(__file__).resolve().parent.parent)

SCOPE_FILES = {
    "flutter": "agent-flutter/lib/scope.dart",
    "compose": "agent-compose-app/src/commonMain/kotlin/com/agent/app/Scope.kt",
    "swiftui": "agent-swiftui-app/Sources/agent-app/Core/Scope.swift",
}
# Each client's hash initializer + mask (the shared shape; only the syntax
# differs).
SCOPE_SHAPE = {
    "flutter": r"5381.*?0x7fffffff",
    "compose": r"5381.*?0x7fffffff",
    "swiftui": r"5381.*?0x7fff_ffff",
}

VECTORS = [
    ("https://gw.example", "tok-a", "1a5c49ae"),
    ("https://gw.example", "tok-b", "1a5c49af"),
    ("https://other.example", "tok-a", "703e44b2"),
    ("http://127.0.0.1:8096", "devtoken", "1747a8ed"),
]


def scope_of(base: str, token: str) -> str:
    h = 5381
    for b in f"{base}\n{token}".encode():
        h = ((h * 33) + b) & 0x7FFFFFFF
    return format(h, "08x")


def check_sources() -> int:
    rc = 0
    for client, rel in SCOPE_FILES.items():
        p = ROOT / rel
        if not p.exists():
            rc = 1
            print(f"FAIL scope {client:<8}missing {rel}")
            continue
        text = p.read_text()
        if not re.search(SCOPE_SHAPE[client], text, re.S):
            rc = 1
            print(f"FAIL scope {client:<8}hash shape missing in {rel}")
    return rc


def main() -> int:
    rc = check_sources()
    if "--vectors" in sys.argv:
        for base, tok, exp in VECTORS:
            print(f"{scope_of(base, tok)}  {base} {tok}")
        return rc
    print("== connection scopes (golden) ==")
    for base, tok, exp in VECTORS:
        got = scope_of(base, tok)
        mark = "OK" if got == exp else f"FAIL expected {exp}"
        print(f"  {base:<26}{tok:<12}{got}  {mark}")
        if got != exp:
            rc = 1
    print(f"scopes: {'OK' if rc == 0 else 'FAILED'} ({len(VECTORS)} vectors, 3 clients)")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
