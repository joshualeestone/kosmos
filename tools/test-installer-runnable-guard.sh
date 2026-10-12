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
#      [ -x P ]     (P = "quoted" or an unquoted /path)  needs  [ -f P ] && before it
#      [ ! -x P ]   (the negated form: a +x dir reads as executable there too)
#                                                        needs  [ ! -f P ] || before it
#    #5986: the guard has to REACH the -x. It must come before it on the same line, joined to it by && (|| for
#    the negated form), with nothing between but other bracket tests on the same path. And the command that
#    holds it must not let the -x run without it: from where that command starts (a ; { ( ` or then/do/else/
#    if/elif/while/until) up to the guard, no || (&& for the negated form) and no ! negating a command. So
#    "[ -f P ] || [ -x P ]", "[ -x P ] # [ -f P ]", "x || [ -f P ] && [ -x P ]" and "! [ -f P ] && [ -x P ]"
#    are all flagged. Quoted text is blanked before the joiners are read.
#      Not this shape at all: "test -x P", "[ A -a -x P ]", "[  -x P ]" and any other -x inside [ ] or test
#    outside a comment is flagged as a form the scan cannot judge: write it as [ -f P ] && [ -x P ].
#    Any missing guard is a directory-accepting site. Red if any is added.
_scan='
# skel: the line with every quoted string (and everything in it) replaced by X, same length.
function skel(l,   o, i, c, q, sq) {
  o = ""; q = ""; sq = sprintf("%c", 39)
  for (i = 1; i <= length(l); i++) {
    c = substr(l, i, 1)
    if (q == "") { if (c == "\"" || c == sq) q = c; o = o c }
    else if (c == q && !(q == "\"" && i > 1 && substr(l, i - 1, 1) == "\\")) { q = ""; o = o c }
    else o = o "X"
  }
  return o
}
# lastat(l, n, before): where the last n in l starts before position before (0 if none).
function lastat(l, n, before,   at, i, k) {
  at = 0; i = 0
  while ((k = index(substr(l, i + 1), n)) > 0 && i + k < before) { i += k; at = i }
  return at
}
# reaches(gpos, glen, xpos, p, join, bad): does the guard at gpos reach the -x test at xpos?
function reaches(gpos, glen, xpos, p, join, bad,   btw, sk, seg, i, c) {
  if (gpos == 0) return 0
  btw = substr(line, gpos + glen, xpos - gpos - glen)
  for (;;) {
    if (!sub("^[ \t]*" join "[ \t]*", "", btw)) return 0
    if (btw == "") break
    if (!match(btw, /^\[ (! )?-[a-zA-Z] /)) return 0
    btw = substr(btw, RLENGTH + 1)
    if (index(btw, p " ]") != 1) return 0
    btw = substr(btw, length(p) + 3)
  }
  sk = skel(line); seg = substr(sk, 1, gpos - 1)
  for (i = length(seg); i >= 1; i--) { c = substr(seg, i, 1); if (c == ";" || c == "{" || c == "(" || c == "`") break }
  seg = substr(seg, i + 1)
  while (sub(/^[ \t]*(then|do|else|if|elif|while|until)[ \t]+/, "", seg)) ;
  if (index(seg, bad) > 0) return 0
  if (match(seg, /(^|&&|\|\|)[ \t]*![ \t]/)) return 0
  return 1
}
{
  # A comment is cut first (found on the skeleton, so a # inside quotes is kept): a -x in a comment runs nothing,
  # and a [ -f P ] in a comment guards nothing.
  line = $0
  if (match(skel(line), /(^|[ \t])#/)) line = substr(line, 1, RSTART - 1)
  s = line; off = 0
  while (match(s, /\[ -x ("[^"]+"|[^] ]+) \]/)) {
    at = RSTART; len = RLENGTH   # reaches() calls match(), which resets RSTART and RLENGTH
    p = substr(s, at, len); sub(/^\[ -x /, "", p); sub(/ \]$/, "", p)
    g = "[ -f " p " ]"
    if (!reaches(lastat(line, g, off + at), length(g), off + at, p, "&&", "||"))
      printf "%s:%d: bare [ -x %s ] (a directory passes)\n", FILENAME, FNR, p
    off += at + len - 1; s = substr(s, at + len)
  }
  t = line; off = 0
  while (match(t, /\[ ! -x ("[^"]+"|[^] ]+) \]/)) {
    at = RSTART; len = RLENGTH   # reaches() calls match(), which resets RSTART and RLENGTH
    p = substr(t, at, len); sub(/^\[ ! -x /, "", p); sub(/ \]$/, "", p)
    g = "[ ! -f " p " ]"
    if (!reaches(lastat(line, g, off + at), length(g), off + at, p, "\\|\\|", "&&"))
      printf "%s:%d: bare [ ! -x %s ] (a directory reads as executable)\n", FILENAME, FNR, p
    off += at + len - 1; t = substr(t, at + len)
  }
  # Any other -x test (the comment is already cut): drop the forms judged above, then look for one more.
  u = line
  gsub(/\[ (! )?-x ("[^"]+"|[^] ]+) \]/, "", u)
  if (match(u, /(\[|(^|[^A-Za-z0-9_])test)[^]]*[ \t]-x([ \t]|$)/))
    printf "%s:%d: a -x test this scan cannot judge (write it as [ -f P ] && [ -x P ])\n", FILENAME, FNR
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

# 4. #5986: each shape the old same-line substring rule excused (or never looked at) is flagged, and the real
#    shapes the installer uses are not. _old is the rule before #5986, kept here so every must-flag line is shown
#    to pass it: a control that the old rule also fails would prove nothing about the change.
_old='{ l=$0; s=l; while (match(s, /\[ -x ("[^"]+"|[^] ]+) \]/)) { p=substr(s,RSTART,RLENGTH); sub(/^\[ -x /,"",p); sub(/ \]$/,"",p); if (index(l,"[ -f " p " ]")==0) print "x"; s=substr(s,RSTART+RLENGTH) } t=l; while (match(t, /\[ ! -x ("[^"]+"|[^] ]+) \]/)) { p=substr(t,RSTART,RLENGTH); sub(/^\[ ! -x /,"",p); sub(/ \]$/,"",p); if (index(l,"[ ! -f " p " ]")==0) print "x"; t=substr(t,RSTART+RLENGTH) } }'
_ctl="$(mktemp)"
_flags=0; _nflag=0
while IFS= read -r _l; do
  [ -n "$_l" ] || continue
  _nflag=$((_nflag + 1))
  printf '%s\n' "$_l" > "$_ctl"
  if [ -n "$(awk "$_old" "$_ctl" 2>/dev/null)" ]; then fail "control is not one the old rule passed, so it proves nothing: $_l"; continue; fi
  if [ -n "$(awk "$_scan" "$_ctl" 2>/dev/null)" ]; then _flags=$((_flags + 1)); else fail "not flagged: $_l"; fi
done <<'FLAG'
  [ -f "$P" ] || [ -x "$P" ] && run "$P"
  [ -x "$P" ] && run "$P"   # [ -f "$P" ]
  true || [ -f "$P" ] && [ -x "$P" ] && run "$P"
  ! [ -f "$P" ] && [ -x "$P" ] && run "$P"
  [ -n "$Q" ] && ! [ -f "$P" ] && [ -x "$P" ] && run "$P"
  [ -f "$P" ] && [ -r "$Q" ] && [ -x "$P" ] && run "$P"
  [ -x "$P" ] && [ -f "$P" ] && run "$P"
  test -x "$P" && run "$P"
  test -f "$P" && test -x "$P" && run "$P"
  [ -r "$P" -a -x "$P" ] && run "$P"
  [  -x "$P" ] && run "$P"
  [ -f "$P" ] && [ -x "$P" ] || [ -x "$P" ] && run "$P"
  [ ! -f "$P" ] && [ ! -x "$P" ] && echo missing
  true && [ ! -f "$P" ] || [ ! -x "$P" ] && echo missing
FLAG
[ "$_flags" -eq "$_nflag" ] && [ "$_nflag" -ge 14 ] && pass "#5986: every shape the old rule excused or never read is flagged ($_flags controls, each passing the old rule)"
_clean=0; _nclean=0
while IFS= read -r _l; do
  [ -n "$_l" ] || continue
  _nclean=$((_nclean + 1))
  printf '%s\n' "$_l" > "$_ctl"
  _o="$(awk "$_scan" "$_ctl" 2>/dev/null)"
  if [ -z "$_o" ]; then _clean=$((_clean + 1)); else fail "a guarded shape was flagged: $_l ($_o)"; fi
done <<'CLEAN'
  if [ -f "$P" ] && [ -x "$P" ]; then run "$P"; fi
  [ -n "$C" ] && [ -f "$C" ] && [ -x "$C" ] || continue
  { [ -f "$P" ] && [ -x "$P" ]; } || P="$(command -v p)"
  if [ -z "$T" ] || ! { [ -f "$T" ] && [ -x "$T" ]; }; then :; fi
  if [ -f "$P" ] && [ ! -L "$P" ] && [ -x "$P" ]; then run "$P"; fi
  elif [ -f "$A" ] && [ -f "$P" ] && [ -x "$P" ] && command -v x >/dev/null 2>&1; then
  { [ "$(uname -s)" = Linux ] && [ -f "$T" ] && [ -x "$T" ]; } || { [ -f "$U" ] && [ -x "$U" ]; } || die "x || y"
  if [ -z "$K" ] || [ ! -f "$K" ] || [ ! -x "$K" ]; then die; fi
  f() { [ -f "$1" ] && [ -x "$1" ] || command -v "$1" >/dev/null 2>&1 || return 1; }
  [ -f "$P" ] && [ -x "$P" ] && run "$P"   # not [ -x "$P" ] alone, and test -x is not used
CLEAN
[ "$_clean" -eq "$_nclean" ] && [ "$_nclean" -ge 10 ] && pass "#5986: the guarded shapes the installer uses stay clean ($_clean controls)"
rm -f "$_ctl"

echo "installer runnable-guard: $fails failures"
[ "$fails" -eq 0 ]
