#!/usr/bin/env bash
# One runner for every cross-client guard + each client's own static check.
#
# The app repos are SIBLINGS of this `agent-tools` checkout (or live under
# $AGENT_APPS_ROOT). Run this before every release.
#
#   bash check.sh            # fast: the python guards
#   bash check.sh --full     # also flutter analyze + compose/swift compile
#   bash check.sh --sandbox  # also build/run on the easyworker sandboxes
#                            #   (android emulator + macOS Xcode; needs the
#                            #   demo-* pods and is slow — see sandbox.py)
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
APPS="${AGENT_APPS_ROOT:-$(cd "$DIR/.." && pwd)}"
export AGENT_APPS_ROOT="$APPS"
FULL=0
SANDBOX=0
case "${1:-}" in
  --full) FULL=1 ;;
  --sandbox) FULL=1; SANDBOX=1 ;;
esac
rc=0
run() {
  echo
  echo "===== $* ====="
  "$@" || { echo "FAILED: $*"; rc=1; }
}

# ---- cross-client source guards (fast) ----
# Identity + default-gateway + tagged-deps guard across ALL 9 client repos.
run python3 clients.py
# Page / navigation contract: tabs, page keys, dispatch, config sub-ids,
# overlays — identical on every full client; skeletons checked against the same
# contract; the upstream webui is WARN-only.
run python3 pages.py
run python3 icons.py --check
run python3 icons.py --positions
run python3 parity.py
run python3 avatars.py
run python3 scopes.py
# Generated web shells (index.html/manifest) must match web-shell/.
run python3 web-shell/gen.py --check
# Behavioural conformance: every full client's native suite must reference each
# shared scenario id, and the Swift manifest must be the vendored copy.
run python3 conformance.py --check

# ---- heavier per-client compiles (opt-in) ----
if [ "$FULL" = 1 ]; then
  # flutter: fail only on ERROR-level diagnostics (the repo has pre-existing
  # info/warning lints by design; `analyze` exits 1 for those too).
  echo
  echo "===== flutter analyze (errors only) ====="
  errs=$(cd "$APPS/agent-flutter" && flutter analyze 2>&1 | grep -c "error •")
  if [ "$errs" = 0 ]; then echo "flutter: 0 errors"; else echo "flutter: $errs errors"; rc=1; fi

  run bash -c "cd '$APPS/agent-compose' && JAVA_HOME=\${JAVA_HOME:-/opt/tools/mise/installs/java/17.0.2} gradle :compileKotlinDesktop :compileKotlinWasmJs -q"

  # swiftui: swiftc -parse over every source (find, not ** glob). This is a
  # SYNTAX check only — it does NOT link SwiftUI/LucideSwift or typecheck
  # against them, so it cannot catch e.g. a missing `import LucideSwift` or a
  # wrong argument label. Those need the real Xcode toolchain: `--sandbox`.
  echo
  echo "===== swiftui swiftc -parse (syntax only) ====="
  if (cd "$APPS/agent-swiftui" && find Sources -name '*.swift' -print0 \
        | xargs -0 swiftc -parse) ; then
    echo "swiftui: parse OK"
  else
    echo "swiftui: parse FAILED"; rc=1
  fi
fi

# ---- real-platform builds on the easyworker sandboxes (opt-in, slow) ----
# This is the ONLY tier that compiles each client with its real toolchain:
#   * flutter/compose -> x86_64 debug APK, adb install + launch on the Android
#     emulator sandbox (the APK is built HERE; the sandbox has adb only)
#   * swiftui -> `swift build` + `swift test` on the macOS Xcode sandbox
if [ "$SANDBOX" = 1 ]; then
  run python3 sandbox.py all
fi

echo
if [ "$rc" = 0 ]; then
  echo "check.sh: ALL OK"
else
  echo "check.sh: FAILURES (see above)"
fi
exit $rc
