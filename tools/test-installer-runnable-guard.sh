#!/bin/bash
# #1716: [ -x "$p" ] succeeds on a DIRECTORY, so a directory named like a binary
# reads as an installed program. Every executable test in the shipped installer
# must guard the SAME path with -f. This test (1) demonstrates the class and
# (2) asserts no bare, unguarded [ -x "P" ] remains in the three installer files.
#
# Sibling #1616 is the same class for fs.existsSync in JavaScript; #1592 fixed
# the JavaScript fs.accessSync definition. This is the shell origin.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
FILES="install/kosmos install/setup.sh install/kosmos-report-hook.sh"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails + 1)); }

# 1. THE CLASS, demonstrated with a control that can produce the dangerous answer:
#    a directory with the execute bit passes bare [ -x ] but not [ -f ] && [ -x ].
_td="$(mktemp -d)"; mkdir -p "$_td/kosmos"; chmod +x "$_td/kosmos"
if [ -x "$_td/kosmos" ]; then pass "a +x directory passes bare [ -x ] (the bug this card is about)"
else fail "control: [ -x DIR ] should be true on a +x directory, so the fix below means something"; fi
if [ -f "$_td/kosmos" ] && [ -x "$_td/kosmos" ]; then
    fail "[ -f ] && [ -x ] wrongly ACCEPTED a directory"
else pass "[ -f ] && [ -x ] rejects a directory (the guarded form)"; fi
# and it still accepts a real executable file
printf '#!/bin/sh\n' > "$_td/realbin"; chmod +x "$_td/realbin"
if [ -f "$_td/realbin" ] && [ -x "$_td/realbin" ]; then pass "[ -f ] && [ -x ] still accepts a real executable file"
else fail "[ -f ] && [ -x ] wrongly rejected a real executable file"; fi
rm -rf "$_td"

# 2. COVERAGE: every line carrying [ -x "P" ] in the installer must also carry
#    [ -f "P" ] for the SAME path P on that line. A bare one is a directory-
#    accepting site. This is the regression guard: it goes red if any site is
#    added or reverted to the bare form.
bare="$(cd "$HERE" && awk '
{
  line = $0
  s = line
  while (match(s, /\[ -x "[^"]+" \]/)) {
    p = substr(s, RSTART, RLENGTH)
    sub(/^\[ -x "/, "", p); sub(/" \]$/, "", p)
    guard = "[ -f \"" p "\" ]"
    if (index(line, guard) == 0)
      printf "%s:%d: bare [ -x \"%s\" ] (a directory passes)\n", FILENAME, FNR, p
    s = substr(s, RSTART + RLENGTH)
  }
}' $FILES 2>/dev/null)"
if [ -z "$bare" ]; then
    pass "no bare [ -x ] in the installer (every executable test is same-path -f-guarded)"
else
    fail "bare [ -x ] site(s) remain:"
    printf '%s\n' "$bare" | sed 's/^/        /'
fi

# 3. CONTROL for the coverage grep: it can actually FIND a bare site. Feed it one.
_ctl="$(mktemp)"; printf '  if [ -x "$SOME/bin/thing" ]; then :; fi\n' > "$_ctl"
_hit="$(awk '{ s=$0; while (match(s, /\[ -x "[^"]+" \]/)) { p=substr(s,RSTART,RLENGTH); sub(/^\[ -x "/,"",p); sub(/" \]$/,"",p); if (index($0, "[ -f \"" p "\" ]")==0) print "bare"; s=substr(s,RSTART+RLENGTH) } }' "$_ctl")"
[ -n "$_hit" ] && pass "coverage check is not vacuous (it flags a planted bare [ -x ])" \
  || fail "coverage check FAILED to flag a planted bare [ -x ] -- it is vacuous"
rm -f "$_ctl"

echo "installer runnable-guard: $fails failures"
[ "$fails" -eq 0 ]
