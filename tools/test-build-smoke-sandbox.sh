#!/bin/bash
# The app refuses to start half-sandboxed (#634, engine/sandbox.js). Two of the
# release's own tools start a sandboxed app: the bundle build's smoke test
# (tools/build-kosmos-bundle.sh) and the install harness (tools/test-install.sh).
# On 2026-08-24, the evening the gate merged, both set some roots and not the
# rest: the build failed at its own smoke test with release.sh step 4 behind it,
# and the harness failed at its first install. This runs the gate's OWN audit
# over the environment each tool sets, read from the tool's source, so the
# tools and the gate cannot drift again; when the app grows a root, the gate
# names it and this goes red here, not in a cut.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }

# KEY=VALUE assignments from a block of shell, in source order, comment lines
# stripped, values kept as written (quotes removed) and passed through
# UNCHANGED: the gate reads DRY_RUN's value, treats an empty value as unset,
# and, like the shell, lets a later assignment win over an earlier one.
assignments() {   # <text> -> KEY=VALUE lines
  printf '%s\n' "$1" | grep -v '^[[:space:]]*#' | grep -o 'AGENT_WORKFORCE_[A-Z_]*=\("[^"]*"\|[^ \\]*\)' | tr -d '"'
}
audit() {   # <KEY=VALUE lines> -> the gate's audit as JSON (last assignment wins)
  node -e '
    const { audit } = require("./engine/sandbox");
    const env = {};
    for (const line of process.argv[1].split("\n")) { if (!line) continue; const i = line.indexOf("="); env[line.slice(0, i)] = line.slice(i + 1); }
    process.stdout.write(JSON.stringify(audit(env)));
  ' "$1"
}
has() { case "$1" in *"$2"*) return 0;; esac; return 1; }   # substring, no pipe

# The roots the gate names, from the gate itself; an empty list is a failure,
# never a loop that runs zero times and passes.
DIRS="$(node -e 'for (const [k] of require("./engine/sandbox").DIRS) console.log(k)' 2>/dev/null)"
[ -n "$DIRS" ] && ok "the gate exports its list of roots ($(printf '%s\n' "$DIRS" | wc -l | tr -d ' '))" || { bad "could not read the gate's DIRS from engine/sandbox.js"; echo "build-smoke-sandbox: $FAILS failures"; exit 1; }

check_tool() {   # <label> <KEY=VALUE lines>
  local label="$1" keys="$2" a k less
  [ -n "$keys" ] && ok "$label: found its sandbox environment" || { bad "$label: no AGENT_WORKFORCE_ assignments found"; return; }
  a="$(audit "$keys")"
  has "$a" '"partial":false' && ok "$label: not half-sandboxed by the gate's own audit" || bad "$label: the gate would refuse this environment: $a"
  has "$a" '"tmuxInert":true' && ok "$label: tmux is inert (a stub or DRY_RUN=1)" || bad "$label: tmux is live: $a"
  for k in $DIRS; do
    printf '%s\n' "$keys" | grep -q "^$k=." && ok "$label: sandboxes $k" || bad "$label: does not set $k (or sets it empty)"
  done
  # CONTROLS: with any one root removed, or tmux made live, the same audit must
  # refuse, or the assertions above prove nothing about the gate.
  for k in $DIRS; do
    less="$(printf '%s\n' "$keys" | grep -v "^$k=")"
    has "$(audit "$less")" '"partial":true' && ok "$label CONTROL: without $k the gate refuses" || bad "$label CONTROL: without $k the gate did not refuse -- the audit is not discriminating"
  done
  less="$(printf '%s\n' "$keys" | grep -v 'DRY_RUN\|TMUX_BIN')"
  has "$(audit "$less")" '"partial":true' && ok "$label CONTROL: with tmux live the gate refuses" || bad "$label CONTROL: with tmux live the gate did not refuse"
}

# 1. the bundle build's smoke test: the lines from the smoke banner to the
#    server invocation (the range closes on the first app/server.js line).
BUILD=tools/build-kosmos-bundle.sh
block="$(sed -n '/^echo "==> smoke test/,/app\/server\.js/p' "$BUILD")"
[ -n "$block" ] && ok "found the smoke-test block in $BUILD" || bad "no smoke-test block found in $BUILD"
check_tool "build smoke test" "$(assignments "$block")"

# 2. the install harness: every export of an AGENT_WORKFORCE_ variable up to
#    its first install, AND everything after it: the harness starts more boards
#    in later blocks (the download path, the probes, the update), so a root
#    unset or emptied later would make one of those boards half-sandboxed
#    while this audit read only the first block (measured on a mutated copy).
#    No later block touches a gate root today; if one ever does, it must set
#    a non-empty value, never unset, and the merged audit must still pass.
HARNESS=tools/test-install.sh
block="$(sed -n '1,/^echo "== install (piped into sh/p' "$HARNESS" | grep '^export ')"
rest="$(sed -n '/^echo "== install (piped into sh/,$p' "$HARNESS" | grep -v '^[[:space:]]*#')"
check_tool "install harness" "$(assignments "$block")"
if printf '%s\n' "$rest" | grep -qE 'unset[^#]*AGENT_WORKFORCE_(DATA|PROJECTS|WORKERS|LAUNCH|DRY_RUN|TMUX_BIN)\b'; then
  bad "install harness: a later block unsets a gate root (a board started after it would be half-sandboxed): $(printf '%s\n' "$rest" | grep -E 'unset[^#]*AGENT_WORKFORCE_' | head -1)"
else ok "install harness: no later block unsets a gate root"; fi
later="$(assignments "$rest" | grep -E '^AGENT_WORKFORCE_(DATA|PROJECTS|WORKERS|LAUNCH|DRY_RUN|TMUX_BIN)=' || true)"
if [ -n "$later" ]; then
  merged="$(printf '%s\n%s\n' "$(assignments "$block")" "$later")"
  has "$(audit "$merged")" '"partial":false' && ok "install harness: later re-assignments of gate roots still audit whole" || bad "install harness: a later re-assignment makes a board half-sandboxed: $later"
else ok "install harness: no later block re-assigns a gate root"; fi

# The extraction itself, on shapes that fooled its first version (measured):
# an empty value must NOT read as set, a commented line must NOT count, and a
# key set twice must read as the LAST value, as the shell hands it on.
x="$(assignments 'PORT=0 AGENT_WORKFORCE_DATA="" AGENT_WORKFORCE_PROJECTS="/p" AGENT_WORKFORCE_WORKERS="/w" AGENT_WORKFORCE_LAUNCH="/l" AGENT_WORKFORCE_DRY_RUN=1')"
has "$(audit "$x")" '"partial":true' && ok "extraction: an empty value reads as unset (the gate refuses)" || bad "extraction: an empty value read as a sandboxed root"
x="$(assignments '# AGENT_WORKFORCE_DRY_RUN=1 was the old way
AGENT_WORKFORCE_DATA="/d" AGENT_WORKFORCE_PROJECTS="/p" AGENT_WORKFORCE_WORKERS="/w" AGENT_WORKFORCE_LAUNCH="/l"')"
has "$(audit "$x")" '"tmuxInert":false' && ok "extraction: a commented-out assignment does not count" || bad "extraction: a comment line was read as an assignment"
x="$(assignments 'AGENT_WORKFORCE_DATA="/d" AGENT_WORKFORCE_PROJECTS="/p" AGENT_WORKFORCE_WORKERS="/w" AGENT_WORKFORCE_LAUNCH="/l" AGENT_WORKFORCE_DRY_RUN=1 AGENT_WORKFORCE_DRY_RUN=0')"
has "$(audit "$x")" '"tmuxInert":false' && ok "extraction: a key set twice reads as the last value, like the shell" || bad "extraction: a duplicated key did not read as its last value"

echo "build-smoke-sandbox: $FAILS failures"; [ "$FAILS" -eq 0 ]
