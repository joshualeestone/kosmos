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
#    Any missing guard is a directory-accepting site. Red if any is added.
#    NOT covered (a line scan of the bracket form only): `test -x P`, `[ P1 -a -x P ]`, `[  -x P ]` with two
#    spaces, and an -f excuse placed behind || or in a comment (#5986).
#
#    #5913: a test of whether a FOLDER can be entered uses -x on purpose. A line scan cannot parse shell well
#    enough to tell a safe folder test from an unsafe one (a || list, a heredoc or a comment on the line before,
#    an unquoted variable, and more), so no shape is excused. Each folder test is excused by name instead: the
#    exact line, with the exact code line before it (blank and comment-only lines skipped), listed below. Edit
#    either line, or add a folder test anywhere, and this guard goes red until a person reads it and lists it.
FOLDER_SEARCH_TESTS="$(printf '%s\n' \
  'while [ ! -e "$a" ] && [ ! -L "$a" ] && [ "$a" != / ]; do a="$(/usr/bin/dirname "$a")"; done' \
  '[ -d "$a" ] && [ -x "$a" ] || return 0   # a folder search test, listed in tools/test-installer-runnable-guard.sh' \
  'fi' \
  '[ -d "$SEALED_USERS_DIR" ] && [ ! -L "$SEALED_USERS_DIR" ] && [ -r "$SEALED_USERS_DIR" ] && [ -x "$SEALED_USERS_DIR" ] || return 0')"
export FOLDER_SEARCH_TESTS
_scan='
BEGIN {
  # FOLDER_SEARCH_TESTS holds pairs of lines: the code line before, then the folder test.
  n = split(ENVIRON["FOLDER_SEARCH_TESTS"], a, "\n")
  for (i = 1; i < n; i += 2) listed[a[i] "\n" a[i + 1]] = 1
}
FNR == 1 { prevcode = "" }
{
  line = $0
  t = line; sub(/^[ \t]+/, "", t); sub(/[ \t]+$/, "", t)
  folder = ((prevcode "\n" t) in listed)
  s = line
  while (match(s, /\[ -x ("[^"]+"|[^] ]+) \]/)) {
    p = substr(s, RSTART, RLENGTH); sub(/^\[ -x /, "", p); sub(/ \]$/, "", p)
    if (index(line, "[ -f " p " ]") == 0 && !folder)
      printf "%s:%d: bare [ -x %s ] (a directory passes)\n", FILENAME, FNR, p
    s = substr(s, RSTART + RLENGTH)
  }
  u = line
  while (match(u, /\[ ! -x ("[^"]+"|[^] ]+) \]/)) {
    p = substr(u, RSTART, RLENGTH); sub(/^\[ ! -x /, "", p); sub(/ \]$/, "", p)
    if (index(line, "[ ! -f " p " ]") == 0)
      printf "%s:%d: bare [ ! -x %s ] (a directory reads as executable)\n", FILENAME, FNR, p
    u = substr(u, RSTART + RLENGTH)
  }
  if (t != "" && substr(t, 1, 1) != "#") prevcode = t
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

# 4. #5913: each listed folder test is excused with its own line before it, and nothing else is.
_ctl="$(mktemp)"
_nl=$(printf '%s\n' "$FOLDER_SEARCH_TESTS" | grep -c .)
[ $((_nl % 2)) -eq 0 ] && [ "$_nl" -ge 2 ] && pass "the folder test list holds $((_nl / 2)) pair(s)" || fail "the folder test list is not pairs of lines ($_nl lines)"
# The pairs as they appear in a file: indented, with a blank line and a comment between them, as in setup.sh.
printf '%s\n' "$FOLDER_SEARCH_TESTS" | awk 'NR % 2 == 1 { print "    " $0; print ""; print "    # a comment"; next } { print "    " $0 }' > "$_ctl"
if [ -z "$(awk "$_scan" "$_ctl" 2>/dev/null)" ]; then pass "each listed folder test is excused after its listed line (a blank and a comment line between)"
else fail "a listed folder test was flagged after its listed line: $(awk "$_scan" "$_ctl" 2>/dev/null | head -1)"; fi
# The same folder tests are flagged after any other line before them, and every other folder test shape is flagged.
_first_test="$(printf '%s\n' "$FOLDER_SEARCH_TESTS" | sed -n 2p)"
set -- \
  "  true ||
  $_first_test" \
  "  cat >f <<X ||
body
X
  $_first_test" \
  "  [ -n \"\$F\" ] ||#c
  $_first_test" \
  "  $_first_test" \
  '  [ -d $P ] && [ -x $P ] || return 0' \
  '  [ -d "$P" ] && [ -x "$P" ] || return 0' \
  '  [ -d "$OTHER" ] && [ -x "$DIR" ] || return 0' \
  '  [ -d "$P" ] || [ -x "$P" ] && run "$P"' \
  '  ! [ -d "$P" ] && [ -x "$P" ] && run "$P"' \
  '  [ -d "$P" ] && [ -x "$P" ] || return 1'
_n=0
for _l in "$@"; do
  printf '%s\n' "$_l" > "$_ctl"
  if [ "$(awk "$_scan" "$_ctl" 2>/dev/null | grep -c .)" -ge 1 ]; then _n=$((_n + 1))
  else fail "this was not flagged: $(printf '%s' "$_l" | tr '\n' '/')"; fi
done
[ "$_n" -eq "$#" ] && pass "a listed folder test after another line (a || list, a heredoc opened on ||, ||#), or alone, and every unlisted folder test, is flagged ($# controls)"
rm -f "$_ctl"

echo "installer runnable-guard: $fails failures"
[ "$fails" -eq 0 ]
