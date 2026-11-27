#!/usr/bin/env bash
# kosmos#9213: ios/tools/check-logic-onone.sh fails when an iOS logic-test compile turns the optimizer back on, and
# says so (exit 2) when it could check nothing. Each arm runs the REAL script on a copy of ios/LogicTests and ios/tools
# with one line changed; the control arm is the unchanged copy. Also pins its wiring: the build job's last step runs it.
set -u
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="$HERE/.."
T="$(mktemp -d "${TMPDIR:-/tmp}/test-ios-logic-onone-9213.XXXXXXXXXX")"; trap 'rm -rf "${T:?}"' EXIT
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }

fresh() { # a clean copy of the two folders the check reads, at $T/r
  rm -rf "${T:?}/r"; mkdir -p "$T/r/ios"
  cp -R "$REPO/ios/LogicTests" "$REPO/ios/tools" "$T/r/ios/"
}
check() { bash "$REPO/ios/tools/check-logic-onone.sh" "$T/r" > "$T/out" 2>&1; echo $?; }
expect() { # <label> <want-rc> [<sed expression applied to run-updates.sh>]
  fresh
  if [ -n "${3:-}" ]; then
    sed -i.bak "$3" "$T/r/ios/LogicTests/run-updates.sh"
    if cmp -s "$T/r/ios/LogicTests/run-updates.sh" "$T/r/ios/LogicTests/run-updates.sh.bak"; then
      fail "$1: the mutation changed nothing, so this arm tests nothing"; return
    fi
    rm -f "${T:?}/r/ios/LogicTests/run-updates.sh.bak"
  fi
  local got; got="$(check)"
  if [ "$got" = "$2" ]; then pass "$1 (exit $got)"; else fail "$1: exit $got, want $2: $(head -2 "$T/out")"; fi
}

ON='s|swiftc -Onone -o|swiftc -O -o|'
expect "CONTROL: the tree as committed is all -Onone"                    0
expect "-O right after swiftc"                                          1 "$ON"
expect "-Osize"                                                         1 's|swiftc -Onone -o|swiftc -Osize -o|'
expect "-Ounchecked"                                                    1 's|swiftc -Onone -o|swiftc -Ounchecked -o|'
expect "a tab before -O"                                                1 's|swiftc -Onone -o|swiftc	-O -o|'
expect "-O later on the line, after -o and its path"                    1 's|swiftc -Onone -o "\$out/updates-logic-tests"|swiftc -o "$out/updates-logic-tests" -O|'
expect "-O at the end of the line"                                      1 's|\(swiftc -Onone -o "\$out/updates-logic-tests"\) \\$|\1 -O|'
expect "a comment that names swiftc -O is not a compile"                0 '1a\
# do not use swiftc -O here (kosmos#9213)'
expect "-O alone on a continuation line of the swiftc command"        1 '/swiftc -Onone -o/a\
  -O \\
'
expect "no optimizer flag at all (nothing says -Onone)"                 1 's|swiftc -Onone -o|swiftc -o|'
expect "a quoted \"-O\" in place of -Onone"                              1 's|swiftc -Onone -o|swiftc "-O" -o|'
expect "the flag passed through a variable in place of -Onone"          1 's|swiftc -Onone -o|swiftc $OPT -o|'
expect "a quoted \"-O\" beside -Onone (swiftc takes the later flag)"     1 's|swiftc -Onone -o|swiftc -Onone "-O" -o|'
expect "swiftc called by its path"                                      1 's|xcrun swiftc -Onone -o|/usr/bin/swiftc -O -o|'
expect "-O attached with = (a frontend flag) beside -Onone"             1 's|swiftc -Onone -o|swiftc -Onone -Xfrontend=-O -o|'
expect "a comment ending in a backslash does not hide the next line"    1 '/swiftc -Onone -o/i\
# a note that ends in a backslash \\\
xcrun swiftc -O -o "$out/x" "$here/x.swift"
'
expect "a trailing comment that names -O, on the command's last line"   0 's|"\$here/updates/main.swift"$|"$here/updates/main.swift" # was -O|'

fresh; rm -rf "${T:?}/r/ios/tools"
got="$(check)"; if [ "$got" = 2 ]; then pass "a missing folder is exit 2, not a pass"; else fail "a missing folder: exit $got, want 2"; fi
fresh; find "$T/r/ios" -name '*.sh' -exec sed -i.bak 's/swiftc/swift-compiler/g' {} +
got="$(check)"; if [ "$got" = 2 ]; then pass "no swiftc line at all is exit 2, not a pass"; else fail "no swiftc line: exit $got, want 2"; fi

# The count it reports is the real count (presence, not only absence).
fresh; bash "$REPO/ios/tools/check-logic-onone.sh" "$T/r" > "$T/out" 2>&1
want="$(grep -rE --include='*.sh' --exclude='check-logic-onone.sh' 'swiftc' "$T/r/ios/LogicTests" "$T/r/ios/tools" | grep -vcE '^[^:]+:[[:space:]]*#')"
if grep -q "check-logic-onone: $want swiftc commands, all -Onone" "$T/out" && [ "$want" -gt 20 ]; then
  pass "it reports the $want swiftc commands it read (one per line holding swiftc, counted here by grep)"
else
  fail "reported count: $(cat "$T/out"), want $want (more than 20)"
fi

if ! command -v ruby >/dev/null 2>&1; then
  echo "skip the wiring arm: no ruby to parse YAML (test-ci-ios-route-8993 skips the same way)"
elif ruby -ryaml -e '
  s = YAML.load_file(ARGV[0])["jobs"]["build"]["steps"]
  raise "the last build step runs the check, it is #{s.last["name"]}" unless s.last["run"].to_s.strip == "ios/tools/check-logic-onone.sh"
  raise "no if: on it, so a red suite above still ends the job red and this never runs alone" if s.last.key?("if")
' "$REPO/.github/workflows/ios.yml" 2>"$T/rb.err"; then
  pass "ios.yml: the build job ends by running ios/tools/check-logic-onone.sh"
else
  fail "ios.yml wiring: $(head -2 "$T/rb.err")"
fi
[ -x "$REPO/ios/tools/check-logic-onone.sh" ] && pass "the check is executable (the step runs it by path)" || fail "ios/tools/check-logic-onone.sh is not executable"

if [ "$fails" -ne 0 ]; then echo "test-ios-logic-onone-9213: $fails failed"; exit 1; fi
echo "test-ios-logic-onone-9213: all passed"
