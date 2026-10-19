#!/bin/bash
# kosmos#6549: tools/lib/home-path-gate.sh refuses a stage in which any file (binary or text, outside the upstream
# Node runtime) names the build Mac's home folder, and passes a clean one. Runs on a fake stage and a fake home, so
# it never reads this Mac's real home or a real build.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib/home-path-gate.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
H="/Users/zz-builder"
stage() { rm -rf "$T/s"; mkdir -p "$T/s/app/bin" "$T/s/bin" "$T/s/runtime/bin"; printf 'console.log(1)\n' > "$T/s/app/server.js"; printf '#!/bin/sh\n' > "$T/s/bin/kosmos"; }

stage
if home_path_gate_tree "$T/s" "$H" 2>/dev/null; then pass "CONTROL: a clean stage passes"
else fail "CONTROL: a clean stage was refused, so every refusal below is vacuous"; fi

stage; printf 'x\0\0panicked at %s/.cargo/registry/src/a.rs:1\0' "$H" > "$T/s/app/bin/kosmos-tunnel"
out="$(home_path_gate_tree "$T/s" "$H" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | /usr/bin/grep -qF "app/bin/kosmos-tunnel"; then pass "a BINARY naming the build home is refused, and named"
else fail "a binary naming the build home must be refused and named (rc=$rc): $out"; fi

stage; printf '// see %s/work/x\n' "$H" >> "$T/s/app/server.js"
if ! home_path_gate_tree "$T/s" "$H" 2>/dev/null; then pass "a source COMMENT naming the build home is refused"
else fail "a source comment naming the build home must be refused"; fi

stage; printf 'x %s/lib y\0' "$H" > "$T/s/runtime/bin/node"
if home_path_gate_tree "$T/s" "$H" 2>/dev/null; then pass "the upstream Node runtime is not read (it is not ours to rebuild)"
else fail "the runtime/ folder must not be read"; fi

stage; printf 'x %sother/y\0' "$H" > "$T/s/app/bin/kosmos-app"
if home_path_gate_tree "$T/s" "$H" 2>/dev/null; then pass "a DIFFERENT folder that only starts with the same name (${H}other) is not a hit"
else fail "${H}other is not the build home and must not be refused"; fi

stage
if ! ( HOME=""; home_path_gate_tree "$T/s" ) 2>/dev/null; then pass "an EMPTY \$HOME with no home given is refused, never skipped"
else fail "an empty \$HOME must be refused, not passed"; fi
for bad in "/" "relative/home" "/Users"; do
  stage
  if ! home_path_gate_tree "$T/s" "$bad" 2>/dev/null; then pass "an unusable home ('$bad') is refused, never skipped"
  else fail "an unusable home ('$bad') must be refused, not passed"; fi
done

stage; rm -rf "$T/s/app"
if ! home_path_gate_tree "$T/s" "$H" 2>/dev/null; then pass "a stage with no app/ is refused (the gate cannot look)"
else fail "a stage with no app/ must be refused"; fi

if [ "$fails" -ne 0 ]; then echo "$fails check(s) failed"; exit 1; fi
echo "all checks passed"
