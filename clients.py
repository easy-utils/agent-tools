#!/usr/bin/env python3
"""Cross-client identity guard for the eight Easy Agent apps.

WHY: the apps are written in eight languages and live in eight repos, so brand
strings, the default gateway host and the "cross-repo deps must be tagged, never
local paths" rule drift silently. This guard pins the handful of facts that must
be identical everywhere:

  1. every app repo exists;
  2. the display name is exactly "Easy Agent";
  3. the default gateway host is the SAME canonical host on every client (a
     stale host once survived in five of them after the ingress moved);
  4. no client depends on a sibling checkout through a local `path:` — all
     easy-utils deps are tagged/registry references.

Usage:
    python3 tools/clients.py            # check (exit 1 on drift)
    python3 tools/clients.py --list     # print the client table
"""
from __future__ import annotations

import os as _os
import re
import sys
from pathlib import Path

ROOT = Path(_os.environ.get('AGENT_APPS_ROOT') or Path(__file__).resolve().parent.parent)

# The single canonical default gateway. The ingress moved twice; older
# checkouts kept `standalone-agent.temp...` / `agent.temp...`, both of which
# now answer 502.
DEFAULT_HOST = "agent.agent.10.199.64.20.nip.io"
STALE_HOSTES = (
    "standalone-agent.temp.10.199.64.20.nip.io",
    "agent.temp.10.199.64.20.nip.io",
)

APP_NAME = "Easy Agent"

# client -> dict(repo, title=[(rel, regex)], base=[rel], deps=[rel], soft?)
# `base` files must carry DEFAULT_HOST; a client with no default (Flutter, which
# starts from an empty backend list / AGENT_BASE_URL) lists none.
# `soft` clients are upstream (webui): findings are WARN-only.
# `repo` may be absolute (the read-only webui snapshot).
WEBUI_SNAPSHOT = Path(__file__).resolve().parent / "webui-snapshot"
CLIENTS: dict[str, dict] = {
    "flutter": {
        "repo": "agent-flutter",
        "title": [("l10n/app_en.arb", r'"appTitle"\s*:\s*"Easy Agent"')],
        "base": ["lib/prefs.dart"],
        "deps": ["pubspec.yaml"],
    },
    "compose": {
        "repo": "agent-compose",
        "title": [("build.gradle.kts", r'packageName\s*=\s*"Easy Agent"')],
        "base": [
            "src/androidMain/kotlin/com/agent/app/platform/Android.platform.kt",
            "src/desktopMain/kotlin/com/agent/app/platform/Desktop.platform.kt",
            "src/wasmJsMain/kotlin/com/agent/app/platform/Web.platform.kt",
        ],
        "deps": ["build.gradle.kts", "settings.gradle.kts"],
    },
    "swiftui": {
        "repo": "agent-swiftui",
        "title": [("tool/Info-ios.plist", r"<string>Easy Agent</string>")],
        "base": ["Sources/agent-app/Core/Prefs.swift"],
        "deps": ["Package.swift"],
    },
    "fyne": {
        "repo": "agent-fyne",
        "title": [("ui.go", r'appTitle\s*=\s*"Easy Agent"')],
        "base": ["ui.go"],
        "deps": ["go.mod"],
    },
    "slint": {
        "repo": "agent-slint",
        "title": [("ui/app.slint", r'title:\s*"Easy Agent"')],
        "base": ["ui/app.slint"],
        "deps": ["Cargo.toml"],
    },
    "pyside": {
        "repo": "agent-pyside",
        "title": [("agent_pyside/app.py", r'setWindowTitle\("Easy Agent"\)')],
        "base": ["agent_pyside/app.py"],
        "deps": ["pyproject.toml"],
    },
    "reactnative": {
        "repo": "agent-reactnative",
        "title": [("app.json", r'"name"\s*:\s*"Easy Agent"')],
        "base": ["src/screens/ConnectScreen.tsx"],
        "deps": ["package.json"],
    },
    "maui": {
        "repo": "agent-maui",
        "title": [("Easy.Agent.csproj", r"<ApplicationTitle>Easy Agent</ApplicationTitle>")],
        "base": ["Views/ConnectPage.cs"],
        "deps": ["Easy.Agent.csproj"],
    },
    # Upstream (read-only snapshot): soft. The webui is served same-origin so it
    # has no gateway default, and its own title is "ABCP Agent" (not ours to
    # change); we only pin the dependency rule + that it is present.
    "webui": {
        "repo": str(WEBUI_SNAPSHOT),
        "soft": True,
        "title": [],
        "base": [],
        "deps": ["package.json"],
    },
}

# Local-path dependency smells: a cross-repo reference that escapes THIS repo,
# or a build/compose that pulls a sibling checkout in. A SwiftPM/Cargo `path:`
# naming the package's own target (e.g. `path: "Sources/app"`) is legitimate and
# NOT matched — only paths escaping upward are.
LOCAL_DEP = re.compile(
    r'(path:\s*["\']?\.\.)'          # SwiftPM path: "../sibling"
    r'|(\bpath\s*=\s*["\']\.\.)'      # Cargo path = "../sibling"
    r'|(=>\s*\.\./)'                  # go replace => ../sibling
    r'|(["\' ]file:\.\./)'            # npm file:../sibling
    r'|(["\' ]link:)'                 # npm link:
    r'|(includeBuild)'                # Gradle included build
)


def check() -> int:
    rc = 0
    for client, spec in CLIENTS.items():
        soft = spec.get("soft", False)
        tag = "WARN" if soft else "FAIL"
        rp = Path(spec["repo"])
        repo = rp if rp.is_absolute() else ROOT / rp
        if not repo.is_dir():
            print(f"{tag} {client:<12}missing repo {spec['repo']}")
            if not soft:
                rc = 1
            continue

        def bad(msg: str):
            nonlocal rc
            print(f"{tag} {client:<12}{msg}")
            if not soft:
                rc = 1

        for rel, pat in spec["title"]:
            p = repo / rel
            if not p.exists() or not re.search(pat, p.read_text(errors="ignore")):
                bad(f"title missing in {rel}")

        for rel in spec["base"]:
            p = repo / rel
            if not p.exists():
                bad(f"missing {rel}")
                continue
            text = p.read_text(errors="ignore")
            for stale in STALE_HOSTES:
                if stale in text:
                    bad(f"stale host {stale} in {rel}")
            if DEFAULT_HOST not in text:
                bad(f"canonical host absent from {rel}")

        for rel in spec["deps"]:
            p = repo / rel
            if not p.exists():
                bad(f"missing {rel}")
                continue
            for i, line in enumerate(p.read_text(errors="ignore").splitlines(), 1):
                if LOCAL_DEP.search(line):
                    bad(f"local-path dep in {rel}:{i}: {line.strip()}")

    return rc


def main() -> int:
    if "--list" in sys.argv:
        for c, s in CLIENTS.items():
            print(f"{c:<12}{s['repo']:<22}title={len(s['title'])} base={len(s['base'])}")
        return 0
    rc = check()
    print(f"clients: {'OK' if rc == 0 else 'FAILED'} ({len(CLIENTS)} apps, "
          f"host={DEFAULT_HOST})")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
