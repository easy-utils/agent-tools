#!/usr/bin/env bash
# One runner for every cross-client guard + each client's own static check.
#
# The app repos are SIBLINGS of this `agent-tools` checkout (or live under
# $AGENT_APPS_ROOT). Run this before every release.
#
#   bash check.sh            # fast: the python guards + webui svelte-check
#   bash check.sh --full     # also flutter analyze + compose/swift compile
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
APPS="${AGENT_APPS_ROOT:-$(cd "$DIR/.." && pwd)}"
export AGENT_APPS_ROOT="$APPS"
FULL=0
[ "${1:-}" = "--full" ] && FULL=1
rc=0
run() {
  echo
  echo "===== $* ====="
  "$@" || { echo "FAILED: $*"; rc=1; }
}

# ---- cross-client source guards (fast) ----
run python3 icons.py --check
run python3 icons.py --positions
run python3 parity.py
run python3 avatars.py
run python3 scopes.py
# Generated web shells (index.html/manifest) must match web-shell/.
run python3 web-shell/gen.py --check

# ---- webui: svelte-check covers .svelte (tsc alone does NOT) ----
if [ -d "$APPS/agent-webui/node_modules" ]; then
  run bash -c "cd '$APPS/agent-webui' && npm run check"
else
  echo "(skip webui: no node_modules)"
fi

# ---- heavier per-client compiles (opt-in) ----
if [ "$FULL" = 1 ]; then
  # flutter: fail only on ERROR-level diagnostics (the repo has pre-existing
  # info/warning lints by design; `analyze` exits 1 for those too).
  echo
  echo "===== flutter analyze (errors only) ====="
  errs=$(cd "$APPS/agent-flutter" && flutter analyze 2>&1 | grep -c "error •")
  if [ "$errs" = 0 ]; then echo "flutter: 0 errors"; else echo "flutter: $errs errors"; rc=1; fi

  run bash -c "cd '$APPS/agent-compose-app' && JAVA_HOME=\${JAVA_HOME:-/opt/tools/mise/installs/java/17.0.2} gradle :compileKotlinDesktop :compileKotlinWasmJs -q"

  # swiftui: swiftc -parse over every source (find, not ** glob).
  echo
  echo "===== swiftui swiftc -parse ====="
  if (cd "$APPS/agent-swiftui-app" && find Sources -name '*.swift' -print0 \
        | xargs -0 swiftc -parse) ; then
    echo "swiftui: parse OK"
  else
    echo "swiftui: parse FAILED"; rc=1
  fi
fi

echo
if [ "$rc" = 0 ]; then
  echo "check.sh: ALL OK"
else
  echo "check.sh: FAILURES (see above)"
fi
exit $rc
