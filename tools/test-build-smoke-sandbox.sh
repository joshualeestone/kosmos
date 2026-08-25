#!/bin/bash
# The bundle build's smoke test starts the staged app; the app refuses to start
# half-sandboxed (#634). This runs the gate's OWN audit over the environment the
# smoke test sets, read from the build script itself, so the two cannot drift:
# on 2026-08-24 the smoke test set three of four roots and no tmux stub, the
# build failed at its own smoke test, and release.sh step 4 was broken on main.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
BUILD=tools/build-kosmos-bundle.sh
# The env the smoke test sets: every KEY=value on the lines between the smoke
# banner and the node invocation, exactly as written (values are irrelevant to
# the gate; presence is what it audits).
block="$(sed -n '/^echo "==> smoke test/,/runtime\/bin\/node/p' "$BUILD")"
[ -n "$block" ] && ok "found the smoke-test block in $BUILD" || { bad "no smoke-test block found in $BUILD"; echo "build-smoke-sandbox: $FAILS failures"; exit 1; }
# KEY=VALUE pairs, values kept: the gate reads DRY_RUN's VALUE ("1"), not
# only its presence, so a presence-only extraction called tmux live.
keys="$(printf '%s\n' "$block" | grep -o 'AGENT_WORKFORCE_[A-Z_]*=\("[^"]*"\|[^ \\]*\)' | tr -d '"' | sort -u)"
audit() {   # <newline-separated KEY=VALUE lines> -> prints the gate's audit as JSON
  node -e '
    const { audit } = require("./engine/sandbox");
    const env = {};
    for (const line of process.argv[1].split("\n")) { if (!line) continue; const i = line.indexOf("="); env[line.slice(0, i)] = line.slice(i + 1) || "x"; }
    process.stdout.write(JSON.stringify(audit(env)));
  ' "$1"
}
a="$(audit "$keys")"
printf '%s' "$a" | grep -q '"partial":false' && ok "the smoke test's environment is not half-sandboxed by the gate's own audit" || bad "the gate would refuse the smoke test's environment: $a"
printf '%s' "$a" | grep -q '"tmuxInert":true' && ok "tmux is inert in the smoke test (a stub or DRY_RUN)" || bad "tmux is live in the smoke test: $a"
for k in AGENT_WORKFORCE_DATA AGENT_WORKFORCE_PROJECTS AGENT_WORKFORCE_WORKERS AGENT_WORKFORCE_LAUNCH; do
  printf '%s\n' "$keys" | grep -q "^$k=" && ok "the smoke test sandboxes $k" || bad "the smoke test does not set $k"
done
# CONTROL: with any one directory removed the same audit must refuse, or the
# assertions above prove nothing about the gate.
for k in AGENT_WORKFORCE_DATA AGENT_WORKFORCE_PROJECTS AGENT_WORKFORCE_WORKERS AGENT_WORKFORCE_LAUNCH; do
  less="$(printf '%s\n' "$keys" | grep -v "^$k=")"
  printf '%s' "$(audit "$less")" | grep -q '"partial":true' && ok "CONTROL: without $k the gate refuses" || bad "CONTROL: without $k the gate did not refuse -- the audit is not discriminating"
done
less="$(printf '%s\n' "$keys" | grep -v 'DRY_RUN\|TMUX_BIN')"
printf '%s' "$(audit "$less")" | grep -q '"partial":true' && ok "CONTROL: with tmux live the gate refuses" || bad "CONTROL: with tmux live the gate did not refuse"
# The gate's own list is the source: every directory the gate names must be set here.
for k in $(node -e 'for (const [k] of require("./engine/sandbox").DIRS) console.log(k)'); do
  printf '%s\n' "$keys" | grep -q "^$k=" && ok "every root the gate names is set: $k" || bad "the gate names $k and the smoke test does not set it (the app grew a root)"
done
echo "build-smoke-sandbox: $FAILS failures"; [ "$FAILS" -eq 0 ]
