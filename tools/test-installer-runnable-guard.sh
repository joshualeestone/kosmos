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

# 2. COVERAGE: every executable test in the installer must guard the SAME path.
#    This covers the WHOLE class, not just the quoted positive form -- a guard
#    narrower than the class it names is the bug it was written to prevent:
#      [ -x P ]     (P = "quoted" or an unquoted /path)  needs  [ -f P ]
#      [ ! -x P ]   (the negated form: a +x dir reads as executable there too)
#                                                        needs  [ ! -f P ]
#    Any missing guard is a directory-accepting site. Red if any is added.
_scan='
{
  line = $0
  s = line
  while (match(s, /\[ -x ("[^"]+"|[^] ]+) \]/)) {
    p = substr(s, RSTART, RLENGTH); sub(/^\[ -x /, "", p); sub(/ \]$/, "", p)
    if (index(line, "[ -f " p " ]") == 0)
      printf "%s:%d: bare [ -x %s ] (a directory passes)\n", FILENAME, FNR, p
    s = substr(s, RSTART + RLENGTH)
  }
  t = line
  while (match(t, /\[ ! -x ("[^"]+"|[^] ]+) \]/)) {
    p = substr(t, RSTART, RLENGTH); sub(/^\[ ! -x /, "", p); sub(/ \]$/, "", p)
    if (index(line, "[ ! -f " p " ]") == 0)
      printf "%s:%d: bare [ ! -x %s ] (a directory reads as executable)\n", FILENAME, FNR, p
    t = substr(t, RSTART + RLENGTH)
  }
}'
bare="$(cd "$HERE" && awk "$_scan" $FILES 2>/dev/null)"
if [ -z "$bare" ]; then
    pass "no unguarded executable test in the installer (positive or negated, quoted or unquoted)"
else
    fail "unguarded executable test site(s) remain:"
    printf '%s\n' "$bare" | sed 's/^/        /'
fi

# 3. CONTROL: the scan can produce the dangerous answer for EACH form it claims
#    to cover -- an unquoted positive AND a negated test both get flagged. This
#    is what proves the widened scan is not vacuous for a form.
_ctl="$(mktemp)"
{
  printf '  if [ -x /opt/some/bin/thing ]; then :; fi\n'
  printf '  if [ ! -x "$SOME/bin/thing" ]; then :; fi\n'
} > "$_ctl"
_hits="$(awk "$_scan" "$_ctl" 2>/dev/null | grep -c .)"
if [ "$_hits" -eq 2 ]; then pass "the scan flags both a planted unquoted [ -x ] and a planted [ ! -x ] (not vacuous)"
else fail "the scan missed a planted bare form (flagged $_hits of 2), so it is vacuous for some form"; fi
rm -f "$_ctl"

echo "installer runnable-guard: $fails failures"
[ "$fails" -eq 0 ]
