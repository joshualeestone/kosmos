#!/bin/bash
# kosmos#2125 slice 3: the native Accessibility writer's FALSE-BLOCK path, end to end,
# on a REAL compiled binary, with the trust value MOCKED.
#
# 🔑 WHY MOCK. The gate blocks the first-run Continue ONLY on a positive
# checkable:true + trusted:false. On a dev box Accessibility is granted broadly, so
# AXIsProcessTrusted() returns true unconditionally and the gating (trusted:false) path
# cannot be reached by a real read (measured 2026-09-04). The writer therefore carries a
# test-only KOSMOS_AXCHECK_FORCE_TRUSTED seam; this test drives BOTH trust states through
# the writer AND the engine reader, proving the whole chain writer -> a11y-status.json ->
# engine/a11ystatus.js -> gate verdict for the state that actually blocks.
#
# This is the analog of the build-bundle hatch smoke, but it ALSO crosses the seam into
# the JS engine, so it catches a path drift between the Swift writer and the JS reader
# (the two-copies-of-one-fact defect) that a hatch-only smoke cannot.
#
# NOTE the ATTRIBUTION unknown (does an under-tmux re-exec report tmux's trust or the
# app's?) is NOT what this tests -- that is the deferred fresh-install gate on #2125.
# This proves the DOWNSTREAM of a not-trusted reading is correct, whatever produces it.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"

# swiftc-guarded: the fast suite deliberately does not compile Swift (the native-app.*.test.js
# files read source instead), and a machine without the toolchain must SKIP cleanly, not fail.
if ! command -v swiftc >/dev/null 2>&1; then
  echo "a11y-writer-mock: SKIP (no swiftc on this host; the source-wiring guard is native-app.a11y-writer-2125.test.js)"
  exit 0
fi
if ! command -v node >/dev/null 2>&1; then
  echo "a11y-writer-mock: SKIP (no node on this host to drive the engine reader)"
  exit 0
fi

tmp="$(mktemp -d "${TMPDIR:-/tmp}/a11y-writer-mock.XXXXXXXX")"
trap 'rm -rf "$tmp"' EXIT
fails=0
ran=0

check() {  # check <name> <expected> <actual>
  ran=$((ran + 1))
  if [ "$2" = "$3" ]; then echo "PASS  $1"
  else echo "FAIL  $1 (expected [$2], got [$3])"; fails=$((fails + 1)); fi
}

BIN="$tmp/kosmos-app"
if ! ( cd "$REPO/native-app" && swiftc main.swift -o "$BIN" ) 2>"$tmp/build.err"; then
  echo "a11y-writer-mock: main.swift did NOT compile (this is a real failure, not a skip):"
  cat "$tmp/build.err" >&2
  exit 1
fi
[ -x "$BIN" ] || { echo "a11y-writer-mock: no binary produced"; exit 1; }

# engine_verdict <data-dir>: print the engine's read() verdict as a compact string
# "<checkable>/<trusted>" (trusted omitted when not checkable), resolving store.ROOT
# from AGENT_WORKFORCE_DATA exactly as the shipped board would.
engine_verdict() {
  AGENT_WORKFORCE_DATA="$1" node -e '
    const a = require(process.argv[1] + "/engine/a11ystatus");
    const r = a.read();
    process.stdout.write(r.checkable ? ("checkable/" + r.trusted) : "uncheckable");
  ' "$REPO"
}

# --- trusted:false -- the GATING / false-block state -------------------------------
d0="$tmp/data-false"
AGENT_WORKFORCE_DATA="$d0" KOSMOS_AXCHECK_FORCE_TRUSTED=0 "$BIN" --kosmos-app-axcheck
check "axcheck(mock=0) exits 0" 0 "$?"
# The file lands where the engine reads it (store.ROOT/a11y-status.json).
check "axcheck(mock=0) wrote the reading at the store path" yes \
  "$([ -f "$d0/AgentWorkforce/a11y-status.json" ] && echo yes || echo no)"
check "the reading is trusted:false" yes \
  "$(grep -q '"trusted":false' "$d0/AgentWorkforce/a11y-status.json" && echo yes || echo no)"
# The whole point: a not-trusted reading is checkable AND gating.
check "engine reads trusted:false as checkable/false (GATES Continue)" "checkable/false" "$(engine_verdict "$d0")"

# --- trusted:true -- the UNBLOCK state ---------------------------------------------
d1="$tmp/data-true"
AGENT_WORKFORCE_DATA="$d1" KOSMOS_AXCHECK_FORCE_TRUSTED=1 "$BIN" --kosmos-app-axcheck
check "axcheck(mock=1) exits 0" 0 "$?"
check "the reading is trusted:true" yes \
  "$(grep -q '"trusted":true' "$d1/AgentWorkforce/a11y-status.json" && echo yes || echo no)"
check "engine reads trusted:true as checkable/true (UNBLOCKS Continue)" "checkable/true" "$(engine_verdict "$d1")"

# --- absent reading -- the FAIL-SAFE control ---------------------------------------
# A store the writer never touched must read as uncheckable, NOT as a gating verdict:
# a browser tester and a not-yet-checked machine both leave Continue enabled.
d2="$tmp/data-absent"
mkdir -p "$d2"
check "engine reads an ABSENT reading as uncheckable (fail-safe, Continue enabled)" "uncheckable" "$(engine_verdict "$d2")"

# --- the cross-language path really is the SAME one --------------------------------
# The engine's FILE and the Swift writer's output path must be byte-identical under the
# same AGENT_WORKFORCE_DATA, or the two agree only by coincidence of this test's dirs.
d3="$tmp/data-path"
AGENT_WORKFORCE_DATA="$d3" KOSMOS_AXCHECK_FORCE_TRUSTED=1 "$BIN" --kosmos-app-axcheck >/dev/null 2>&1
engine_file="$(AGENT_WORKFORCE_DATA="$d3" node -e 'process.stdout.write(require(process.argv[1] + "/engine/a11ystatus").FILE)' "$REPO")"
check "the engine reader path is exactly where the writer wrote" yes \
  "$([ -f "$engine_file" ] && echo yes || echo no)"

# --- a non-0/1 mock value FALLS THROUGH to the real read ----------------------------
# A garbage value must not be silently treated as false (that would ship a permanently
# gating reading); it falls through to AXIsProcessTrusted. We cannot assert the real
# VALUE (it depends on whether THIS host has Accessibility granted -- true on a granted
# dev box, false on a fresh CI runner), so we assert only that a well-formed, CHECKABLE
# reading is still written -- i.e. the fall-through produced a real verdict, not a crash
# and not an uncheckable no-write.
d4="$tmp/data-fallthrough"
AGENT_WORKFORCE_DATA="$d4" KOSMOS_AXCHECK_FORCE_TRUSTED=maybe "$BIN" --kosmos-app-axcheck >/dev/null 2>&1
check "a non-0/1 mock value falls through to a real, checkable reading" "checkable" \
  "$(engine_verdict "$d4" | cut -d/ -f1)"

# --- a population floor, so a gutted test cannot pass vacuously (Mona Lisa's lesson) -
if [ "$ran" -lt 10 ]; then echo "a11y-writer-mock: only $ran checks ran, so this proved nothing"; exit 1; fi

echo "---"
if [ "$fails" -eq 0 ]; then echo "a11y-writer-mock: all $ran checks passed"; exit 0; fi
echo "a11y-writer-mock: $fails FAILED"; exit 1
