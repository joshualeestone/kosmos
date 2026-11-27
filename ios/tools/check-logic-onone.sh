#!/usr/bin/env bash
# kosmos#9213: fails when an iOS logic-test compile is not plainly -Onone. The suites compile with -Onone; a branch
# that started before that change can land a run*.sh with -O after it (run-updates.sh did). Usage, from the repo
# root or with the root as $1: ios/tools/check-logic-onone.sh [root]
# It reads every *.sh under ios/LogicTests and ios/tools (this file aside), joins lines continued with a trailing
# backslash, drops comment lines and trailing " # ..." comments, and for each command that runs swiftc requires a
# literal -Onone and no other -O flag (-O, -Osize, -Ounchecked, ...). A flag passed through a variable has no
# literal -Onone beside it, so it fails too.
# Exit 0: every swiftc command is -Onone. Exit 1: one is not (each is printed as file:first-line: command).
# Exit 2: nothing could be checked (a folder missing, or no swiftc command found at all).
set -u
root="${1:-.}"
dirs=("$root/ios/LogicTests" "$root/ios/tools")
for d in "${dirs[@]}"; do
  [ -d "$d" ] || { echo "check-logic-onone: $d is missing, so nothing was checked"; exit 2; }
done
files=()
while IFS= read -r f; do files+=("$f"); done < <(find "${dirs[@]}" -type f -name '*.sh' ! -name 'check-logic-onone.sh' | sort)
[ "${#files[@]}" -gt 0 ] || { echo "check-logic-onone: no *.sh file found, so nothing was checked"; exit 2; }
report="$(awk '
  FNR == 1 { buf = ""; start = 0 }
  {
    if (buf == "") start = FNR
    line = $0
    if (line ~ /\\$/) { buf = buf substr(line, 1, length(line) - 1) " "; next }
    buf = buf line
    cmd = buf; buf = ""
    if (cmd ~ /^[[:space:]]*#/) next
    sub(/[[:space:]]#.*$/, "", cmd)
    if (cmd !~ /(^|[[:space:]])swiftc([[:space:]]|$)/) next
    n++
    if (cmd !~ /[[:space:]]-Onone([[:space:]]|$)/ || cmd ~ /[[:space:]]-O([^n]|$)/) print "BAD " FILENAME ":" start ": " cmd
  }
  END { print "COUNT " n + 0 }
' "${files[@]}")"
count="$(printf '%s\n' "$report" | sed -n 's/^COUNT //p')"
[ "${count:-0}" -gt 0 ] || { echo "check-logic-onone: no swiftc command found, so nothing was checked"; exit 2; }
bad="$(printf '%s\n' "$report" | sed -n 's/^BAD //p')"
if [ -n "$bad" ]; then
  printf '%s\n' "$bad"
  echo "check-logic-onone: compile iOS logic tests with a literal -Onone and no other -O flag (kosmos#9213)"
  exit 1
fi
echo "check-logic-onone: $count swiftc commands, all -Onone"
