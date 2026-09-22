#!/usr/bin/env python3
"""Behavioural conformance governance for the Easy Agent clients.

WHY: every other guard in this directory compares SOURCE STRINGS (page keys,
icon slots, i18n keys) — none can tell whether a client's message state machine
actually BEHAVES like the reference (webui). This tool owns one scenario
manifest (`conformance/scenarios.json`) and asserts that every full client's
native message-state-machine suite covers every scenario id. The assertions
themselves are written in each client's own test language (the controllers are
typed per language), but the LIST of behaviours is shared and drift-checked, so
a scenario cannot be silently dropped from one client.

    conformance/
      scenarios.json   the shared scenario manifest (edit here)
      conformance.py   this guard: --list / --check / --emit

`--check` fails if any client's suite is missing a scenario id.

Usage:
    python3 conformance.py            # --check
    python3 conformance.py --list     # print the scenario ids
"""
from __future__ import annotations

import argparse
import json
import os as _os
import sys
from pathlib import Path

ROOT = Path(_os.environ.get("AGENT_APPS_ROOT") or Path(__file__).resolve().parent.parent)
MANIFEST = Path(__file__).resolve().parent / "conformance" / "scenarios.json"

# client -> the test file whose body must reference every scenario id.
SUITES: dict[str, str] = {
    "compose": "agent-compose/src/desktopTest/kotlin/com/agent/app/ConformanceTest.kt",
    "flutter": "agent-flutter/test/messages_conformance_test.dart",
    "swiftui": "agent-swiftui/Tests/AgentAppTests/MessagesConformanceTests.swift",
}
# The manifest is vendored next to the Swift suite (SwiftPM resources).
SWIFT_MANIFEST = "agent-swiftui/Tests/AgentAppTests/scenarios.json"


def ids() -> list[str]:
    return [s["id"] for s in json.loads(MANIFEST.read_text())["scenarios"]]


def check() -> int:
    rc = 0
    want = ids()
    print(f"== behavioural conformance ({len(want)} scenarios) ==")
    for client, rel in SUITES.items():
        p = ROOT / rel
        if not p.exists():
            print(f"FAIL {client:<9} missing suite {rel}")
            rc = 1
            continue
        text = p.read_text()
        missing = [i for i in want if i not in text]
        if missing:
            print(f"FAIL {client:<9} suite missing scenarios: {' '.join(missing)}")
            rc = 1
    # The Swift suite's manifest must be the vendored copy (drift-checked).
    sp = ROOT / SWIFT_MANIFEST
    if not sp.exists():
        print(f"FAIL swiftui   missing vendored manifest {SWIFT_MANIFEST}")
        rc = 1
    elif sp.read_text() != MANIFEST.read_text():
        print(f"FAIL swiftui   stale vendored manifest (run --emit)")
        rc = 1
    if rc == 0:
        print(f"conformance: OK ({len(SUITES)} clients x {len(want)} scenarios)")
    return rc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if args.list:
        for i in ids():
            print(i)
        return 0
    return check()


if __name__ == "__main__":
    raise SystemExit(main())
