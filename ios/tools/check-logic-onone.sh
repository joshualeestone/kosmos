#!/usr/bin/env bash
# kosmos#9213: fails when an iOS logic-test compile is not plainly -Onone. The suites compile with -Onone; a branch
# that started before that change can land a run*.sh with -O after it (run-updates.sh did). Usage, from the repo
# root or with the root as $1: ios/tools/check-logic-onone.sh [root]
# It reads every *.sh under ios/LogicTests and ios/tools (this file aside), drops comment lines and trailing
# " # ..." comments first (a comment never continues onto the next line, as in bash), then joins lines continued
# with a trailing backslash. Each command that names swiftc, by name or by path, must carry a literal -Onone and no
# other -O flag (-O, -Osize, -Ounchecked, ...: bare, quoted, escaped, or after = or a comma). A bare mention such as
# `command -v swiftc` counts as a command too and fails, which errs toward red. A command still open when its file
# ends is checked too.
# It reads text, so it cannot see: a flag in a variable or array (unless it stands in for -Onone), swiftc named
# through a variable, a function or another script, the `swift` driver or swift-frontend, and anything after a
# " #" inside a quoted string (taken for a comment).
# Exit 0: every swiftc command is -Onone. Exit 1: one is not (each is printed as file:first-line: command).
# Exit 2: nothing could be checked: a folder missing, no *.sh file, no swiftc command, or awk failing.
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
  function judge(cmd) {
    if (cmd !~ /(^|[^[:alnum:]_.-])swiftc([^[:alnum:]_.-]|$)/) return
    n++
    if (cmd !~ /[[:space:]]-Onone([[:space:]]|$)/ || cmd ~ /[[:space:]"\047=,(\\]-O([^n]|$)/) print "BAD " file ":" start ": " cmd
  }
  # A command still open when its file ends (last line ends in a backslash) is judged, never dropped.
  FNR == 1 { if (buf != "") judge(buf); buf = ""; file = FILENAME }
  {
    line = $0
    if (buf == "") {
      if (line ~ /^[[:space:]]*#/) next
      start = FNR
    }
    # A trailing comment ends the line before any backslash in it can continue it, as in bash.
    sub(/[[:space:]]#.*$/, "", line)
    if (line ~ /\\$/) { buf = buf substr(line, 1, length(line) - 1) " "; next }
    cmd = buf line; buf = ""
    judge(cmd)
  }
  END { if (buf != "") judge(buf); print "COUNT " n + 0 }
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
