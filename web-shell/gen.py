#!/usr/bin/env python3
"""Generate the web shell (index.html + manifest) for every Easy Agent web client
from ONE template.

WHY: Flutter / Compose each hand-maintained their own index.html + manifest,
so they drifted — the installed-PWA safe-area bug (composer and tab bar painted
under the Android gesture bar) shipped in every client because there was no
single place to fix it. This generator owns the shared shell (head,
pre-boot splash, safe-area handling); each app supplies only what genuinely
differs (mark, hue, mount id, boot script).

    tools/web-shell/
      template/index.html.tmpl            shared shell
      template/manifest.webmanifest.tmpl
      apps/<client>.json                  per-app config
      gen.py                              render + --check drift guard

Usage:
    python3 tools/web-shell/gen.py           # (re)generate every target
    python3 tools/web-shell/gen.py --check   # fail if any target is stale
    python3 tools/web-shell/gen.py --only compose-app
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import os as _os
ROOT = Path(_os.environ.get("AGENT_APPS_ROOT") or Path(__file__).resolve().parents[2])
SHELL = Path(__file__).resolve().parent
TEMPLATE = SHELL / "template"
APPS = SHELL / "apps"

TOKEN = re.compile(r"\{\{([A-Z0-9_]+)\}\}")


def render(template: str, vars: dict[str, str]) -> str:
    """Substitute {{TOKEN}}s. An unknown token is a hard error: a typo would
    otherwise leave a literal `{{FOO}}` in a shipped HTML file."""
    missing: list[str] = []

    def sub(m: re.Match[str]) -> str:
        key = m.group(1)
        if key not in vars:
            missing.append(key)
            return m.group(0)
        return vars[key]

    out = TOKEN.sub(sub, template)
    if missing:
        raise SystemExit(f"template references unknown token(s): {sorted(set(missing))}")
    return out


def vars_for(cfg: dict) -> dict[str, str]:
    return {
        "LANG": cfg["lang"],
        "HEAD_TOP": cfg.get("head_top", ""),
        "HEAD_PRE": cfg.get("head_pre", ""),
        "THEME_COLOR": cfg["theme_color"],
        "DESCRIPTION": cfg["description"],
        "FAVICON": cfg["favicon"],
        "APPLE_TOUCH_ICON": cfg["apple_touch_icon"],
        "MANIFEST_LINK": (
            f'\n  <link rel="manifest" href="{cfg["manifest_href"]}" />'
            if cfg.get("manifest_href")
            else ""
        ),
        "APP_TITLE": cfg["app_title"],
        "STATUS_BAR_STYLE": cfg.get("status_bar_style", "black-translucent"),
        "BG_COLOR": cfg["bg_color"],
        "BG_COLOR_DARK": cfg["bg_color_dark"],
        "ROOT_CSS": cfg.get("root_css", ""),
        "MARK": cfg["mark"],        "MARK_COLOR": cfg["mark_color"],
        "BODY": cfg["body"].rstrip("\n"),
    }


def outputs_for(cfg: dict, app_dir: Path) -> dict[Path, str]:
    v = vars_for(cfg)
    out = {app_dir / cfg["index_html"]: render((TEMPLATE / "index.html.tmpl").read_text(), v)}
    if cfg.get("manifest_href"):
        mv = {
            **v,
            "SHORT_NAME": cfg.get("short_name", "Agent"),
            "START_URL": cfg.get("start_url", "."),
            "ICON_DIR": cfg.get("icon_dir", "icons/"),
        }
        out[app_dir / cfg["manifest_path"]] = render(
            (TEMPLATE / "manifest.webmanifest.tmpl").read_text(), mv
        )
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="fail if generated files are stale")
    ap.add_argument("--only", help="only this app config name")
    args = ap.parse_args()

    configs = sorted(APPS.glob("*.json"))
    if not configs:
        raise SystemExit(f"no app configs in {APPS}")

    failures: list[str] = []
    for path in configs:
        cfg = json.loads(path.read_text())
        name = path.stem
        if args.only and name != args.only:
            continue
        app_dir = (ROOT / cfg["dir"]).resolve()
        if not app_dir.is_dir():
            raise SystemExit(f"{name}: dir not found: {app_dir}")
        for out_path, content in outputs_for(cfg, app_dir).items():
            rel = out_path.relative_to(ROOT)
            if args.check:
                current = out_path.read_text() if out_path.exists() else ""
                if current != content:
                    failures.append(str(rel))
            else:
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_text(content)
                print(f"wrote {rel}")

    if args.check:
        if failures:
            print("STALE (run python3 tools/web-shell/gen.py):")
            for f in failures:
                print(f"  - {f}")
            return 1
        print("web-shell: all generated files current")
    return 0


if __name__ == "__main__":
    sys.exit(main())
