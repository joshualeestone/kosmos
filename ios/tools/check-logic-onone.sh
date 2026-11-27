#!/usr/bin/env bash
# kosmos#9213: fails when an iOS logic-test compile is not plainly -Onone. The suites compile with -Onone; a branch
# that started before that change can land a run*.sh with -O after it (run-updates.sh did). Usage, from the repo
# root or with the root as $1: ios/tools/check-logic-onone.sh [root]
# It reads every *.sh under ios/LogicTests and ios/tools (this file aside), drops comment lines and trailing " # ..."
# comments first (a comment never continues onto the next line, as in bash), then joins lines continued with a
# trailing backslash, and for each command that names swiftc (by name or by path; a bare mention such as `command -v swiftc`
# counts too, and fails here, which errs toward red) requires a literal -Onone and no other -O
# flag (-O, -Osize, -Ounchecked, ..., bare, quoted, or after = or a comma). It reads text: a flag passed in a variable
# is caught only when it stands in for -Onone, swiftc reached through a function or another script is not seen at
# all, and a " #" inside a quoted string is taken for a comment, so anything after it on that command is not read.
# Exit 0: every swiftc command is -Onone. Exit 1: one is not (each is printed as file:first-line: command).
# Exit 2: nothing could be checked (a folder missing, or no swiftc command found at all).
set -u
root="${1:-.}"
dirs=("$root/ios/LogicTests" "$root/ios/tools")
for d in "${dirs[@]}"; do
  [ -d "$d" ] || { echo "check-logic-onone: $d is missing, so nothing was checked"; exit 2; }
done
files=()
while IFS= read -r f; do files+=("$f"); done < <(find "${dirs[@]}" -type f -name '*.sh' ! -path "$root/ios/tools/check-logic-onone.sh" | sort)
[ "${#files[@]}" -gt 0 ] || { echo "check-logic-onone: no *.sh file found, so nothing was checked"; exit 2; }
report="$(awk '
  FNR == 1 { buf = ""; start = 0 }
  {
    line = $0
    if (buf == "") {
      if (line ~ /^[[:space:]]*#/) next
      start = FNR
    }
    # A trailing comment ends the line before any backslash in it can continue it, as in bash.
    sub(/[[:space:]]#.*$/, "", line)
    if (line ~ /\\$/) { buf = buf substr(line, 1, length(line) - 1) " "; next }
    buf = buf line
    cmd = buf; buf = ""
    if (cmd !~ /(^|[^[:alnum:]_.-])swiftc([^[:alnum:]_.-]|$)/) next
    n++
    if (cmd !~ /[[:space:]]-Onone([[:space:]]|$)/ || cmd ~ /[[:space:]"\047=,]-O([^n]|$)/) print "BAD " FILENAME ":" start ": " cmd
  }
  END { print "COUNT " n + 0 }
' "${files[@]}")"; rc=$?
[ "$rc" -eq 0 ] || { echo "check-logic-onone: awk failed (rc $rc), so nothing can be trusted as checked"; exit 2; }
count="$(printf '%s\n' "$report" | sed -n 's/^COUNT //p')"
[ "${count:-0}" -gt 0 ] || { echo "check-logic-onone: no swiftc command found, so nothing was checked"; exit 2; }
bad="$(printf '%s\n' "$report" | sed -n 's/^BAD //p')"
if [ -n "$bad" ]; then
  printf '%s\n' "$bad"
  echo "check-logic-onone: compile iOS logic tests with a literal -Onone and no other -O flag (kosmos#9213)"
  exit 1
fi
echo "check-logic-onone: $count swiftc commands, all -Onone"
