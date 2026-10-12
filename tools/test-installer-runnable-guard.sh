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
#    if/elif/while/until) up to the guard, no || (&& for the negated form) and no ! negating a command. That is
#    stricter than the shell needs (A || B && [ -f P ] && [ -x P ] is safe and still flagged): fail-closed on
#    purpose, so loosen it only with a control that shows the -x cannot run without the -f. A line ending in
#    \, &&, || or | is joined to the next before it is judged (and reported at its first line). So
#    "[ -f P ] || [ -x P ]", "[ -x P ] # [ -f P ]", "x || [ -f P ] && [ -x P ]" and "! [ -f P ] && [ -x P ]"
#    are all flagged. Quoted text is blanked before the joiners are read. A case arm "a) [ -f P ] && ..." and a
#    prefix assignment "x=1 [ -f P ] && ..." are flagged too (fail-closed): put the test on its own line.
#      The -x tests are found on the whole line; a comment is cut only when looking for guards, so a [ -f P ]
#    in a comment guards nothing and an -x written after code in a comment is flagged (fail-closed).
#      KNOWN FAIL-OPEN LIMIT: quotes are tracked one logical line at a time, so a string begun on an earlier
#    line blanks the real ; and || on the line where it ends, and an || there can be missed. Do not put a
#    guarded -x on the line that closes a multi-line string.
#      Not this shape at all: "test -x P", "[ A -a -x P ]", "[  -x P ]" and any other -x inside [ ] or test
#    on a code line (a trailing comment included) is flagged as a form the scan cannot judge: write it as
#    [ -f P ] && [ -x P ]. The guard must itself be a command, so "echo [ -f P ] && [ -x P ]" is flagged.
#    Any missing guard is a directory-accepting site. Red if any is added.
_scan='
# skel: the line with every quoted string (and everything in it) replaced by X, same length. A backslash
# outside single quotes escapes the next character, so an escaped quote opens nothing and \\ before a quote
# does not escape it.
function skel(l,   o, i, c, q, sq) {
  o = ""; q = ""; sq = sprintf("%c", 39)
  for (i = 1; i <= length(l); i++) {
    c = substr(l, i, 1)
    if (c == "\\" && q != sq && i < length(l)) { o = o (q == "" ? c "X" : "XX"); i++ }
    else if (q == "") { if (c == "\"" || c == sq) q = c; o = o c }
    else if (c == q) { q = ""; o = o c }
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
# reaches(line, gpos, glen, xpos, p, join, bad): does the guard at gpos reach the -x test at xpos?
function reaches(line, gpos, glen, xpos, p, join, bad,   btw, sk, seg, i, c) {
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
  # The guard must itself be a command: at the start of the segment or right after a joiner, not an
  # argument (echo [ -f P ] && [ -x P ] runs the -x unguarded). This also refuses a ! before the guard.
  if (seg !~ /^[ \t]*$/ && seg !~ /(&&|\|\|)[ \t]*$/) return 0
  return 1
}
# otherx: an -x inside [ ] or a test command (test stops at ; | and &, so a later tar -x is not one).
function otherx(l) { return match(l, /(\[[^]]*|(^|[^A-Za-z0-9_])test([ \t][^;|&]*)?)[ \t]-x([ \t]|$)/) }
# scanline: judge one logical line (continuation lines joined) of file f; n is where it starts. full is the
# line as written and cut is the same line with its comment cut off. The -x tests are found on full, so a
# false comment cut (a # inside $( ) or in a string begun on the line before) cannot hide one; the guards
# are looked for only on cut, so a [ -f P ] in a comment guards nothing and an -x in a comment has no guard.
function scanline(full, cut, n, f,   s, t, u, off, at, len, p, g) {
  s = full; off = 0
  while (match(s, /\[ -x ("[^"]+"|[^] ]+) \]/)) {
    at = RSTART; len = RLENGTH   # reaches() calls match(), which resets RSTART and RLENGTH
    p = substr(s, at, len); sub(/^\[ -x /, "", p); sub(/ \]$/, "", p)
    g = "[ -f " p " ]"
    if (!reaches(cut, lastat(cut, g, off + at), length(g), off + at, p, "&&", "||"))
      printf "%s:%d: bare [ -x %s ] (a directory passes)\n", f, n, p
    off += at + len - 1; s = substr(s, at + len)
  }
  t = full; off = 0
  while (match(t, /\[ ! -x ("[^"]+"|[^] ]+) \]/)) {
    at = RSTART; len = RLENGTH
    p = substr(t, at, len); sub(/^\[ ! -x /, "", p); sub(/ \]$/, "", p)
    g = "[ ! -f " p " ]"
    if (!reaches(cut, lastat(cut, g, off + at), length(g), off + at, p, "\\|\\|", "&&"))
      printf "%s:%d: bare [ ! -x %s ] (a directory reads as executable)\n", f, n, p
    off += at + len - 1; t = substr(t, at + len)
  }
  # Any other -x test: drop the forms judged above, then look for one more, on the line as written (a test
  # inside quotes, as in sh -c, is still a test) and on the skeleton (a ] inside quotes cannot end a bracket).
  u = full
  gsub(/\[ (! )?-x ("[^"]+"|[^] ]+) \]/, "", u)
  if (otherx(u) || otherx(skel(u)))
    printf "%s:%d: a -x test this scan cannot judge (write it as [ -f P ] && [ -x P ])\n", f, n
}
FNR == 1 && buf != "" { scanline(buf, buf, bufn, buff); buf = "" }
# A line that is only a comment runs nothing (and may sit inside a continued command).
/^[ \t]*#/ { next }
{
  full = $0; code = $0
  if (match(skel(code), /(^|[ \t])#/)) code = substr(code, 1, RSTART - 1)
  # The lines before are joined as their cut text, so full and code differ only in the comment of this line, and a
  # position on full is the same position on code.
  if (buf != "") { code = buf " " code; full = buf " " full }
  # A line ending in a backslash, &&, || or | continues on the next one: judge them as one line, so an ||
  # at the end of the line before cannot skip a guard on this one.
  if (match(skel(code), /(\\|&&|\|\||\|)[ \t]*$/)) {
    if (buf == "") { bufn = FNR; buff = FILENAME }
    buf = code; sub(/\\[ \t]*$/, "", buf); next
  }
  if (buf != "") { scanline(full, code, bufn, buff); buf = "" } else scanline(full, code, FNR, FILENAME)
}
END { if (buf != "") scanline(buf, buf, bufn, buff) }'
for _f in $FILES; do [ -f "$HERE/$_f" ] || fail "installer file $_f is missing: the scan below would pass on nothing"; done
bare="$(cd "$HERE" && awk "$_scan" $FILES 2>/dev/null)" || fail "the scan itself failed (awk exit $?), so a clean result below means nothing"
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
  echo it\'s || [ -f "$P" ] && [ -x "$P" ] && run "$P"
  echo "a\\" || [ -f "$P" ] && [ -x "$P" ] && run "$P"
  sh -c 'test -x "$1"' _ "$P" && run "$P"
  true || ${X} [ -f "$P" ] && [ -x "$P" ] && run "$P"
  echo [ -f "$P" ] && [ -x "$P" ] && run "$P"
  [ "a]b" -a -x "$P" ] && run "$P"
  ! [ ! -f "$P" ] || [ ! -x "$P" ] || echo usable
FLAG
if [ "$_flags" -eq "$_nflag" ] && [ "$_nflag" -ge 21 ]; then pass "#5986: every shape the old rule excused or never read is flagged ($_flags controls, each passing the old rule)"
else fail "#5986: $_flags of $_nflag must-flag controls flagged (at least 21 expected)"; fi
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
  [ -f "$P" ] && [ -x "$P" ] && run "$P"   # a trailing comment, with no test written in it
  echo "it\'s || not a join" && [ -f "$P" ] && [ -x "$P" ] && run "$P"
  echo "$P" | grep -q test; tar -x -f "$A"
  [ -n it\'s ] && [ -f "$P" ] && [ -x "$P" ] && run "$P"
CLEAN
if [ "$_clean" -eq "$_nclean" ] && [ "$_nclean" -ge 13 ]; then pass "#5986: the guarded shapes the installer uses stay clean ($_clean controls)"
else fail "#5986: $_clean of $_nclean guarded shapes stayed clean (at least 13 expected)"; fi
# Continued lines are one command: an || ending the line before reaches a guard on this one (flagged), and
# a guard continued from the line before still counts (clean). Each must-flag pair passes the old rule.
printf '%s\n' '  command -v foo >/dev/null ||' '  [ -f "$P" ] && [ -x "$P" ] && run "$P"' > "$_ctl"
_o1="$(awk "$_scan" "$_ctl" 2>/dev/null)"; _p1="$(awk "$_old" "$_ctl" 2>/dev/null)"
printf '%s\n' '  true || \' '  [ -f "$P" ] && [ -x "$P" ] && run "$P"' > "$_ctl"
_o2="$(awk "$_scan" "$_ctl" 2>/dev/null)"; _p2="$(awk "$_old" "$_ctl" 2>/dev/null)"
printf '%s\n' '  if [ -n "$P" ] \' '      && [ -f "$P" ] && [ -x "$P" ]; then run "$P"; fi' > "$_ctl"
_o3="$(awk "$_scan" "$_ctl" 2>/dev/null)"
printf '%s\n' '  [ -n "$C" ] && # why this one' '  [ -f "$C" ] && [ -x "$C" ] && run "$C"' > "$_ctl"
_o3="$_o3$(awk "$_scan" "$_ctl" 2>/dev/null)"
# A comment ending in || is not a continuation: without the comment cut this pair would be joined and flagged.
printf '%s\n' '  run "$A"   # then a ||' '  [ -f "$P" ] && [ -x "$P" ] && run "$P"' > "$_ctl"
_o3="$_o3$(awk "$_scan" "$_ctl" 2>/dev/null)"
if [ -n "$_o1" ] && [ -n "$_o2" ] && [ -z "$_p1" ] && [ -z "$_p2" ] && [ -z "$_o3" ]; then
  pass "#5986: an || ending the line before is flagged (both forms, each passing the old rule); a && continuation (with a comment) and a comment ending in || stay clean"
else fail "#5986: continued lines judged wrongly (flagged: [$_o1] [$_o2]; old rule: [$_p1] [$_p2]; must stay clean: [$_o3])"; fi
# A # inside $( ) or inside quotes is not a comment, and the line scan cannot always tell: a false cut must
# not hide an -x after it. (The old rule flagged these too; this keeps it so.)
_n=0
while IFS= read -r _l; do
  printf '%s\n' "$_l" > "$_ctl"
  [ -n "$(awk "$_scan" "$_ctl" 2>/dev/null)" ] && _n=$((_n + 1)) || fail "an -x after a false comment cut was hidden: $_l"
done <<'CUT'
  X="$(printf "%s #%d" a 1)" ; [ -x /bin/foo ] && run
  X="$(foo "a #b")"; [ -x "$P" ] && run "$P"
CUT
if [ "$_n" -eq 2 ]; then pass "#5986: an -x after a # that is not a comment is still flagged (2 controls)"
else fail "#5986: $_n of 2 false-cut controls flagged"; fi
rm -f "$_ctl"

echo "installer runnable-guard: $fails failures"
[ "$fails" -eq 0 ]
