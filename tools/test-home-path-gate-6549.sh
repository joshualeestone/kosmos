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

stage; printf "const r = path.relative('%s', p);\n" "$H" >> "$T/s/app/server.js"
if ! home_path_gate_tree "$T/s" "$H" 2>/dev/null; then pass "the home followed by a quote (no slash) is refused"
else fail "the home followed by a quote must be refused"; fi

stage; printf 'x%s\0y' "$H" > "$T/s/app/bin/kosmos-tunnel"
if ! home_path_gate_tree "$T/s" "$H" 2>/dev/null; then pass "the home followed by a NUL byte in a binary is refused"
else fail "the home followed by a NUL must be refused"; fi

stage; printf '// %s/x\n' "$(printf '%s' "$H" | tr '[:lower:]' '[:upper:]')" >> "$T/s/app/server.js"
if ! home_path_gate_tree "$T/s" "$H" 2>/dev/null; then pass "the home in another case is refused (macOS volumes ignore case)"
else fail "the home in another case must be refused"; fi

stage; printf '\xcf\xfa\xed\xfe panicked at /Users/someone-else/.cargo/registry/src/a.rs\0' > "$T/s/app/bin/kosmos-tunnel"
if ! home_path_gate_tree "$T/s" "$H" 2>/dev/null; then pass "a compiled file naming ANOTHER account's .cargo is refused (a connector built on another Mac)"
else fail "another account's build folder in an executable must be refused"; fi

stage; mkdir -p "$T/s/app/Kosmos.app/Contents/MacOS"; printf '\xca\xfe\xba\xbe x /Users/other/work/kosmos/native-app/main.swift\0' > "$T/s/app/Kosmos.app/Contents/MacOS/Kosmos"
if ! home_path_gate_tree "$T/s" "$H" 2>/dev/null; then pass "the app executable naming another account's work/ folder is refused"
else fail "the app executable naming another account's work/ must be refused"; fi

stage; printf '// for example /Users/alex/work/x\n' >> "$T/s/app/server.js"
if home_path_gate_tree "$T/s" "$H" 2>/dev/null; then pass "a made-up /Users/<name>/work/ in a SOURCE comment is not refused (the any-account check reads compiled files only)"
else fail "a made-up example in a source comment must not be refused"; fi

if [ "$(id -u)" -ne 0 ]; then
  stage; printf 'x %s/y\n' "$H" > "$T/s/app/locked.txt"; chmod 000 "$T/s/app/locked.txt"
  if ! home_path_gate_tree "$T/s" "$H" 2>/dev/null; then pass "a file the gate cannot read is refused, never passed"
  else fail "an unreadable file must be refused"; fi
  chmod 600 "$T/s/app/locked.txt"
fi

stage; rm -rf "$T/s/bin"
if ! home_path_gate_tree "$T/s" "$H" 2>/dev/null; then pass "a stage with no bin/ is refused"
else fail "a stage with no bin/ must be refused"; fi

stage; printf 'x %s/y\0' "$H" > "$T/s/app/bin/odd|name"
out="$(home_path_gate_tree "$T/s" "$H" 2>&1)"
if printf '%s' "$out" | /usr/bin/grep -qF "app/bin/odd|name"; then pass "an offending file whose name holds a | is still named"
else fail "a | in a file name must not lose the list: $out"; fi

stage; printf '#!/bin/bash\n# e.g. /Users/<user>/work/workers/x\n' > "$T/s/app/bin/agent-supervisor.sh"
if home_path_gate_tree "$T/s" "$H" 2>/dev/null; then pass "a placeholder build folder in a SCRIPT under app/bin/ is not refused (the any-account check reads compiled files only)"
else fail "a script comment under app/bin/ must not trip the any-account check"; fi

stage
for bad in "/Users/" "//"; do
  if ! home_path_gate_tree "$T/s" "$bad" 2>/dev/null; then pass "an unusable home with a trailing slash ('$bad') is refused"
  else fail "an unusable home ('$bad') must be refused"; fi
done

stage; printf '// %s/x\n' "$H" >> "$T/s/app/server.js"
if ! home_path_gate_tree "$T/s" "$H//" 2>/dev/null; then pass "a hit is still found when the home is given with trailing slashes"
else fail "a home given as '$H//' must still find the hit"; fi

stage; printf '// see /Users/jo.hn+x/work\n' >> "$T/s/app/server.js"
if ! home_path_gate_tree "$T/s" "/Users/jo.hn+x" 2>/dev/null; then pass "a home with a dot and a plus is found literally"
else fail "a home with a dot and a plus must be found"; fi
stage; printf '// see /Users/joXhnnx/work\n' >> "$T/s/app/server.js"
if home_path_gate_tree "$T/s" "/Users/jo.hn+x" 2>/dev/null; then pass "its dot and plus are not wildcards (/Users/joXhnnx is not a hit for /Users/jo.hn+x)"
else fail "a home's dot and plus must not act as a pattern"; fi

stage
if ( HOME="$H"; home_path_gate_tree "$T/s" ) 2>/dev/null; then pass "CONTROL: with no home given, a clean stage passes under \$HOME"
else fail "with no home given and a usable \$HOME, a clean stage must pass (the default arm below would be vacuous)"; fi
stage; printf '// %s/x\n' "$H" >> "$T/s/app/server.js"
out="$( ( HOME="$H"; home_path_gate_tree "$T/s" ) 2>&1 )"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | /usr/bin/grep -qF "app/server.js"; then pass "with no home given, \$HOME is used and the hit is found and named (the build's own call)"
else fail "the default \$HOME must find and name the hit (rc=$rc): $out"; fi

stage; printf 'HOME=%s\n' "$H" >> "$T/s/app/server.js"
if ! home_path_gate_tree "$T/s" "$H" 2>/dev/null; then pass "the home at the very end of a line is refused"
else fail "the home at the end of a line must be refused"; fi

stage; ln -s /nonexistent/elsewhere "$T/s/app/lnk"
if ! home_path_gate_tree "$T/s" "$H" 2>/dev/null; then pass "a symlink in the stage is refused (grep -r would not read through it)"
else fail "a symlink in the stage must be refused"; fi

B="$HERE/build-kosmos-bundle.sh"
if /usr/bin/grep -qx 'home_path_gate_tree "$STAGE" || exit 1' "$B"; then pass "the bundle build still calls the gate"
else fail "tools/build-kosmos-bundle.sh no longer calls home_path_gate_tree (the gate is unarmed)"; fi

if [ "$fails" -ne 0 ]; then echo "$fails check(s) failed"; exit 1; fi
echo "all checks passed"
