#!/bin/bash
# #1716: [ -x "$p" ] succeeds on a DIRECTORY, so a directory named like a binary
# reads as an installed program. Every executable test in the shipped installer
# must guard the SAME path with -f (or, for a folder search test, gate it with -d;
# see section 2). This test (1) demonstrates the class and
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
#    or, for a test of whether a FOLDER can be entered (#5913), [ -d P ] gating it (see dgated).
#    Any missing guard is a directory-accepting site. Red if any is added.
_scan='
# #5913: a SEARCH test on a folder (can this account enter it) is not the class, but only when a folder test
# gates THIS -x: a [ -d P ] earlier on the line that STARTS a command, and between the two nothing but " && "
# joining bracket tests on the same P (for example [ ! -L P ] or [ -r P ]). "Starts a command" means the text
# before it is empty (and the last code line before does not continue into it with \, ||, && or |), or ends in
# an unescaped ; { ( or in then, do, else, if, elif, while or until as the FIRST word after the line start or
# a ; (so "echo then [ -d P ]" is not a start, review 9). So a negation (! [ -d P ]) or an earlier list (a || [ -d P ], which
# the shell groups as (a || [ -d P ]) && [ -x P ], review 8) is not a gate. Then a path that is not a folder
# never reaches the -x. Anything else (||, ;, a pipe, &, a string, a subshell, another path) is not read as a
# gate: a folder test written another way is flagged, which is the safe direction (reviews 7, 8).
function dgated(line, p, xi,    pre, d, from, k, di, t, tail, before) {
  pre = substr(line, 1, xi - 1); d = "[ -d " p " ]"; tail = p " ]"; from = 1
  while ((k = index(substr(pre, from), d)) > 0) {
    di = from + k - 1; from = di + 1
    before = substr(line, 1, di - 1); sub(/[ \t]+$/, "", before)
    if (before == "") { if (contprev) continue }
    else if (before !~ /(^|[^\\])[;{(]$/ && before !~ /(^|[^\\];)[ \t]*(then|do|else|if|elif|while|until)$/) continue
    t = substr(pre, di + length(d))
    while (t != " && ") {
      if (substr(t, 1, 6) != " && [ ") break
      t = substr(t, 7)
      if (substr(t, 1, 2) == "! ") t = substr(t, 3)
      if (t !~ /^-[a-zA-Z] /) break
      t = substr(t, 4)
      if (substr(t, 1, length(tail)) != tail) break
      t = substr(t, length(tail) + 1)
    }
    if (t == " && ") return 1
  }
  return 0
}
FNR == 1 { contprev = 0 }
{
  line = $0
  s = line; off = 0
  while (match(s, /\[ -x ("[^"]+"|[^] ]+) \]/)) {
    p = substr(s, RSTART, RLENGTH); sub(/^\[ -x /, "", p); sub(/ \]$/, "", p)
    xi = off + RSTART; off = off + RSTART + RLENGTH - 1
    if (index(line, "[ -f " p " ]") == 0 && !dgated(line, p, xi))
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
  # Does this line continue into the next one (a trailing \, ||, && or |)? Then the next line does not start a command.
  # A blank or comment-only line keeps the state of the line before it, as the shell skips it (review 9).
  if (line !~ /^[ \t]*(#.*)?$/) contprev = (line ~ /(\\|&&|\|)[ \t]*$/)
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

# 4. #5913: a folder SEARCH test, [ -d P ] && [ -x P ] on one path, is accepted; a -d on a DIFFERENT path is not a guard.
_ctl="$(mktemp)"
printf '  [ -d "$DIR" ] && [ -x "$DIR" ] || return 0\n' > "$_ctl"
if [ -z "$(awk "$_scan" "$_ctl" 2>/dev/null)" ]; then pass "a folder search test ([ -d P ] && [ -x P ]) is not flagged"
else fail "the scan flagged a folder search test guarded by -d on the same path"; fi
printf '  [ -d "$S" ] && [ ! -L "$S" ] && [ -r "$S" ] && [ -x "$S" ] || return 0\n' > "$_ctl"
if [ -z "$(awk "$_scan" "$_ctl" 2>/dev/null)" ]; then pass "a folder search test with other && tests between is not flagged"
else fail "the scan flagged a folder search test joined by && through other tests"; fi
printf '  if [ -d "$P" ] && [ -x "$P" ]; then :; fi\n  x=1; [ -d "$P" ] && [ -x "$P" ] || return 0\n  if true; then [ -d "$P" ] && [ -x "$P" ]; fi\n' > "$_ctl"
if [ -z "$(awk "$_scan" "$_ctl" 2>/dev/null)" ]; then pass "a folder search test after if, a ; or then is not flagged (it starts a command)"
else fail "the scan flagged a folder search test that starts a command after if or ;"; fi
# Each of these lets a path that is NOT a folder reach an -x, so each must be flagged exactly once (reviews 6, 7, 8).
_n=0
for _l in '  [ -d "$OTHER" ] && [ -x "$DIR" ] || return 0' \
          '  [ -d "$P" ] || [ -x "$P" ] && run "$P"' \
          '  [ -d "$P" ] && [ -r "$P" ]; [ -x "$P" ] && "$P" --version' \
          '  true || [ -d "$P" ] && [ -x "$P" ] && run "$P"' \
          '  [ -z "$X" ] || [ -d "$P" ] && [ -x "$P" ]' \
          '  echo then [ -d "$P" ] && [ -x "$P" ] && run' \
          '  echo a\; [ -d "$P" ] && [ -x "$P" ] && run' \
          '  [ -x "$P" ] && run "$P"   # was [ -d "$P" ] before' \
          '  [ -x "$P" ] && [ -d "$P" ] && run "$P"' \
          '  ! [ -d "$P" ] && [ -x "$P" ] && run "$P"' \
          '  [ -d "$P" ] && [ -x "$P" ] || [ -x "$P" ]' \
          '  [ -d "$P" ] && [ -x "$P" ]; [ -x "$P" ] && run' \
          '  [ -d "$P" ] | [ -x "$P" ] && run' \
          '  [ -d "$P" ] & [ -x "$P" ] && run' \
          '  echo "[ -d "$P" ]" && [ -x "$P" ] && run'; do
  printf '%s\n' "$_l" > "$_ctl"
  if [ "$(awk "$_scan" "$_ctl" 2>/dev/null | grep -c .)" -eq 1 ]; then _n=$((_n + 1))
  else fail "a -d that does not gate the -x excused it: $_l"; fi
done
[ "$_n" -eq 15 ] && pass "a -d that does not gate the -x excuses nothing: another path, ||, ;, after a || list, a keyword as an argument, an escaped ;, a comment, after it, negated, a second -x, a pipe, &, a string (15 controls)"
# A || list continued past a comment and a blank line (review 9): the shell skips both, so the -d line still continues it.
printf '  true ||\n  # c\n\n  [ -d "$P" ] && [ -x "$P" ] && run "$P"\n' > "$_ctl"
if [ "$(awk "$_scan" "$_ctl" 2>/dev/null | grep -c .)" -eq 1 ]; then pass "a -d after a || list continued past a comment and a blank line is not a gate"
else fail "a comment or blank line after || reset the continuation and excused the -x"; fi
# The same || list split over two lines with a trailing \ (review 8): the second line does not start a command.
printf '  true || \\\n  [ -d "$P" ] && [ -x "$P" ] && run "$P"\n' > "$_ctl"
if [ "$(awk "$_scan" "$_ctl" 2>/dev/null | grep -c .)" -eq 1 ]; then pass "a -d on a line continued from a || list is not a gate"
else fail "a -d on a line continued from a || list excused the -x"; fi
rm -f "$_ctl"

echo "installer runnable-guard: $fails failures"
[ "$fails" -eq 0 ]
