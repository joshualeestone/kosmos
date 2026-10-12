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
#    or, for a test of whether a FOLDER can be entered (#5913), the one exact shape dgated accepts.
#    Any missing guard is a directory-accepting site. Red if any is added.
#    NOT covered (a line scan of the bracket form only): `test -x P`, `[ P1 -a -x P ]`, `[  -x P ]` with two
#    spaces, and an -f excuse placed behind || or in a comment (#5986). A folder-shape P that runs code, such as
#    "$(mktemp)", is evaluated twice and could differ between the -d and the -x; nothing in the installer does that.
_scan='
# #5913: a SEARCH test on a folder (can this account enter it) is not the class. Exactly one shape is excused,
# the one the installer uses (setup.sh, sealed_icon_other_users): a whole command line, trailing comment aside,
#   [ -d P ] && [ -x P ] || return 0          or with more bracket tests on the same P between them, as in
#   [ -d P ] && [ ! -L P ] && [ -r P ] && [ -x P ] || return 0
# and the last code line before it does not continue into it (a trailing \, ||, && or |, comments ignored). A path
# that is not a folder fails the -d and returns before the -x. Any other way of writing a folder test is flagged
# (the safe direction); five review rounds of a general rule kept finding shell grammar a line scan cannot judge.
function dgated(line, p,    t, d, tail, rest, neg, flag) {
  if (contprev) return 0
  t = line; sub(/^[ \t]+/, "", t); sub(/[ \t]+#.*$/, "", t); sub(/[ \t]+$/, "", t)
  d = "[ -d " p " ]"; tail = p " ]"
  if (substr(t, 1, length(d)) != d) return 0
  t = substr(t, length(d) + 1)
  while (substr(t, 1, 6) == " && [ ") {
    rest = substr(t, 7); neg = 0
    if (substr(rest, 1, 2) == "! ") { rest = substr(rest, 3); neg = 1 }
    if (rest !~ /^-[a-zA-Z] /) return 0
    flag = substr(rest, 2, 1); rest = substr(rest, 4)
    if (substr(rest, 1, length(tail)) != tail) return 0
    t = substr(rest, length(tail) + 1)
    if (flag == "x") return (!neg && t == " || return 0")   # any -x ends it; only an un-negated last one passes
  }
  return 0
}
FNR == 1 { contprev = 0 }
{
  line = $0
  s = line
  while (match(s, /\[ -x ("[^"]+"|[^] ]+) \]/)) {
    p = substr(s, RSTART, RLENGTH); sub(/^\[ -x /, "", p); sub(/ \]$/, "", p)
    if (index(line, "[ -f " p " ]") == 0 && !dgated(line, p))
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
  # Does this line continue into the next one? Judged on the code without a trailing comment ("a || # why" continues,
  # review 10). A blank or comment-only line keeps the state of the line before it, as the shell skips it (review 9).
  # A line scan cannot tell a comment from a " #" inside quotes, so a code line holding both a quote and a " #"
  # is taken as continuing (fail closed: the next line is flagged, review 11).
  code = line; sub(/(^|[ \t]+)#.*$/, "", code)
  if (code !~ /^[ \t]*$/) contprev = (line ~ /[ \t]#/ && line ~ /["\047]/) ? 1 : (code ~ /(\\|&&|\|)[ \t]*$/)
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

# 4. #5913: the installer's folder SEARCH test shape is accepted, and nothing else is.
_ctl="$(mktemp)"
printf '  [ -d "$DIR" ] && [ -x "$DIR" ] || return 0   # why\n' > "$_ctl"
if [ -z "$(awk "$_scan" "$_ctl" 2>/dev/null)" ]; then pass "the exact folder search shape ([ -d P ] && [ -x P ] || return 0) is not flagged, a trailing comment aside"
else fail "the scan flagged the exact folder search shape"; fi
printf '  [ -d "$S" ] && [ ! -L "$S" ] && [ -r "$S" ] && [ -x "$S" ] || return 0\n' > "$_ctl"
if [ -z "$(awk "$_scan" "$_ctl" 2>/dev/null)" ]; then pass "the same shape with other bracket tests on P between is not flagged"
else fail "the scan flagged the folder search shape with tests between"; fi
# Each of these is flagged: most let a path that is NOT a folder reach the -x; the last three are safe
# folder tests in another shape, flagged on purpose because only the installer's shape is accepted (reviews 6 to 10).
set -- \
          '  [ -d "$OTHER" ] && [ -x "$DIR" ] || return 0' \
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
          '  echo "[ -d "$P" ]" && [ -x "$P" ] && run' \
          '  echo x{ [ -d "$P" ] && [ -x "$P" ] || return 0' \
          '  [ -d "$P" ] && [ -x "$P" ] || return 0; [ -x "$P" ]' \
          '  [ -d "$P" ] && [ -x "$P" ] || return 1' \
          '  if [ -d "$P" ] && [ -x "$P" ]; then :; fi' \
          '  x=1; [ -d "$P" ] && [ -x "$P" ] || return 0' \
          '  [ -d "$P" ] && [ -x "$P" ] && run "$P"'
_n=0
for _l in "$@"; do
  printf '%s\n' "$_l" > "$_ctl"
  if [ "$(awk "$_scan" "$_ctl" 2>/dev/null | grep -c .)" -ge 1 ]; then _n=$((_n + 1))
  else fail "this shape was not flagged: $_l"; fi
done
[ "$_n" -eq "$#" ] && pass "every other shape is flagged: another path, ||, ;, a || list before it, a keyword or { as an argument, an escaped ;, a comment, after it, negated, a second -x, a pipe, &, a string, and safe folder tests in another shape ($# controls)"
# A || list continued onto the -d line: across a blank and a comment line, behind a trailing comment, and by a \.
for _f in '  true ||\n  # c\n\n  [ -d "$P" ] && [ -x "$P" ] || return 0\n' \
          '  [ -n "$F" ] || # forced\n  [ -d "$P" ] && [ -x "$P" ] || return 0\n' \
          '  true || \\\n  [ -d "$P" ] && [ -x "$P" ] || return 0\n' \
          '  echo "x # y" ||\n  [ -d "$P" ] && [ -x "$P" ] || return 0\n'; do
  printf "$_f" > "$_ctl"
  if [ "$(awk "$_scan" "$_ctl" 2>/dev/null | grep -c .)" -eq 1 ]; then pass "a folder shape continued from a || list is flagged: $(head -1 "$_ctl")"
  else fail "a folder shape continued from a || list was excused: $(head -1 "$_ctl")"; fi
done
# CONTROL: after an ordinary code line (a quote, no " #"), the folder shape is still accepted.
printf '  a="$(/usr/bin/dirname "$P")"\n  [ -d "$a" ] && [ -x "$a" ] || return 0\n' > "$_ctl"
if [ -z "$(awk "$_scan" "$_ctl" 2>/dev/null)" ]; then pass "the folder shape after an ordinary quoted code line is not flagged"
else fail "an ordinary code line before the folder shape made it flagged"; fi
rm -f "$_ctl"

echo "installer runnable-guard: $fails failures"
[ "$fails" -eq 0 ]
