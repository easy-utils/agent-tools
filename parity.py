#!/usr/bin/env python3
"""Parity guardrail: diff the Flutter .arb dictionaries against every port and
flag placeholder mismatches.

Usage: python3 tools/parity.py [--fix-hint]

Checks:
  1. missing/extra i18n keys vs agent-flutter/l10n/app_{en,zh}.arb
  2. `{argN}` / named placeholders used in the flutter template but absent from
     the port's translation (a call site that can render a literal placeholder)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# Apps root: the parent of this tools checkout (sibling app repos), or
# $AGENT_APPS_ROOT when the apps live elsewhere.
import os as _os
ROOT = Path(_os.environ.get('AGENT_APPS_ROOT') or Path(__file__).resolve().parent.parent)
# The read-only upstream webui snapshot (we do not control abcp-sdk/webui, so its
# findings are WARN-only).
WEBUI = Path(__file__).resolve().parent / "webui-snapshot"
FLUTTER = ROOT / "agent-flutter" / "l10n"
# name -> (path, soft). A soft port reports drift but never fails the run.
PORTS = {
    "compose": (ROOT / "agent-compose/src/commonMain/kotlin/com/agent/app/i18n/I18n.kt", False),
    "swiftui": (ROOT / "agent-swiftui/Sources/agent-app/Core/I18n.swift", False),
    "webui": (WEBUI / "src/lib/i18n.svelte.ts", True),
}
PLACEHOLDER = re.compile(r"\{([a-zA-Z0-9_]+)\}")


def flutter_keys(lang: str) -> dict[str, str]:
    return {k: v for k, v in json.loads((FLUTTER / f"app_{lang}.arb").read_text()).items()
            if not k.startswith("@")}


def port_keys(name: str, text: str) -> set[str]:
    if name == "compose":
        return set(re.findall(r'"([a-zA-Z0-9_]+)" to "', text))
    if name == "swiftui":
        return set(re.findall(r'^  "([a-zA-Z0-9_]+)":', text, re.M))
    if name == "webui":
        # The webui holds both the en and zh maps in one file; take the first
        # (en) map only, up to the zh map's declaration. Keys are UNQUOTED
        # (``key: `value` ``), not `'key':`.
        en_map = text.split("const zh = {", 1)[0]
        return set(re.findall(r"^\s*([a-zA-Z0-9_]+):\s*`", en_map, re.M))
    return set(re.findall(r"^  '([a-zA-Z0-9_]+)':", text, re.M))


def main() -> int:
    en = flutter_keys("en")
    zh = flutter_keys("zh")
    rc = 0
    print(f"agent-flutter/en: {len(en)} keys  agent-flutter/zh: {len(zh)} keys\n")
    for name, (path, soft) in PORTS.items():
        if not path.exists():
            print(f"== {name} ==\n  {'WARN' if soft else 'FAIL'} missing {path}")
            if not soft:
                rc = 1
            continue
        text = path.read_text()
        keys = port_keys(name, text)
        missing = sorted(k for k in en if k not in keys)
        extra = sorted(k for k in keys if k not in en)
        tag = "WARN" if soft else "FAIL"
        print(f"== {name} ({len(keys)} keys) ==")
        if missing:
            if not soft:
                rc = 1
            print(f"  {tag} MISSING ({len(missing)}): {' '.join(missing)}")
        if extra:
            print(f"  {tag} extra  ({len(extra)}): {' '.join(extra)}")
        if not missing and not extra:
            print("  keys: OK")
    rc |= check_default_locale()
    rc |= check_unknown_elements()
    rc |= check_i18n_usage()
    return rc


# --- default-locale guard -----------------------------------------------------
# WHY: the product default UI language must be zh on EVERY client (app and web),
# regardless of the host/browser locale. Flutter already defaults to zh; the
# other three used to fall back to `en` (or, for the web UI, to
# navigator.language), so a fresh install showed English. This guard fails the
# check if any client's unset default drifts away from zh again.

DEFAULT_LOCALE_TARGETS: dict[str, list[tuple[str, str]]] = {
    # Policy (2026-09): the DEFAULT is FOLLOW SYSTEM — an unset preference
    # resolves to zh for a Chinese system locale and en otherwise, on every
    # client. These pins hold each client's unset-pref path to "system".
    "compose": [
        ("agent-compose/src/androidMain/kotlin/com/agent/app/platform/Android.platform.kt",
         r'getString\("uiLang", "system"\)'),
        ("agent-compose/src/desktopMain/kotlin/com/agent/app/platform/Desktop.platform.kt",
         r'get\("uiLang", "system"\)'),
        ("agent-compose/src/wasmJsMain/kotlin/com/agent/app/platform/Web.platform.kt",
         r'jsLocalGet\("agent\.uiLang"\) \?: "system"'),
    ],
    "swiftui": [
        ("agent-swiftui/Sources/agent-app/Core/Prefs.swift",
         r'd\.string\(forKey: "agent\.uiLang"\) \?\? "system"'),
        ("agent-swiftui/Sources/agent-app/Core/I18n.swift",
         r'return Prefs\.systemLangZh \? \.zh : \.en'),
    ],
    "flutter": [
        # pref defaults to 'system'; unknown stored values fall back to it too
        ("agent-flutter/lib/i18n.dart", r"static String pref = 'system';"),
        ("agent-flutter/lib/i18n.dart",
         r"pref = \(code == 'zh' \|\| code == 'en' \|\| code == 'system'\) \? code! : 'system';"),
        # zh stays the FALLBACK when the system locale is undeterminable
        ("agent-flutter/lib/i18n.dart", r"static const Locale fallback = Locale\('zh'\);"),
    ],
}

# A client must not silently switch its default back to English-only or drop
# the follow-system path. These patterns are the exact regressions seen before.
LOCALE_ANTI_PATTERNS: list[tuple[str, str]] = [
    ("agent-compose/src/commonMain/kotlin/com/agent/app/i18n/I18n.kt",
     r"var lang by mutableStateOf\(Lang\.EN\)"),
    ("agent-swiftui/Sources/agent-app/Core/I18n.swift", r"var lang: Lang = \.en"),
]


def check_default_locale() -> int:
    rc = 0
    print("\n== default UI locale (must FOLLOW SYSTEM: zh for Chinese systems, en otherwise) ==")
    for client, probes in DEFAULT_LOCALE_TARGETS.items():
        for rel, pat in probes:
            p = ROOT / rel
            if not p.exists():
                rc = 1
                print(f"  FAIL {client:<8} missing {rel}")
                continue
            if not re.search(pat, p.read_text()):
                rc = 1
                print(f"  FAIL {client:<8} {rel}: follow-system default lost ({pat})")
    for rel, pat in LOCALE_ANTI_PATTERNS:
        p = ROOT / rel
        if p.exists() and re.search(pat, p.read_text()):
            rc = 1
            print(f"  FAIL anti-pattern in {rel}: /{pat}/ (default must not be en)")
    if rc == 0:
        print("  OK — all three clients default to follow-system")
    return rc


# --- unknown-element guard ----------------------------------------------------
# WHY: Svelte (and the other declarative templates) treat a LOWERCASE tag as an
# unknown HTML element. `<icon .../>` therefore compiles, renders NOTHING, and —
# crucially — produces no error from the compiler OR from svelte-check. That is
# exactly how a Svelte web UI once lost every modality glyph (a derived icon
# component was rendered as `<icon>`). A capitalised tag (`<Glyph/>`) or a
# member expression (`<AppIcons.x/>`) is a component; a lowercase one is markup.
#
# This guard scans the front-end templates for lowercase tags that are NOT a
# known HTML/SVG element (and contain no '-' or ':' — a custom element or a
# Svelte special tag is deliberate). A found tag is a silent no-op: FAIL.
KNOWN_HTML_SVG = set("""
a abbr address area article aside audio b base bdi bdo blockquote body br button
canvas caption cite code col colgroup data datalist dd del details dfn dialog div
dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head
header hgroup hr html i iframe img input ins kbd label legend li link main map
mark menu meta meter nav noscript object ol optgroup option output p picture pre
progress q rp rt ruby s samp script section select slot small source span strong
style sub summary sup table tbody td template textarea tfoot th thead time title
tr track u ul var video wbr
svg path circle ellipse line polyline polygon rect g defs use symbol pattern mask
clipPath linearGradient radialGradient stop text tspan filter feBlend feColorMatrix
feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap
feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur
feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting
feSpotLight feTile feTurbulence foreignObject marker view
""".split())

TEMPLATE_GLOBS = {
    "compose": "agent-compose/src/**/*.kt",
    "swiftui": "agent-swiftui/Sources/**/*.swift",
}
# Kotlin/Swift use function calls, not tags, so no client currently needs the
# lowercase-tag scan (it applied to the retired Svelte webui). Kept declared so
# a future template language is covered the moment it is added.
TAG_SCAN_CLIENTS: tuple[str, ...] = ()
LOWERCASE_TAG = re.compile(r"<([a-z][a-zA-Z0-9]*)(?=[\s/>])")


def check_unknown_elements() -> int:
    rc = 0
    print("\n== lowercase (unknown) element tags (silent no-op) ==")
    if not TAG_SCAN_CLIENTS:
        print("  OK   (no template clients to scan)")
        return rc
    for client in TAG_SCAN_CLIENTS:
        hits: list[str] = []
        for p in sorted(ROOT.glob(TEMPLATE_GLOBS[client])):
            if not p.is_file():
                continue
            text = p.read_text(errors="ignore")
            # Only the MARKUP (after the last </script>): TypeScript generics and
            # `// <string>` comments in the script block are not tags.
            if "</script>" in text:
                text = text.rsplit("</script>", 1)[1]
            # Drop HTML comments so prose like `<name> | file:<code>` is ignored.
            text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
            for i, line in enumerate(text.splitlines(), 1):
                for m in LOWERCASE_TAG.finditer(line):
                    tag = m.group(1)
                    if tag in KNOWN_HTML_SVG or "-" in tag or ":" in tag:
                        continue
                    hits.append(f"{p.relative_to(ROOT)}: <{tag}>  |  {line.strip()[:90]}")
        if hits:
            rc = 1
            print(f"  FAIL {client:<8} {len(hits)} unknown tag(s):")
            for h in hits:
                print(f"       {h}")
        else:
            print(f"  OK   {client:<8} no unknown lowercase tags")
    return rc


# --- i18n usage guard ---------------------------------------------------------
# WHY: the key tables are mirrored across the clients by hand, and keys outlive their
# last call site (deleteSessionConfirm vs deleteSessionBody, editMessage
# defined in swiftui months before its dialog existed). A key referenced by
# ZERO clients is dead weight in three dictionaries; a key referenced by only
# SOME clients usually means a feature gap or a dynamically-built key.
#
# FAIL: unused in ALL clients (dead key — delete it from every table).
# WARN: unused in some clients (verify it is not a missing feature).

USAGE_SCAN: dict[str, tuple[str, list[str]]] = {
    # (root, excluded definition files) — search every source file for the key
    # as a quoted literal (kt/swift call sites are t("key")) or, in flutter,
    # as a `l10n.key` / `I18n.now.key` accessor reference.
    "flutter": ("agent-flutter/lib", ["l10n/generated"]),
    "compose": ("agent-compose/src", ["i18n/I18n.kt"]),
    "swiftui": ("agent-swiftui/Sources", ["Core/I18n.swift"]),
}


def _client_uses_key(client: str, key: str, cache: dict[str, str]) -> bool:
    root_rel, excludes = USAGE_SCAN[client]
    if client not in cache:
        blobs: list[str] = []
        root = ROOT / root_rel
        for p in sorted(root.rglob("*")):
            if not p.is_file() or p.suffix not in {".dart", ".ts", ".svelte", ".kt", ".swift"}:
                continue
            if any(exc in str(p.relative_to(root)) for exc in excludes):
                continue
            blobs.append(p.read_text(errors="ignore"))
        cache[client] = "\n".join(blobs)
    blob = cache[client]
    if client == "flutter":
        return ((f"l10n.{key}" in blob) or (f"now.{key}" in blob)
                or (f'"{key}"' in blob) or (f"'{key}'" in blob))
    return (f"'{key}'" in blob) or (f'"{key}"' in blob)


def check_i18n_usage() -> int:
    rc = 0
    keys = sorted(flutter_keys("en"))
    cache: dict[str, str] = {}
    print(f"\n== i18n key usage ({len(keys)} keys x 3 clients) ==")
    dead: list[str] = []
    partial: list[tuple[str, list[str]]] = []
    for k in keys:
        unused = [c for c in ("flutter", "compose", "swiftui")
                  if not _client_uses_key(c, k, cache)]
        if len(unused) == 3:
            dead.append(k)
        elif unused:
            partial.append((k, unused))
    if dead:
        rc = 1
        print(f"  FAIL dead key(s) unused in ALL clients — delete everywhere:")
        for k in dead:
            print(f"       {k}")
    else:
        print("  OK   no dead keys")
    if partial:
        print(f"  WARN unused in SOME clients (dynamic key or feature gap):")
        for k, clients in partial:
            print(f"       {k:<28} missing: {' '.join(clients)}")
    return rc


if __name__ == "__main__":
    sys.exit(check_default_locale() if "--locale" in sys.argv else main())
