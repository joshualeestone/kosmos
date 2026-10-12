#!/bin/bash
# #1716: [ -x "$p" ] succeeds on a DIRECTORY, so a directory named like a binary
# reads as an installed program. Every executable test in the shipped installer
# must guard the SAME path with -f (a folder search test is listed by name instead;
# see section 2). This test (1) demonstrates the class and
# (2) asserts no bare, unguarded [ -x "P" ] remains in the three installer files.
#
# Sibling #1616 is the same class for fs.existsSync in JavaScript; #1592 fixed
# the JavaScript fs.accessSync definition. This is the shell origin.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
FILES="install/kosmos install/setup.sh install/kosmos-report-hook.sh"
fails=0
# Every scratch file below lands in one folder, removed by an EXIT trap (a normal end, a failure or a TERM; a KILL cannot be trapped).
_tmproot="$(mktemp -d)" || { echo "installer runnable-guard: could not make a scratch folder"; exit 1; }
trap 'rm -rf "$_tmproot"' EXIT
export TMPDIR="$_tmproot"
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
#    an unquoted variable, and more), so no shape is excused. Each folder test is listed by name below instead,
#    and the scan of the installer requires each listed test to appear exactly once where it is listed.
#    The listed line is trusted to gate its own -x with [ -d P ]: read it before listing it.
#    To add one, append three lines to FOLDER_SEARCH_TESTS: the file (as in FILES), the code line before the
#    test, and the test line itself, both trimmed of leading and trailing space. "The code line before" skips
#    blank and comment-only lines; a trailing comment is part of a line, so editing either line, its comment
#    included, reds this guard too. A line holding ' needs it written '\'' here. Only [ -x P ] can be listed:
#    a negated [ ! -x P ] is never excused. A test with no code line before it in its file cannot be listed.
FOLDER_SEARCH_TESTS="$(printf '%s\n' \
  'install/setup.sh' \
  'while [ ! -e "$a" ] && [ ! -L "$a" ] && [ "$a" != / ]; do a="$(/usr/bin/dirname "$a")"; done' \
  '[ -d "$a" ] && [ -x "$a" ] || return 0   # a folder search test, listed in tools/test-installer-runnable-guard.sh' \
  'install/setup.sh' \
  'fi' \
  '[ -d "$SEALED_USERS_DIR" ] && [ ! -L "$SEALED_USERS_DIR" ] && [ -r "$SEALED_USERS_DIR" ] && [ -x "$SEALED_USERS_DIR" ] || return 0')"
export FOLDER_SEARCH_TESTS
# With -v whole=1 (the installer scan), each listed test must be excused exactly once: a copy (a heredoc, a paste)
# or a stale entry is reported. The controls that only count flags leave it off.
_scan='
BEGIN {
  n = split(ENVIRON["FOLDER_SEARCH_TESTS"], a, "\n")
  for (i = 1; i + 2 <= n; i += 3) { key = a[i] "\n" a[i + 1] "\n" a[i + 2]; listed[key] = 1; seen[key] = 0 }
}
FNR == 1 { prevcode = "" }
{
  line = $0
  t = line; sub(/^[ \t]+/, "", t); sub(/[ \t]+$/, "", t)
  key = FILENAME "\n" prevcode "\n" t
  folder = (key in listed)
  if (folder) seen[key]++
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
}
END {
  if (whole) for (key in seen) if (seen[key] != 1) {
    split(key, k, "\n"); printf "%s: listed folder test found %d times, not once: %s\n", k[1], seen[key], k[3]
  }
}'
# An installer file that is missing would make awk stop with an error (hidden below) and the scan read as clean.
_scan_ok=1
for _f in $FILES; do [ -f "$HERE/$_f" ] || { fail "installer file $_f is missing, so the scan below cannot be trusted"; _scan_ok=0; }; done
bare="$(cd "$HERE" && awk -v whole=1 "$_scan" $FILES 2>/dev/null)"; _awk_rc=$?
[ "$_awk_rc" -eq 0 ] || { fail "the installer scan's awk exited $_awk_rc, so an empty result means nothing"; _scan_ok=0; }
if [ "$_scan_ok" -eq 0 ]; then
    :   # already failed above; an empty result is not a pass
elif [ -z "$bare" ]; then
    pass "no unguarded executable test in the installer (positive or negated, quoted or unquoted), and each listed folder test found once"
else
    fail "unguarded executable test site(s) remain, or a listed folder test is not found exactly once:"
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

# 4. #5913: each listed folder test is excused in its own file after its own line, once, and nothing else is.
_nl=$(printf '%s\n' "$FOLDER_SEARCH_TESTS" | grep -c .)
[ $((_nl % 3)) -eq 0 ] && [ "$_nl" -ge 3 ] && pass "the folder test list holds $((_nl / 3)) entries of three lines" || fail "the folder test list is not entries of three lines ($_nl lines)"
_cdir="$(mktemp -d)"; mkdir -p "$_cdir/install"
# rel <entry> <line within it>: one line of one list entry.
rel() { printf '%s\n' "$FOLDER_SEARCH_TESTS" | sed -n "$((($1 - 1) * 3 + $2))p"; }
# Each entry, written as it appears in its file (indented, a blank and a comment line between), in a scratch tree.
for _e in $(seq 1 $((_nl / 3))); do
  { printf '    %s\n\n    # a comment\n    %s\n' "$(rel "$_e" 2)" "$(rel "$_e" 3)"; } >> "$_cdir/$(rel "$_e" 1)"
done
_out="$(cd "$_cdir" && awk -v whole=1 "$_scan" $(printf '%s\n' "$FOLDER_SEARCH_TESTS" | awk 'NR % 3 == 1' | sort -u) 2>/dev/null)"; _awk_rc=$?
if [ "$_awk_rc" -eq 0 ] && [ -z "$_out" ]; then pass "each listed folder test is excused once in its file after its listed line (a blank and a comment between)"
else fail "a listed folder test was not excused as listed: $(printf '%s' "$_out" | head -1)"; fi
# The same, with every listed test copied once more inside a heredoc: the copies are reported (found twice).
for _e in $(seq 1 $((_nl / 3))); do
  { printf 'cat <<X\n%s\n%s\nX\n' "$(rel "$_e" 2)" "$(rel "$_e" 3)"; } >> "$_cdir/$(rel "$_e" 1)"
done
_out="$(cd "$_cdir" && awk -v whole=1 "$_scan" $(printf '%s\n' "$FOLDER_SEARCH_TESTS" | awk 'NR % 3 == 1' | sort -u) 2>/dev/null)"
if [ "$(printf '%s\n' "$_out" | grep -c 'found 2 times')" -eq "$((_nl / 3))" ]; then pass "a listed folder test copied a second time (in a heredoc) is reported, for every entry"
else fail "a copied listed folder test was not reported: $_out"; fi
# And with every listed file emptied: each entry is now stale and is reported (found 0 times).
for _e in $(seq 1 $((_nl / 3))); do : > "$_cdir/$(rel "$_e" 1)"; done
_out="$(cd "$_cdir" && awk -v whole=1 "$_scan" $(printf '%s\n' "$FOLDER_SEARCH_TESTS" | awk 'NR % 3 == 1' | sort -u) 2>/dev/null)"
if [ "$(printf '%s\n' "$_out" | grep -c 'found 0 times')" -eq "$((_nl / 3))" ]; then pass "a listed folder test that is no longer in its file is reported (a stale entry), for every entry"
else fail "a stale listed folder test was not reported: $_out"; fi
rm -rf "$_cdir"
# Every listed test after any other line, or alone, IN ITS OWN LISTED FILE (so only the line before differs), with its
# own line but in another file, and every unlisted folder test, is flagged. flagged <file> <text>: scan <text> as <file>.
_cdir="$(mktemp -d)"; mkdir -p "$_cdir/install"
_n=0; _total=0
flagged() {
  _total=$((_total + 1)); printf '%s\n' "$2" > "$_cdir/$1"
  if [ "$(cd "$_cdir" && awk "$_scan" "$1" 2>/dev/null | grep -c .)" -ge 1 ]; then _n=$((_n + 1))
  else fail "this was not flagged as $1: $(printf '%s' "$2" | tr '\n' '/')"; fi
}
for _e in $(seq 1 $((_nl / 3))); do
  _f="$(rel "$_e" 1)"; _t="$(rel "$_e" 3)"
  flagged "$_f" "  true ||
  $_t"
  flagged "$_f" "  cat >f <<X ||
body
X
  $_t"
  flagged "$_f" "  [ -n \"\$F\" ] ||#c
  $_t"
  flagged "$_f" "  $_t"
  flagged install/not-listed.sh "  $(rel "$_e" 2)
  $_t"
done
_f="$(rel 1 1)"
flagged "$_f" '  [ -d $P ] && [ -x $P ] || return 0'
flagged "$_f" '  [ -d "$P" ] && [ -x "$P" ] || return 0'
flagged "$_f" '  [ -d "$P" ] || [ -x "$P" ] && run "$P"'
flagged "$_f" '  ! [ -d "$P" ] && [ -x "$P" ] && run "$P"'
[ "$_n" -eq "$_total" ] && pass "in its own file, a listed test after any other line before it (the scan does not parse || or heredocs; only the exact line before counts) or alone is flagged; so is it in another file, and every unlisted folder test ($_total controls)"
# The line before does not carry across files: the first file ends with a listed line-before, the second starts with
# its listed test, and the test is flagged.
printf '  %s\n' "$(rel 1 2)" > "$_cdir/install/a-first.sh"; printf '  %s\n' "$(rel 1 3)" > "$_cdir/$(rel 1 1)"
if [ "$(cd "$_cdir" && awk "$_scan" install/a-first.sh "$(rel 1 1)" 2>/dev/null | grep -c .)" -ge 1 ]; then pass "the line before a listed test does not carry over from the previous file"
else fail "a listed test at the top of a file was excused by the last line of the file before it"; fi
rm -rf "$_cdir"
# A negated [ ! -x P ] is never excused, even when listed: a scan with a list naming one still flags it.
_ctl="$(mktemp)"; printf '  true\n  [ -d "$Q" ] && [ ! -x "$Q" ] || return 0\n' > "$_ctl"
_neg_list="$(printf '%s\n' "$_ctl" 'true' '[ -d "$Q" ] && [ ! -x "$Q" ] || return 0')"
if [ "$(FOLDER_SEARCH_TESTS="$_neg_list" awk "$_scan" "$_ctl" 2>/dev/null | grep -c .)" -eq 1 ]; then pass "a listed negated [ ! -x ] is still flagged (only [ -x ] can be listed)"
else fail "a listed negated [ ! -x ] was excused"; fi
rm -f "$_ctl"

echo "installer runnable-guard: $fails failures"
[ "$fails" -eq 0 ]
