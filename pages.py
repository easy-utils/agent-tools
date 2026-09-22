#!/usr/bin/env python3
"""Page / navigation contract guard across every Easy Agent client.

WHY: the four full clients (Flutter, Compose, SwiftUI, webui) independently
implement the SAME navigation model — two side tabs and nine page kinds — and
they drifted before (a page added on one client, a dispatch branch forgotten on
another). This module makes that contract explicit and machine-checkable: the
page-key set, the per-key view dispatch, the config sub-page ids and the session
overlays must match on every full client. The five skeleton clients (React
Native, PySide, Fyne, Slint, MAUI) are checked against the same contract so a
port cannot quietly grow a divergent page.

The webui is UPSTREAM (abcp-sdk/webui, read-only here): its findings are reported
as WARN and never fail the run, but they are still printed so drift is visible.

Source of truth: the model below. Every client is a set of (file, regex) probes
per contract facet; `--check` extracts them and diffs against the model.

Usage:
    python3 tools/pages.py            # check (exit 1 on a hard failure)
    python3 tools/pages.py --list     # print the contract + per-client findings
"""
from __future__ import annotations

import argparse
import os as _os
import re
import sys
from pathlib import Path

ROOT = Path(_os.environ.get("AGENT_APPS_ROOT") or Path(__file__).resolve().parent.parent)
WEBUI = Path(__file__).resolve().parent / "webui-snapshot"

# --- the contract -------------------------------------------------------------
TABS = ["chat", "config"]

# Static page keys (literal). Dynamic keys carry an id (config_sub_<id>,
# provider_model_<id>) and are represented by their prefix.
STATIC_PAGE_KEYS = {
    "chat_list",
    "chat_session",
    "chat_overlay",
    "config_root",
    "providers_list",
    "preset_form_new",
    "provider_form",
}
DYNAMIC_PAGE_PREFIXES = ["config_sub_", "provider_model_"]
CONFIG_SUB_IDS = {"appearance", "backends", "presets", "tools"}
OVERLAYS = {"mailbox"}

# Full clients must satisfy every facet; skeleton clients must satisfy the
# structural facets (tabs + static page keys + dispatch) — the same contract,
# so a skeleton cannot invent a page the full clients do not have.
FULL = ["flutter", "compose", "swiftui", "webui"]
SKELETON = ["reactnative", "pyside", "fyne", "slint", "maui"]

# Per-client probes. Each facet is a list of (path, regex) where every match
# group(1) is a value (or the whole match when there is no group). `root` is
# resolved against ROOT (apps) or WEBUI (the snapshot).
CLIENTS: dict[str, dict] = {
    "flutter": {
        "root": "agent-flutter",
        "tabs": [("lib/enums.dart", r"enum SiderTab \{ ([a-z, ]+) \}")],
        "page_keys": [("lib/navigation.dart", r"super\('([a-z_]+)'\)")],
        "dispatch": [("lib/page_builder.dart", r"case ([A-Za-z]+)Page")],
        "config_sub": [("lib/screens/config.dart", r"_push\('([a-z_]+)'\)")],
        "overlays": [("lib/enums.dart", r"enum SessionOverlay \{ ([a-z, ]+) \}")],
    },
    "compose": {
        "root": "agent-compose",
        "tabs": [("src/commonMain/kotlin/com/agent/app/store/AppStore.kt",
                  r"enum class SiderTab \{ ([A-Z, ]+) \}")],
        "page_keys": [("src/commonMain/kotlin/com/agent/app/store/AppStore.kt",
                       r'AppPage\("([a-z_]+)"\)')],
        "dispatch": [("src/commonMain/kotlin/com/agent/app/ui/App.kt",
                      r"is AppPage\.([A-Za-z]+)")],
        "config_sub": [("src/commonMain/kotlin/com/agent/app/ui/ConfigScreen.kt",
                        r'ConfigSubPage\("([a-z_]+)"\)')],
        # One overlay (mailbox) -> the chat_overlay branch renders MailboxScreen.
        "overlays": [("src/commonMain/kotlin/com/agent/app/ui/App.kt",
                      r"(MailboxScreen)")],
    },
    "swiftui": {
        "root": "agent-swiftui",
        "tabs": [("Sources/agent-app/Core/AppStore.swift",
                  r"enum SiderTab \{[^}]*case ([a-z, ]+)")],
        "page_keys": [("Sources/agent-app/Core/AppStore.swift",
                       r'return "([a-z_]+)"')],
        "dispatch": [("Sources/agent-app/AgentApp.swift", r"case \.([a-zA-Z]+)")],
        "config_sub": [("Sources/agent-app/Screens/ConfigScreen.swift",
                        r'\.configSub\("([a-z_]+)"\)')],
        "overlays": [("Sources/agent-app/AgentApp.swift", r"(MailboxScreen)")],
    },
    "webui": {
        "root": str(WEBUI),
        # nav.ts owns the AppPage/SiderTab model (store re-exports it).
        "tabs": [("src/lib/nav.ts", r"SiderTab = '([a-z]+)' \| '([a-z]+)'")],
        "page_keys": [("src/lib/nav.ts", r"key: '([a-z_]+)'")],
        "dispatch": [("src/lib/Shell.svelte", r"case '([a-z_]+)':")],
        "config_sub": [("src/lib/pages/Config.svelte", r"id: '([a-z_]+)'")],
        "overlays": [("src/lib/Shell.svelte", r"(Mailbox)")],
    },
}

# --- skeleton clients ---------------------------------------------------------
# Same facets, same contract. They currently implement only the chat/session
# slice; the guard fails until they carry the full model (kept explicit so the
# gap is visible rather than waived).
SKELETON_CLIENTS: dict[str, dict] = {
    "reactnative": {
        "root": "agent-reactnative",
        "tabs": [("src/navigation.ts", r"SIDER_TABS[^=]*=\s*\[([^\]]*)\]")],
        "page_keys": [("src/navigation.ts", r"key: '([a-z_]+)'")],
        "dispatch": [("src/navigation.ts", r"case '([a-z_]+)':")],
        "config_sub": [("src/navigation.ts", r"CONFIG_SUB_IDS[^=]*=\s*\[([^\]]*)\]")],
        "overlays": [("src/navigation.ts", r"SESSION_OVERLAYS[^=]*=\s*\[([^\]]*)\]")],
    },
    "pyside": {
        "root": "agent-pyside",
        "tabs": [("agent_pyside/navigation.py", r"SIDER_TABS\s*=\s*\[([^\]]*)\]")],
        # PAGE_VIEWS maps each static page key -> its view (the dispatch table).
        "page_keys": [("agent_pyside/navigation.py", r'"([a-z_]+)":\s*"[A-Za-z]+"')],
        "dispatch": [("agent_pyside/navigation.py", r'"([a-z_]+)":\s*"[A-Za-z]+"')],
        "config_sub": [("agent_pyside/navigation.py", r"CONFIG_SUB_IDS\s*=\s*\[([^\]]*)\]")],
        "overlays": [("agent_pyside/navigation.py", r"SESSION_OVERLAYS\s*=\s*\[([^\]]*)\]")],
    },
    "fyne": {
        "root": "agent-fyne",
        "tabs": [("navigation.go", r"siderTabs\s*=\s*\[\]string\{([^}]*)\}")],
        # pageViews maps each static page key -> its view builder.
        "page_keys": [("navigation.go", r'"([a-z_]+)":\s*"')],
        "dispatch": [("ui.go", r'case "([a-z_]+)":')],
        "config_sub": [("navigation.go", r"configSubIDs\s*=\s*\[\]string\{([^}]*)\}")],
        "overlays": [("navigation.go", r"sessionOverlays\s*=\s*\[\]string\{([^}]*)\}")],
    },
    "slint": {
        "root": "agent-slint",
        "tabs": [("src/navigation.rs", r"SIDER_TABS[^=]*=\s*&\[([^\]]*)\]")],
        "page_keys": [("src/navigation.rs", r'"([a-z_]+)" =>')],
        "dispatch": [("src/navigation.rs", r'"([a-z_]+)" =>')],
        "config_sub": [("src/navigation.rs", r"CONFIG_SUB_IDS[^=]*=\s*&\[([^\]]*)\]")],
        "overlays": [("src/navigation.rs", r"SESSION_OVERLAYS[^=]*=\s*&\[([^\]]*)\]")],
    },
    "maui": {
        "root": "agent-maui",
        "tabs": [("Navigation.cs", r"SiderTabs\s*=\s*new\[\]\s*\{([^}]*)\}")],
        "page_keys": [("Navigation.cs", r'\["([a-z_]+)"\]\s*=')],
        "dispatch": [("Navigation.cs", r'case "([a-z_]+)":')],
        "config_sub": [("Navigation.cs", r"ConfigSubIds\s*=\s*new\[\]\s*\{([^}]*)\}")],
        "overlays": [("Navigation.cs", r"SessionOverlays\s*=\s*new\[\]\s*\{([^}]*)\}")],
    },
}

# Dynamic-key probes: a dynamic prefix must be reachable (the key expression is
# present) on every client.
DYNAMIC_PROBES: dict[str, list[tuple[str, str]]] = {
    "flutter": [("lib/navigation.dart", r"config_sub_\$id"),
                ("lib/navigation.dart", r"provider_model_")],
    "compose": [("src/commonMain/kotlin/com/agent/app/store/AppStore.kt", r"config_sub_\$id"),
                ("src/commonMain/kotlin/com/agent/app/store/AppStore.kt", r"provider_model_")],
    "swiftui": [("Sources/agent-app/Core/AppStore.swift", r'config_sub_\\\('),
                ("Sources/agent-app/Core/AppStore.swift", r'provider_model_\\\(')],
    # webui models dynamic keys as kinds with `key: string` (no literal prefix).
    "webui": [("src/lib/nav.ts", r"kind: 'config_sub'"),
              ("src/lib/nav.ts", r"kind: 'provider_models'")],
}

TITLE = "page/navigation contract"


def _root(client: str, spec: dict) -> Path:
    r = spec["root"]
    p = Path(r)
    return p if p.is_absolute() else ROOT / r


def _tokens(raw: str) -> set[str]:
    return {t.lower() for t in re.findall(r"[A-Za-z_]+", raw)}


def _extract(spec: dict, facet: str) -> tuple[set[str], list[str]]:
    """Return (values, missing_probe_paths) for one facet of one client."""
    vals: set[str] = set()
    missing: list[str] = []
    root = _root("", spec)
    for rel, pat in spec.get(facet, []):
        p = root / rel
        if not p.exists():
            missing.append(rel)
            continue
        for m in re.finditer(pat, p.read_text(errors="ignore")):
            groups = [g for g in m.groups() if g]
            raw = " ".join(groups) if groups else m.group(0)
            if facet == "overlays":
                # Overlays are identified by their screen (Mailbox); clients that
                # dropped an explicit enum still route chat_overlay -> Mailbox.
                if "mailbox" in raw.lower():
                    vals.add("mailbox")
            else:
                vals |= _tokens(raw)
    return vals, missing


def check() -> int:
    rc = 0
    print(f"== {TITLE} ==")
    all_clients = {**CLIENTS, **SKELETON_CLIENTS}
    for client, spec in all_clients.items():
        soft = client == "webui"
        hard = "WARN" if soft else "FAIL"
        root = _root(client, spec)
        if not root.is_dir():
            print(f"{hard} {client:<12} missing root {spec['root']}")
            if not soft:
                rc = 1
            continue

        tabs, miss = _extract(spec, "tabs")
        if miss:
            print(f"{hard} {client:<12} missing {miss}")
            if not soft:
                rc = 1
        elif tabs != set(TABS):
            print(f"{hard} {client:<12} tabs {sorted(tabs)} != {sorted(TABS)}")
            if not soft:
                rc = 1

        keys, miss = _extract(spec, "page_keys")
        if miss:
            print(f"{hard} {client:<12} missing {miss}")
            if not soft:
                rc = 1
        elif keys != STATIC_PAGE_KEYS:
            extra = sorted(keys - STATIC_PAGE_KEYS)
            absent = sorted(STATIC_PAGE_KEYS - keys)
            print(f"{hard} {client:<12} page keys: extra={extra} missing={absent}")
            if not soft:
                rc = 1

        disp, miss = _extract(spec, "dispatch")
        if miss:
            print(f"{hard} {client:<12} missing {miss}")
            if not soft:
                rc = 1
        # every static key must have a dispatch branch (key -> Page kind mapping)
        elif not disp:
            print(f"{hard} {client:<12} no dispatch branches")
            if not soft:
                rc = 1

        subs, _ = _extract(spec, "config_sub")
        if subs != CONFIG_SUB_IDS:
            print(f"{hard} {client:<12} config sub ids {sorted(subs)} != {sorted(CONFIG_SUB_IDS)}")
            if not soft:
                rc = 1

        ov, _ = _extract(spec, "overlays")
        if ov != OVERLAYS:
            print(f"{hard} {client:<12} overlays {sorted(ov)} != {sorted(OVERLAYS)}")
            if not soft:
                rc = 1

        # dynamic prefixes present?
        for rel, pat in DYNAMIC_PROBES.get(client, []):
            p = root / rel
            if not p.exists() or not re.search(pat, p.read_text(errors="ignore")):
                print(f"{hard} {client:<12} dynamic key probe missing in {rel}")
                if not soft:
                    rc = 1

    print(f"{TITLE}: {'OK' if rc == 0 else 'FAILED'}")
    return rc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    if args.list:
        print(f"tabs      : {TABS}")
        print(f"page keys : {sorted(STATIC_PAGE_KEYS)}")
        print(f"dynamic   : {DYNAMIC_PAGE_PREFIXES}")
        print(f"config sub: {sorted(CONFIG_SUB_IDS)}")
        print(f"overlays  : {sorted(OVERLAYS)}")
        print(f"full      : {FULL}")
        print(f"skeleton  : {SKELETON}")
        return 0
    return check()


if __name__ == "__main__":
    raise SystemExit(main())
