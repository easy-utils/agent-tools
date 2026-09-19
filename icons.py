#!/usr/bin/env python3
"""Unified icon table for the Easy Agent clients + a parity checker.

WHY: each client used a different icon set (Flutter = Material Icons, Compose =
materialIconsExtended, SwiftUI = SF Symbols), so the same action rendered a
different glyph on every platform. This module is the single source of truth:
one row per SEMANTIC SLOT, each naming the exact identifier the three clients
must use.

The table is HAND-WRITTEN (no code generation): Flutter/Compose/SwiftUI expose
typed constants, so the clients reference their library's own names directly.
Only the few slots whose names diverge between the ports carry explicit
per-client overrides.

Field meanings (all optional except `lucide`):
    lucide   canonical lucide id (lucide-static 1.46)
    flutter  `LucideIcons.<name>` in the flutter_lucide package
    web      `import { <name> }` from @lucide/svelte
    compose  `Lucide.<name>` property from com.composables:icons-lucide-cmp
    swift    `LucideIconName.<name>` case from ajaxjiang96/lucide-swift
Derivation when a field is omitted: the canonical id, converted to each
library's naming convention (snake_case / PascalCase / lowerCamelCase).

Usage:
    python3 tools/icons.py --check     # verify every row resolves in all three
    python3 tools/icons.py --list      # print the resolved table
    python3 tools/icons.py --emit      # regenerate the per-client alias files
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Apps root: the parent of this tools checkout (sibling app repos), or
# $AGENT_APPS_ROOT when the apps live elsewhere.
import os as _os
ROOT = Path(_os.environ.get('AGENT_APPS_ROOT') or Path(__file__).resolve().parent.parent)
CACHE = Path("/tmp/opencode")

# --- the table ---------------------------------------------------------------
# slot (snake_case) -> canonical lucide id, plus per-client overrides where a
# port's own naming/version differs. The slot name is what the clients use.
SLOTS: dict[str, dict[str, str]] = {
    # --- actions ---
    "add": {"lucide": "plus"},
    "close": {"lucide": "x"},
    "search": {"lucide": "search"},
    "delete": {"lucide": "trash"},
    "edit": {"lucide": "pencil"},
    "copy": {"lucide": "copy"},
    "undo": {"lucide": "undo-2"},
    "revert": {"lucide": "rotate-ccw"},
    "refresh": {"lucide": "refresh-cw"},
    "save": {"lucide": "save"},
    "send": {"lucide": "send"},
    "stop": {"lucide": "square"},
    "play": {"lucide": "play"},
    "pause": {"lucide": "pause"},
    "play_round": {"lucide": "circle-play"},
    "pause_round": {"lucide": "circle-pause"},
    "attach": {"lucide": "paperclip"},
    "upload": {"lucide": "upload"},
    "download": {"lucide": "download"},
    "camera": {"lucide": "camera"},
    "mic": {"lucide": "mic"},
    "mic_vocal": {"lucide": "mic-vocal"},
    "keyboard": {"lucide": "keyboard"},
    "eye": {"lucide": "eye"},
    "eye_off": {"lucide": "eye-off"},
    "filter": {"lucide": "funnel"},
    "swap": {"lucide": "arrow-left-right"},
    "external": {"lucide": "external-link"},
    "login": {"lucide": "log-in"},
    "user_plus": {"lucide": "user-round-plus"},
    "maximize": {"lucide": "maximize"},
    "minimize": {"lucide": "minimize"},
    "expand": {"lucide": "expand"},
    "shrink": {"lucide": "shrink"},

    # --- navigation / chrome ---
    "back": {"lucide": "arrow-left"},
    "chevron_right": {"lucide": "chevron-right"},
    "chevron_down": {"lucide": "chevron-down"},
    "chevron_up": {"lucide": "chevron-up"},
    "chevron_left": {"lucide": "chevron-left"},
    "chevron_select": {"lucide": "chevrons-up-down"},
    "arrow_up": {"lucide": "arrow-up"},
    "more": {"lucide": "ellipsis"},
    "more_vertical": {"lucide": "ellipsis-vertical"},
    "apps": {"lucide": "layout-grid"},
    "settings": {"lucide": "settings"},
    "tools": {"lucide": "wrench"},
    "palette": {"lucide": "palette"},
    "language": {"lucide": "languages"},

    # --- status ---
    "check": {"lucide": "check"},
    "success": {"lucide": "circle-check-big"},
    "error": {"lucide": "circle-alert"},
    "warn": {"lucide": "triangle-alert"},
    "spinner": {"lucide": "loader-circle"},
    "info": {"lucide": "info"},
    "circle": {"lucide": "circle"},
    "target": {"lucide": "circle-dot"},
    "checked_square": {"lucide": "square-check"},
    "checks": {"lucide": "check-check"},

    # --- content / files ---
    "file": {"lucide": "file-text"},
    "file_edit": {"lucide": "file-pen"},
    "file_image": {"lucide": "file-image"},
    "file_code": {"lucide": "file-code"},
    "file_audio": {"lucide": "file-headphone"},
    "file_video": {"lucide": "file-play"},
    "file_search": {"lucide": "file-search"},
    "image": {"lucide": "image"},
    "image_plus": {"lucide": "image-plus"},
    "image_off": {"lucide": "image-off"},
    "folder": {"lucide": "folder-open"},
    "video": {"lucide": "video"},
    "film": {"lucide": "film"},
    "audio": {"lucide": "audio-lines"},
    "music": {"lucide": "music"},
    "hourglass": {"lucide": "hourglass"},

    # --- dev / infra ---
    "code": {"lucide": "code"},
    "terminal": {"lucide": "square-terminal"},
    "braces": {"lucide": "braces"},
    "binary": {"lucide": "binary"},
    "diff": {"lucide": "diff"},
    "commit": {"lucide": "git-commit-horizontal"},
    "merge": {"lucide": "git-merge"},
    "branch": {"lucide": "git-branch"},
    "fork": {"lucide": "git-fork"},
    "server": {"lucide": "server"},
    "network": {"lucide": "network"},
    "database": {"lucide": "database"},
    "layers": {"lucide": "layers"},
    # `package` is a Kotlin/Swift word, so the shared slot name is `pkg`
    # (the three libraries name the glyph package / packageIcon / Package).
    "pkg": {"lucide": "package", "swift": "packageIcon"},
    "inbox": {"lucide": "inbox"},
    "rocket": {"lucide": "rocket"},
    "flask": {"lucide": "flask-conical"},
    "scatter": {"lucide": "chart-scatter"},
    "grip": {"lucide": "grip-vertical"},
    "drive": {"lucide": "hard-drive"},
    "monitor": {"lucide": "monitor"},
    "cpu": {"lucide": "cpu"},
    "bot": {"lucide": "bot"},
    "plug": {"lucide": "plug"},
    "box": {"lucide": "box"},
    "container": {"lucide": "container"},
    "hash": {"lucide": "hash"},
    "link": {"lucide": "link"},
    "route": {"lucide": "route"},
    "sliders": {"lucide": "sliders-horizontal"},
    "printer": {"lucide": "printer"},
    "list": {"lucide": "list-checks"},
    "todo": {"lucide": "list-todo"},
    "clipboard": {"lucide": "clipboard-list"},
    "book": {"lucide": "book-open"},
    "notebook": {"lucide": "notebook"},
    # `history` renders the same glyph in every port; Compose's port predates the
    # `rotate-ccw-clock` rename and only exposes the legacy property name.
    "history": {"lucide": "rotate-ccw-clock", "compose": "History"},
    "clock": {"lucide": "clock"},
    "calendar": {"lucide": "calendar"},
    "timer": {"lucide": "timer"},
    "star": {"lucide": "star"},
    "tag": {"lucide": "tag"},
    "building": {"lucide": "building"},
    "users": {"lucide": "users"},
    "user": {"lucide": "user"},
    "key": {"lucide": "key"},
    "lock": {"lucide": "lock"},
    "shield": {"lucide": "shield"},
    "puzzle": {"lucide": "puzzle"},
    "compass": {"lucide": "compass"},
    "map": {"lucide": "map-pin"},
    "pin": {"lucide": "pin"},
    "bell": {"lucide": "bell"},
    "bolt": {"lucide": "zap"},
    "sparkles": {"lucide": "sparkles"},
    "globe": {"lucide": "globe"},
    "asterisk": {"lucide": "asterisk"},
    "cloud_down": {"lucide": "cloud-download"},
    "sun": {"lucide": "sun"},
    "moon": {"lucide": "moon"},
    "chat": {"lucide": "message-square"},
    "chat_round": {"lucide": "message-circle"},
}


# --- UI position registry -----------------------------------------------------
# WHY: a slot being reachable on only SOME clients is almost always a port that
# forgot to adopt the shared glyph (or kept a leftover Material/SF/emoji literal)
# — that is exactly how the clients drifted apart before. So `--check` does
# not merely validate the table: it walks the real client sources, collects every
# `AppIcons.<slot>` they reference, and applies three rules.
#
# Rules enforced by `--check` / `--positions`:
#   1. every slot any client renders must be REGISTERED (declared in AREA_SLOTS)
#      or named in INTENTIONAL — a brand-new glyph cannot appear silently;
#   2. every registered, used slot must be rendered by ALL FOUR clients. A slot
#      present on one client but missing on another is a hard failure;
#   3. INTENTIONAL waivers name exactly the clients EXEMPT from drawing the slot
#      plus a reason; the checker fails if an exempt client turns out to use it
#      (so a waiver can never hide real drift) or if no other client uses it.
#
# Paths are relative to the repo root; the `--emit` generated files are skipped
# (they *define* the slots rather than adopting them).

# The three generated per-client alias files (excluded from usage scanning).
GENERATED = {
    "agent-flutter/lib/icons.dart",
    "agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/IconSlots.kt",
    "agent-swiftui-app/Sources/agent-app/Core/AppIcons.swift",
}

# area -> {client -> [source files]} — only used to bucket a slot by feature so
# a missing glyph can be reported against the area that owns it.
AREA_FILES: dict[str, dict[str, list[str]]] = {
    "shell": {
        "flutter": ["agent-flutter/lib/main.dart"],
        "compose": ["agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/App.kt"],
        "swiftui": ["agent-swiftui-app/Sources/agent-app/AgentApp.swift"],
    },
    "chat": {
        "flutter": [
            "agent-flutter/lib/screens/chat.dart",
            "agent-flutter/lib/screens/chat_overlay_page.dart",
            "agent-flutter/lib/widgets/message_bubble.dart",
            "agent-flutter/lib/widgets/tool_part.dart",
            "agent-flutter/lib/widgets/tool_icon.dart",
            "agent-flutter/lib/widgets/media_attachment.dart",
        ],
        "compose": [
            "agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ChatScreen.kt",
            "agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ToolCard.kt",
            "agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/MediaCommon.kt",
            "agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/MediaViewer.kt",
            "agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/MessageFilePart.kt",
            "agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/AttachmentTile.kt",
            "agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/Theme.kt",
        ],
        "swiftui": [
            "agent-swiftui-app/Sources/agent-app/Screens/ChatScreen.swift",
            "agent-swiftui-app/Sources/agent-app/Screens/MediaAttachment.swift",
        ],
    },
    "session_list": {
        "flutter": ["agent-flutter/lib/screens/session_list_page.dart", "agent-flutter/lib/widgets/session_row.dart"],
        "compose": ["agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/SessionListScreen.kt"],
        "swiftui": ["agent-swiftui-app/Sources/agent-app/Screens/SessionListScreen.swift"],
    },
    "config": {
        "flutter": [
            "agent-flutter/lib/screens/config.dart",
            # preset editor (reached from config) — its own file.
            "agent-flutter/lib/screens/preset_form.dart",
        ],
        "compose": [
            "agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ConfigScreen.kt",
            "agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/MailboxScreen.kt",
        ],
        "swiftui": [
            "agent-swiftui-app/Sources/agent-app/Screens/ConfigScreen.swift",
            "agent-swiftui-app/Sources/agent-app/Screens/MailboxScreen.swift",
            "agent-swiftui-app/Sources/agent-app/Screens/PresetFormScreen.swift",
            # shared UI primitives (AppSelect/AppField) used across screens.
            "agent-swiftui-app/Sources/agent-app/Core/Theme.swift",
        ],
    },
    "providers": {
        "flutter": ["agent-flutter/lib/screens/providers.dart"],
        "compose": ["agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ProvidersScreens.kt"],
        "swiftui": ["agent-swiftui-app/Sources/agent-app/Screens/ProvidersScreens.swift"],
    },
}

# The canonical slot set per area: what every client must render there. The
# check compares each client's actual usage against this, so a port that forgets
# a glyph (or invents one) fails the build.
AREA_SLOTS: dict[str, set[str]] = {
    "shell": {"add", "chat", "delete", "eye", "eye_off", "server", "settings", "target"},
    # NOTE: the tool-card glyph is fixed (`tools`) for every tool, so the old
    # per-family slots (terminal/file_edit/file_search/folder/code/merge/pkg/
    # rocket/inbox/history) are intentionally absent here.
    "chat": {
        "add", "attach", "audio", "back", "braces", "camera", "chat", "check",
        "chevron_down", "chevron_right", "chevron_up", "circle", "close",
        "commit", "copy", "delete", "diff", "download", "edit", "error", "file",
        "film", "globe", "image", "image_off", "info", "keyboard", "list",
        "mic", "mic_vocal", "more", "more_vertical", "music",
        "pause_round", "play_round", "refresh", "scatter",
        "send", "stop", "success", "tools", "undo",
    },
    "session_list": {
        "add", "back", "chevron_down", "chevron_up", "circle", "close",
        "delete", "list", "search", "success",
    },
    "config": {
        "add", "back", "chevron_down", "chevron_right", "chevron_up",
        "circle", "delete", "globe", "language", "palette", "server", "sparkles",
        "star", "success", "swap", "target", "tools",
    },
    "providers": {
        "add", "audio", "back", "bolt", "chat", "chevron_right", "circle",
        "close", "flask", "grip", "image", "mic_vocal", "network", "server",
        "scatter", "sparkles", "star", "success", "target", "video",
    },
}

# --- position table -----------------------------------------------------------
# WHY: "same slot used by all clients" is NOT enough — the SAME slot can be
# rendered at different positions on different clients, and the SAME position can
# use different slots. So each cross-client UI position is pinned here: the exact
# slot it must render on each client, plus a per-client regex that has to match
# in the client's source. `--positions` fails on a missing pin OR a wrong slot.
#
# `order` = how many times the pin's regex may match in that file (0..N). It
# catches "the glyph is there but at the wrong spot" when a slot appears more
# than once in an area. `anchors` add surrounding-context assertions.
POSITIONS: list[dict] = [
    # ---- chat chrome ----
    {"id": "chat.back", "slot": "back", "order": 1, "why": "chat top-bar back",
     "clients": {
         "flutter": ("agent-flutter/lib/screens/chat.dart", r"Icon\(AppIcons\.back, size: 22\)"),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ChatScreen.kt", r"AppIcons\.back,"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/ChatScreen.swift", r"AppIcon\(AppIcons\.back\)"),
     }},
    {"id": "chat.menu", "slot": "more_vertical", "order": 1, "why": "top-bar overflow menu",
     "clients": {
         "flutter": ("agent-flutter/lib/screens/chat.dart", r"icon: const Icon\(AppIcons\.more_vertical, size: 22\)"),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ChatScreen.kt", r"AppIcons\.more_vertical,"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/ChatScreen.swift", r"AppIcon\(AppIcons\.more_vertical\)"),
     }},
    {"id": "chat.composer.stop", "slot": "stop", "order": 1, "why": "composer abort button",
     "clients": {
         "flutter": ("agent-flutter/lib/screens/chat.dart", (r"icon: const Icon\(AppIcons\.stop, size: 20\)", r"icon: AppIcons\.stop,")),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ChatScreen.kt", r"icon = AppIcons\.stop,"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/ChatScreen.swift", r"composerCircle\(icon: AppIcons\.stop"),
     }},
    {"id": "chat.composer.send", "slot": "send", "order": 1, "why": "composer send button",
     "clients": {
         "flutter": ("agent-flutter/lib/screens/chat.dart", (r"icon: const Icon\(AppIcons\.send, size: 20\)", r"icon: AppIcons\.send,")),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ChatScreen.kt", r"icon = AppIcons\.send,"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/ChatScreen.swift", r"composerCircle\(icon: AppIcons\.send"),
     }},
    {"id": "chat.composer.empty", "slot": "add", "order": 1, "why": "empty composer → attach sheet",
     "clients": {
         "flutter": ("agent-flutter/lib/screens/chat.dart", (r"Icon\(AppIcons\.add, size: 22\)", r"icon: AppIcons\.add,")),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ChatScreen.kt", r"icon = AppIcons\.add,"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/ChatScreen.swift", r"composerCircle\(icon: AppIcons\.add"),
     }},
    {"id": "chat.attach.sheet", "slot": "camera|image|attach", "order": 3, "why": "attach sheet rows",
     "clients": {
         "flutter": ("agent-flutter/lib/screens/chat.dart", r"Icon\(AppIcons\.(camera|image|attach)\)"),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ChatScreen.kt", r"AttachSheetRow\(AppIcons\.(camera|image|attach)"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/ChatScreen.swift", r"attachRow\(AppIcons\.(camera|image|attach)"),
     }},
    {"id": "chat.drop.overlay", "slot": "download", "order": 1, "why": "drag-hover overlay glyph",
     "clients": {
         "flutter": ("agent-flutter/lib/screens/chat.dart", r"Icon\(AppIcons\.download, size: 32"),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ChatScreen.kt", r"Icon\(AppIcons\.download, contentDescription = null, tint = colors\.primary, modifier = Modifier\.size\(28\.dp\)\)"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/ChatScreen.swift", r"AppIcon\(AppIcons\.download\)\.appFont\(\.screenTitle\)"),
     }},
    {"id": "chat.message.actions", "slot": "copy|refresh|edit|undo", "order": 4, "why": "bubble action row",
     "clients": {
         "flutter": ("agent-flutter/lib/widgets/message_bubble.dart", r"leading: const Icon\(AppIcons\.(copy|refresh|edit|undo)\)"),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ChatScreen.kt", r"IconAction\(AppIcons\.(copy|refresh|edit|undo)"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/ChatScreen.swift", r"IconAction\(slot: AppIcons\.(copy|refresh|edit|undo)"),
     }},
    {"id": "chat.image.error", "slot": "image_off", "order": {"flutter": 2, "compose": 1, "swiftui": 1}, "why": "broken image placeholder",
     "clients": {
         "flutter": ("agent-flutter/lib/widgets/media_attachment.dart", r"Icon\(AppIcons\.image_off,"),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/MessageFilePart.kt", r"AppIcons\.image_off,"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/MediaAttachment.swift", r"AppIcon\(AppIcons\.image_off\)"),
     }},
    {"id": "chat.audio.glyph", "slot": "music", "order": 1, "why": "audio kind glyph",
     "clients": {
         "flutter": ("agent-flutter/lib/widgets/media_attachment.dart", r"MediaKind\.audio => AppIcons\.music,"),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/AttachmentTile.kt", r"audio/\"\) == true -> AppIcons\.music"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/MediaAttachment.swift", r"AppIcon\(AppIcons\.music\)"),
     }},
    {"id": "chat.video.glyph", "slot": "film", "order": 1, "why": "video kind glyph",
     "clients": {
         "flutter": ("agent-flutter/lib/widgets/media_attachment.dart", r"MediaKind\.video => AppIcons\.film,"),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/AttachmentTile.kt", r"video/\"\) == true -> AppIcons\.film"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/ChatScreen.swift", r"AppIcons\.film : AppIcons\.file"),
     }},
    # ---- session list ----
    {"id": "sessions.selectall", "slot": "list", "order": 2, "why": "enter select mode + select-all",
     "clients": {
         "flutter": ("agent-flutter/lib/screens/session_list_page.dart", r"AppIcons\.list"),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/SessionListScreen.kt", r"AppIcons\.list,"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/SessionListScreen.swift", r"AppIcon\(AppIcons\.list\)"),
     }},
    {"id": "sessions.row.selected", "slot": "success", "order": 1, "why": "selected row checkbox",
     "clients": {
         "flutter": ("agent-flutter/lib/widgets/session_row.dart", r"\? AppIcons\.success"),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/SessionListScreen.kt", r"if \(selected\) AppIcons\.success else AppIcons\.circle,"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/SessionListScreen.swift", r"AppIcon\(selected \? AppIcons\.success : AppIcons\.circle\)"),
     }},
    {"id": "sessions.row.unselected", "slot": "circle", "order": 1, "why": "unselected row circle",
     "clients": {
         "flutter": ("agent-flutter/lib/widgets/session_row.dart", r": AppIcons\.circle,"),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/SessionListScreen.kt", r"else AppIcons\.circle,"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/SessionListScreen.swift", r": AppIcons\.circle\)"),
     }},
    # ---- providers ----
    {"id": "providers.default.radio", "slot": "target|circle", "order": None,
     "why": "default-model picker radio (Flutter native RadioListTile, others self-drawn)",
     "waiver": {"flutter": "native RadioListTile glyph",
                "compose": "ActionSheet is label-only",
                "swiftui": "confirmationDialog is label-only"},
     "clients": {
         "flutter": ("agent-flutter/lib/screens/providers.dart", r"RadioListTile<String>"),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ProvidersScreens.kt", 'ActionSheet\\(\\s*title = t\\("defaultModel"\\)'),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/ProvidersScreens.swift", 'confirmationDialog\\(t\\("defaultModel"\\)'),
     }},
    {"id": "providers.model.capability", "slot": "image|video|audio|mic_vocal|scatter|grip|bolt|chat", "order": 1,
     "why": "capability glyph for a model row",
     "clients": {
         "flutter": ("agent-flutter/lib/screens/providers.dart", r"Widget capabilityIcon\("),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ProvidersScreens.kt", r"fun capabilityIcon\(capability: String\)"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/ProvidersScreens.swift", r"func capabilityIcon\(_ capability: String\)"),
     }},
    {"id": "providers.test.flask", "slot": "flask", "order": None, "why": "model test button glyph",
     "clients": {
         "flutter": ("agent-flutter/lib/screens/providers.dart", r": AppIcons\.flask,"),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ProvidersScreens.kt", r"AppIcons\.flask,"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/ProvidersScreens.swift", r"AppIcon\(AppIcons\.flask, size: 16\)"),
     }},
    # ---- config ----
    {"id": "config.drill.chevron", "slot": "chevron_right", "order": None, "why": "config drill-in trailing",
     "clients": {
         "flutter": ("agent-flutter/lib/screens/config.dart", r"trailing: const Icon\(AppIcons\.chevron_right, size: 18\)"),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ConfigScreen.kt", r"Icon\(AppIcons\.chevron_right, contentDescription = null"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/ConfigScreen.swift", r"AppIcon\(AppIcons\.chevron_right\)\.appFont\(\.meta\)"),
     }},
    {"id": "config.language.globe", "slot": "globe", "order": 1, "why": "UI-language row glyph",
     "clients": {
         "flutter": ("agent-flutter/lib/screens/config.dart", r"AppIcons\.globe, 'language'"),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ConfigScreen.kt", r"Tile\(AppIcons\.globe"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/ConfigScreen.swift", r"rowContent\(AppIcons\.globe"),
     }},
    {"id": "config.agentLocale", "slot": "language", "order": 1, "why": "agent-language row glyph",
     "clients": {
         "flutter": ("agent-flutter/lib/screens/config.dart", r"AppIcons\.language,\s*'agentLocale'"),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ConfigScreen.kt", r"Tile\(AppIcons\.language"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/ConfigScreen.swift", r"rowContent\(AppIcons\.language"),
     }},
    # ---- shell ----
    {"id": "shell.backends.server", "slot": "server", "order": 1, "why": "saved-backend row leading",
     "clients": {
         "flutter": ("agent-flutter/lib/main.dart", r"AppIcons\.server"),
         "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/App.kt", r"AppIcons\.server"),
         "swiftui": ("agent-swiftui-app/Sources/agent-app/AgentApp.swift", r"AppIcons\.server"),
     }},
]

# Deliberately single-client (or single-area) glyphs. Each entry names the
# clients that are EXEMPT from having to render the slot (with a reason); the
# checker fails if an exempt client actually uses it, so a waiver can never be
# used to paper over real drift.
INTENTIONAL: dict[str, dict[str, str]] = {
    # Dropdown/select checkmarks live inside the platform widget (Flutter
    # DropdownButtonFormField, SwiftUI Menu) and cannot be replaced; Compose
    # draws its own list rows, hence the shared `check` slot.
    "check": {
        "flutter": "native dropdown checkmark (cannot be replaced)",
        "swiftui": "native Menu checkmark (cannot be replaced)",
    },
    # Inline audio/video playback: Flutter (video_player/audioplayers) and
    # SwiftUI (AVAudioPlayer) draw their own transport controls, so they share
    # the round play/pause glyph. Compose's platform actuals are still a
    # fallback card with no custom transport button to draw yet.
    "play_round": {
        "compose": "HTML5/native player chrome, no custom transport button",
    },
    "pause_round": {
        "compose": "HTML5/native player chrome, no custom transport button",
    },
}

# --- tool-card table ----------------------------------------------------------
# EVERY tool renders the exact same card: ONE glyph (`tools`) + ONE colour
# (`primary`). The card must not vary by tool family, so `--check` asserts the
# fixed glyph expression is present on all clients AND that the old
# per-family icon/colour helpers are gone. (Section icons — braces / file /
# info / error — are per-SECTION, not per-tool, so they are not covered here.)
TOOL_GLYPH_SLOT = "tools"
TOOL_CARD_GLYPH: dict[str, tuple[str, str]] = {
    # client -> (file, exact fixed-glyph expression that must appear)
    "flutter": ("agent-flutter/lib/widgets/tool_icon.dart",
                "Icon(AppIcons.tools, size: 14, color: colorsOf(context).primary)"),
    "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ToolCard.kt",
                "Icon(AppIcons.tools, contentDescription = null, tint = colors.primary"),
    "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/ChatScreen.swift",
                "AppIcon(AppIcons.tools, size: 14)"),
}
# The old per-family helpers; their return fails the check.
TOOL_CARD_DEAD_HELPERS: dict[str, tuple[str, str]] = {
    "flutter": ("agent-flutter/lib/widgets/tool_icon.dart", ""),
    "compose": ("agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ToolCard.kt",
                "fun toolGlyph("),
    "swiftui": ("agent-swiftui-app/Sources/agent-app/Screens/ChatScreen.swift",
                "func toolIconSlot("),
}
# The tool-result `data` key carrying produced-file refs; every client renders
# those as media/file cards (the "metadata has a file field" exception). The
# generator emits `data.files = [{code,mime,name,bytes}]`.
TOOL_MEDIA_KEYS = ("files",)
TOOL_MEDIA_FILES: dict[str, str] = {
    "flutter": "agent-flutter/lib/widgets/tool_part.dart",
    "compose": "agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/ToolCard.kt",
    "swiftui": "agent-swiftui-app/Sources/agent-app/Screens/ChatScreen.swift",
}


def pascal(name: str) -> str:
    return "".join(p[:1].upper() + p[1:] for p in name.split("-"))


def camel(name: str) -> str:
    head, *rest = name.split("-")
    return head + "".join(p[:1].upper() + p[1:] for p in rest)


def snake(name: str) -> str:
    return name.replace("-", "_")


def resolved() -> dict[str, dict[str, str]]:
    """Every slot with all library names filled in."""
    out: dict[str, dict[str, str]] = {}
    for slot, row in SLOTS.items():
        ident = row["lucide"]
        out[slot] = {
            "lucide": ident,
            "flutter": row.get("flutter") or snake(ident),
            "compose": row.get("compose") or pascal(ident),
            "swift": row.get("swift") or camel(ident),
        }
    return out


# --- library inventories -----------------------------------------------------
# Each list is the set of identifiers that library actually exposes. They are
# refreshed by `--refresh` from the installed packages / pinned artifacts.

def _cache(name: str) -> set[str]:
    p = CACHE / name
    return set(p.read_text().split()) if p.exists() else set()


def inventories() -> dict[str, set[str]]:
    return {
        "flutter": _cache("flutter-lucide-icons.txt"),
        "compose": _cache("cih-classes.txt"),
        "swift": _cache("lucide-swift-cases.txt"),
    }


def refresh() -> int:
    """Rebuild the three inventories from the installed dependencies."""
    import json
    import os

    # flutter — identifiers in the installed flutter_lucide package
    import subprocess
    out = subprocess.run(
        ["bash", "-lc", "find ~/.pub-cache -path '*flutter_lucide*/lib/src/flutter_lucide.dart' | head -1"],
        capture_output=True, text=True).stdout.strip()
    if out:
        names = sorted(set(re.findall(r"static const IconData ([a-z0-9_]+)\s*=", Path(out).read_text())))
        (CACHE / "flutter-lucide-icons.txt").write_text("\n".join(names))
        print(f"flutter {len(names)}")

    # compose — property names in the icons-lucide-cmp jar
    jar = CACHE / "ci221.jar"
    if jar.exists():
        import zipfile
        props: set[str] = set()
        with zipfile.ZipFile(jar) as z:
            for entry in z.namelist():
                if not entry.endswith("Kt.class") or "/lucide/" not in entry:
                    continue
                base = entry.rsplit("/", 1)[-1][:-8]
                parts = [p for p in base.split("_") if p]
                if not parts:
                    continue
                props.add("".join(p[:1].upper() + p[1:] for p in parts))
        (CACHE / "cih-classes.txt").write_text("\n".join(sorted(props)))
        print(f"compose {len(props)}")

    # swift — LucideIconName cases from the pinned generated source
    src = CACHE / "lg.swift"
    if src.exists():
        block = src.read_text().split("public enum LucideLabIconName")[0]
        cases = sorted(set(re.findall(r"^\s*case ([a-zA-Z0-9]+)\s*$", block, re.M)))
        (CACHE / "lucide-swift-cases.txt").write_text("\n".join(cases))
        print(f"swift   {len(cases)}")
    return 0


def generated_files(rows: dict[str, dict[str, str]]) -> dict[Path, list[str]]:
    """The three per-client icon files, as line lists."""
    """Regenerate the per-client alias files from the table.

    Three generated files, one per client, all produced from ROWS so a slot can
    never drift between platforms:
      agent-flutter/lib/icons.dart                          AppIcons.<slot>
      agent-compose-app/.../ui/IconSlots.kt                 AppIcons.<slot>
      agent-swiftui-app/Sources/agent-app/Core/AppIcons.swift  AppIcons.<slot>
    """
    header = [
        "// GENERATED by tools/icons.py --emit — do not hand-edit.",
        "// One semantic slot per row; all clients use the SAME lucide id.",
    ]

    # ---- Flutter ----------------------------------------------------------
    fl = header + [
        "import 'package:flutter_lucide/flutter_lucide.dart';",
        "",
        "/// Semantic icon slots shared by all Easy Agent clients.",
        "abstract final class AppIcons {",
    ]
    for slot, r in sorted(rows.items()):
        fl.append(f"  static const {slot} = LucideIcons.{r['flutter']};")
    fl.append("}")

    # ---- Compose ----------------------------------------------------------
    kt = header + ["package com.agent.app.ui", "",
                   "import androidx.compose.ui.graphics.vector.ImageVector",
                   "import com.composables.icons.lucide.Lucide"]
    for slot, r in sorted(rows.items()):
        kt.append(f"import com.composables.icons.lucide.{r['compose']}")
    kt += ["",
           "/** Semantic icon slots shared by all Easy Agent clients (tools/icons.py).",
           " *",
           " *  Compose's Lucide port exposes glyphs as extension properties on the",
           " *  `Lucide` object, so this table adapts the cross-client slot names to",
           " *  the library's own PascalCase properties. */",
           "object AppIcons {"]
    for slot, r in sorted(rows.items()):
        kt.append(f"    val {slot}: ImageVector get() = Lucide.{r['compose']}")
    kt.append("}")

    # ---- SwiftUI ----------------------------------------------------------
    # The upstream package is `LucideSwift` (product `LucideSwift`); its
    # `LucideIcon` init is `(shape:style:size:color:strokeWidth:absoluteStrokeWidth:)`
    # and `LucideIconName` is an enum whose cases are the glyphs.
    sw = header + ["import SwiftUI", "import LucideSwift", "",
                   "/// Semantic icon slots shared by all Easy Agent clients.",
                   "///",
                   "/// `AppIcon` renders them with the bundled Lucide strokes (2pt, matching",
                   "/// the Flutter / Compose clients), so the same action shows the",
                   "/// same glyph on every platform.",
                   "public enum AppIcons {", "",
                   "    /// The `LucideIconName` for each slot (string lookup, e.g. a tool name).",
                   "    public static let table: [String: LucideIconName] = ["]
    for slot, r in sorted(rows.items()):
        sw.append(f'        "{slot}": .{r["swift"]},')
    sw += ["    ]", "",
           "    public static func named(_ slot: String) -> LucideIconName {",
           "        table[slot] ?? .circle",
           "    }", ""]
    for slot, r in sorted(rows.items()):
        sw.append(f"    public static let {slot}: LucideIconName = .{r['swift']}")
    sw += ["}", "",
           "/// Renders a Lucide slot, inheriting the colour (`.foregroundStyle`) the",
           "/// way `Image(systemName:)` did.",
           "public struct AppIcon: View {",
           "    private let name: LucideIconName",
           "    private let size: CGFloat?",
           "",
           "    public init(_ name: LucideIconName, size: CGFloat? = nil) {",
           "        self.name = name",
           "        self.size = size",
           "    }",
           "",
           "    public var body: some View {",
           "        LucideIcon(shape: name.shape, size: size ?? 16, strokeWidth: 2,",
           "                   absoluteStrokeWidth: size != nil)",
           "    }",
           "}"]

    return {
        ROOT / "agent-flutter/lib/icons.dart": fl,
        ROOT / "agent-compose-app/src/commonMain/kotlin/com/agent/app/ui/IconSlots.kt": kt,
        ROOT / "agent-swiftui-app/Sources/agent-app/Core/AppIcons.swift": sw,
    }


def emit() -> int:
    """Write the generated files to disk."""
    targets = generated_files(resolved())
    for path, lines in targets.items():
        path.write_text("\n".join(lines) + "\n")
    print("emit: " + ", ".join(str(p.relative_to(ROOT)) for p in targets))
    return 0


def _client_used(client: str, paths: list[str]) -> set[str]:
    """Every `AppIcons.<slot>` the given client sources reference."""
    ext = {"flutter": ".dart", "compose": ".kt", "swiftui": ".swift"}[client]
    used: set[str] = set()
    for rel in paths:
        p = ROOT / rel
        if not p.exists():
            continue
        text = p.read_text()
        if not rel.endswith(ext):
            continue
        used |= set(re.findall(r"AppIcons\.([a-z0-9_]+)", text))
    return used


def slot_area() -> dict[str, str]:
    """slot -> the area(s) that register it, joined for diagnostics."""
    out: dict[str, list[str]] = {}
    for area, slots in AREA_SLOTS.items():
        for s in slots:
            out.setdefault(s, []).append(area)
    return {s: "+".join(v) for s, v in out.items()}


def _all_used() -> dict[str, set[str]]:
    """client -> every slot it references across its registered source files."""
    per: dict[str, set[str]] = {}
    for files in AREA_FILES.values():
        for client, paths in files.items():
            per.setdefault(client, set())
            per[client] |= _client_used(client, paths)
    return per


def check_position_table() -> int:
    """Pin every cross-client UI position to one slot on all clients.

    This is the position-level guard `check_positions`' global slot set cannot
    give: for each POSITIONS entry, the client's own source must match the
    expected anchored regex. That catches both a missing glyph and a glyph that
    exists but sits at the wrong position (wrong slot at that spot, or the right
    slot somewhere else while this spot lacks it).

    Per entry:
      `order`  exact match count (omitted/None = ">= 1", used when the position
               legitimately repeats, e.g. every drill-in row's trailing chevron)
      `waiver` client -> reason; that client must instead match its own pattern
               (a platform-native widget the port cannot replace).
    """
    rc = 0
    for pin in POSITIONS:
        slot = pin["slot"]
        order = pin.get("order")
        waiver = pin.get("waiver", {})
        for client in ("flutter", "compose", "swiftui"):
            entry = pin["clients"].get(client)
            want_order = order.get(client) if isinstance(order, dict) else order
            if entry is None:
                rc = 1
                print(f"FAIL pin       {pin['id']:<28}{client:<8}no client entry")
                continue
            rel, pat = entry
            p = ROOT / rel
            if not p.exists():
                rc = 1
                print(f"FAIL pin       {pin['id']:<28}{client:<8}missing {rel}")
                continue
            # A client entry may pin SEVERAL accepted expressions (a refactor
            # can legitimately change the call shape); any one of them counts.
            pats = (pat,) if isinstance(pat, str) else tuple(pat)
            text = p.read_text()
            n = sum(len(re.findall(x, text)) for x in pats)
            if want_order is None:
                ok = n >= 1
                want = "≥1"
            else:
                ok = n == want_order
                want = f"{want_order}×"
            if not ok:
                tag = "waived-native" if client in waiver else "bad"
                rc = 1
                print(f"FAIL pin       {pin['id']:<28}{client:<8}expected {want} "
                      f"`{slot}` got {n}× [{tag}] ({rel})")
            # a non-waived pin must literally name the slot(s) it pins
            if client not in waiver and "|" not in slot and not any(
                f"AppIcons\\.{slot}" in x for x in pats
            ):
                rc = 1
                print(f"FAIL pin       {pin['id']:<28}{client:<8}pattern does not name AppIcons.{slot}")
    return rc


def check_no_unscanned_icons() -> int:
    """Every `AppIcons.<slot>` use must live in a file the registry scans."""
    scanned: set[str] = {rel for files in AREA_FILES.values()
                         for paths in files.values() for rel in paths}
    rc = 0
    for client, root in (("flutter", "agent-flutter"), ("compose", "agent-compose-app"),
                         ("swiftui", "agent-swiftui-app")):
        for p in sorted((ROOT / root).rglob("*")):
            if not p.is_file() or p.suffix not in (".dart", ".kt", ".swift"):
                continue
            rel = str(p.relative_to(ROOT))
            if rel in GENERATED or rel in scanned:
                continue
            if "AppIcons." in p.read_text():
                rc = 1
                print(f"FAIL unscanned {client:<8}{rel} uses AppIcons outside the registry")
    return rc


def check_tool_card() -> int:
    """Every client's tool card must render ONE fixed glyph+tint.

    Asserts the exact glyph expression is present on all clients and that
    the old per-family helpers (`toolGlyph` / `toolIconSlot` / the Flutter
    branch table) are gone.
    """
    rc = 0
    for client, (rel, expr) in TOOL_CARD_GLYPH.items():
        p = ROOT / rel
        if not p.exists():
            rc = 1
            print(f"FAIL tool-card {client:<8}missing {rel}")
            continue
        text = p.read_text()
        if f"AppIcons.{TOOL_GLYPH_SLOT}" not in text or expr not in text:
            rc = 1
            print(f"FAIL tool-card {client:<8}missing fixed glyph expression ({expr})")
    for client, (rel, needle) in TOOL_CARD_DEAD_HELPERS.items():
        if not needle:
            continue
        p = ROOT / rel
        if p.exists() and needle in p.read_text():
            rc = 1
            print(f"FAIL tool-card {client:<8}per-family helper still present: {needle!r}")
    # The "file field" exception: a tool result's `data` may carry file refs and
    # every client must render them as media/file cards.
    for client, rel in TOOL_MEDIA_FILES.items():
        p = ROOT / rel
        if not p.exists():
            rc = 1
            print(f"FAIL tool-media {client:<8}missing {rel}")
            continue
        text = p.read_text()
        missing = [k for k in TOOL_MEDIA_KEYS if f'"{k}"' not in text and f"'{k}'" not in text]
        if missing:
            rc = 1
            print(f"FAIL tool-media {client:<8}does not collect data keys {missing}")
    return rc


def check_positions() -> int:
    """Forbid single-client icons.

    Two rules, both aimed at the exact drift the clients suffered before:
      (a) every `AppIcons.<slot>` used by ANY client must be declared in an
          AREA_SLOTS registry — a brand-new glyph cannot appear silently;
      (b) a declared, used slot must be rendered by ALL FOUR clients. A glyph
          that only one port knows about is exactly the bug this catch; the
          only exception is an INTENTIONAL waiver naming the allowed clients
          and a reason (platform-native controls, etc.).
    """
    rc = 0
    registered = slot_area()
    per = _all_used()
    all_used = set().union(*per.values()) if per else set()
    clients = ("flutter", "compose", "swiftui")

    # (a) every used slot must be registered
    for slot in sorted(all_used - set(registered)):
        rc = 1
        print(f"FAIL position  `{slot}` is used but not registered in AREA_SLOTS")

    # (b) each registered+used slot must appear on all clients
    for slot in sorted(all_used & set(registered)):
        waiver = INTENTIONAL.get(slot, {})
        missing = sorted(c for c in clients if slot not in per.get(c, set()) and c not in waiver)
        if missing:
            rc = 1
            print(f"FAIL position  `{slot}` ({registered[slot]}) single-end: "
                  f"missing on {', '.join(missing)}")

    # (c) waiver sanity: an exempt client must NOT use the slot (otherwise the
    #     waiver is masking a real difference), and the slot must be used by at
    #     least one of the other clients.
    for slot, waiver in sorted(INTENTIONAL.items()):
        for client in waiver:
            if slot in per.get(client, set()):
                rc = 1
                print(f"FAIL waiver    `{slot}` exempts {client} but {client} uses it")
        if not any(slot in per.get(c, set()) for c in clients if c not in waiver):
            rc = 1
            print(f"FAIL waiver    `{slot}` is waived but no non-exempt client uses it")
    return rc


def main() -> int:
    if "--refresh" in sys.argv:
        return refresh()
    if "--emit" in sys.argv:
        return emit()
    if "--positions" in sys.argv:
        rc = check_positions() | check_position_table() | check_no_unscanned_icons()
        print(f"icons: positions {'OK' if rc == 0 else 'FAILED'} "
              f"({len(POSITIONS)} pinned positions)")
        return rc

    rows = resolved()
    if "--list" in sys.argv:
        print(f"{'slot':<18}{'lucide':<24}{'flutter':<24}{'compose':<22}swift")
        for slot, r in sorted(rows.items()):
            print(f"{slot:<18}{r['lucide']:<24}{r['flutter']:<24}"
                  f"{r['compose']:<22}{r['swift']}")
        return 0

    inv = inventories()
    for lib, names in inv.items():
        print(f"inventory {lib:<8}{len(names):>6} names")
    rc = 0

    # 1) every slot must resolve in every library the table names
    for slot, r in sorted(rows.items()):
        for lib in ("flutter", "compose", "swift"):
            if inv[lib] and r[lib] not in inv[lib]:
                rc = 1
                print(f"FAIL {slot:<18}{lib:<9}{r[lib]}")

    # 2) the generated per-client files must match the table exactly — this is
    #    what actually stops a client from drifting after a hand edit.
    for path, expected in generated_files(rows).items():
        if not path.exists():
            rc = 1
            print(f"FAIL missing {path.relative_to(ROOT)}")
            continue
        if path.read_text() != "\n".join(expected) + "\n":
            rc = 1
            print(f"FAIL stale   {path.relative_to(ROOT)} (run --emit)")

    # 3) the tool card must be IDENTICAL on all clients: ONE glyph
    #    (`tools`) + ONE colour (`primary`), and no surviving per-family
    #    branching (which would be the exact drift this file exists to stop).
    rc_tool = check_tool_card()

    # 4) the position registry — no single-client glyph may exist (this is what
    #    actually keeps the ports showing the SAME icon at the SAME spot).
    rc_pos = check_positions() | check_position_table() | check_no_unscanned_icons()

    print(f"icons: {'OK' if rc == 0 and rc_pos == 0 and rc_tool == 0 else 'FAILED'} "
          f"({len(rows)} slots, {len(POSITIONS)} pinned positions)")
    return rc or rc_pos or rc_tool

if __name__ == "__main__":
    raise SystemExit(main())
