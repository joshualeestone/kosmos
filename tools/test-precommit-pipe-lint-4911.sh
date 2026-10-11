#!/bin/bash
# kosmos#4911 (Mona Lisa's finding, 2026-10-02): the pre-commit "$? after a pipe" lint (#632) refused
# tools/test-light-side-4911.sh on six correct lines, so any commit staging that file (a merge of main into an
# older branch) was refused. Two shapes were misread:
#   - "cmd || sed ...": the "|" of "||" was read as a pipe into sed. Fixed: "||" (and an escaped "\|") is never a pipe.
#   - "cmd; rc=<status>" one or two lines after an unrelated pipe: that status is cmd's own. A line-based lint cannot
#     tell this from the hazard (nine review rounds of heuristics each let a real hazard through), so the author says
#     so on the line: "# pipe-status-ok". Without it the line is still refused.
# This runs the hook's OWN program (the region between PIPE-LINT-BEGIN and PIPE-LINT-END in .githooks/pre-commit),
# not a copy, under /bin/sh, against each shape and against the hazards the lint exists for, which must still be caught.
set -u
HERE="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$HERE/.githooks/pre-commit"
REGION="$(sed -n '/# PIPE-LINT-BEGIN/,/# PIPE-LINT-END/p' "$HOOK")"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
fails=0
ok()  { printf 'ok   %s\n' "$1"; }
bad() { printf 'BAD  %s\n' "$1"; fails=$((fails + 1)); }

[ -n "$REGION" ] || { echo "BAD  the PIPE-LINT markers are gone from $HOOK, so this test checks nothing"; exit 1; }
case "$REGION" in *'awk '*) ;; *) echo "BAD  the marked region holds no awk program"; exit 1 ;; esac

# lint <file>: what the hook prints for it (empty = accepted).
lint() {
  # Under /bin/sh, the interpreter the hook runs under (#!/bin/sh), not bash.
  FIX="$1" /bin/sh -c 'git() { cat "$FIX"; }; f=x.sh; eval "$1"; printf "%s" "$hits"' _ "$REGION"
}
flags() { [ -n "$(lint "$1")" ]; }

# The fixtures are built from these pieces so this file never holds the shapes the lint refuses (it lints itself on
# commit): P is a pipe, Q the exit-status variable, O the "or echo 0" tail.
P='|'; Q='$''?'; O='|''| echo 0'

printf '%s\n' "yarn test $P tail -5" "[ $Q -eq 0 ] || exit 1" > "$T/hazard.sh"
flags "$T/hazard.sh" && ok "the #632 hazard is still caught: a pipe, then \$? on the next line" || bad "the #632 hazard is no longer caught"

printf '%s\n' "x=\$(make $P tail -1); rc=$Q" > "$T/sameline.sh"
flags "$T/sameline.sh" && ok "a pipe and the status read on the same line is still caught" || bad "a same-line pipe then \$? passed"

printf '%s\n' "sed -i '' '6d' f 2>/dev/null || sed -i '6d' f" "rc=$Q" > "$T/oror.sh"
[ -z "$(lint "$T/oror.sh")" ] && ok "a 'cmd || sed' fallback is not a pipe" || bad "'|| sed' read as a pipe: $(lint "$T/oror.sh")"

printf '%s\n' "echo \"calls=\$(grep -c . f $P tr -d x)\"" 'true' "run_it --flag 2> err; rc=$Q" > "$T/ownstatus.sh"
flags "$T/ownstatus.sh" && ok "without the marker, 'cmd; rc=' after a pipe is still refused (a line lint cannot tell)" || bad "an unmarked 'cmd; rc=' after a pipe was accepted"
printf '%s\n' "echo \"calls=\$(grep -c . f $P tr -d x)\"" 'true' "run_it --flag 2> err; rc=$Q  # pipe-status-ok" > "$T/marked.sh"
[ -z "$(lint "$T/marked.sh")" ] && ok "with the marker, 'cmd; rc=' after an unrelated pipe is accepted" || bad "a marked own-status line was refused: $(lint "$T/marked.sh")"
printf '%s\n' "x=\$(make $P tail -1); rc=$Q  # pipe-status-ok" > "$T/markedsame.sh"
flags "$T/markedsame.sh" && ok "the marker does not excuse a pipe on its own line" || bad "the marker excused a same-line pipe"
printf '%s\n' "yarn test $P tail -5" "true  # pipe-status-ok" "[ $Q -eq 0 ] || exit 1" > "$T/markedother.sh"
flags "$T/markedother.sh" && ok "a marker on a line that reads no status excuses nothing" || bad "a marker on another line excused the read"
printf '%s\n' "yarn test $P tail -5" "# see $Q  # pipe-status-ok" "[ $Q -eq 0 ] || exit 1" > "$T/markedcomment.sh"
flags "$T/markedcomment.sh" && ok "a marked comment that only mentions the status excuses nothing" || bad "a marked comment line excused the real read"
printf '%s\n' "yarn test $P tail -5" "foo; rc=$Q; echo \"x # pipe-status-ok\" y" > "$T/markedmid.sh"
flags "$T/markedmid.sh" && ok "a marker in the middle of a line, with code after it, excuses nothing" || bad "a mid-line marker excused the read"
printf '%s\n' "yarn test $P tail -5" "foo; rc=$Q#pipe-status-ok" > "$T/markednospace.sh"
flags "$T/markednospace.sh" && ok "a marker glued to code (not a comment) excuses nothing" || bad "a marker that is not a comment excused the read"
printf '%s\n' "yarn test $P tail -5" "n=\${#a[@]} foo; rc=$Q  # pipe-status-ok" > "$T/markedcount.sh"
[ -z "$(lint "$T/markedcount.sh")" ] && ok "a correctly marked line with \${#...} in its code is accepted" || bad "a \${#...} before the status hid the marker: $(lint "$T/markedcount.sh")"
printf '%s\n' "echo a\\$P$P tail -1" "rc=$Q" > "$T/escapedpipe.sh"
flags "$T/escapedpipe.sh" && ok "an escaped pipe right before a real one keeps the real pipe" || bad "an escaped pipe hid the real pipe after it"

printf '%s\n' "x $P grep y" 'true' "out=\"\$(run_it 2>&1)\"; rc=$Q  # pipe-status-ok" "V=1 run_it; rc=$Q  # pipe-status-ok" "out=\$(PATH=\"x:\$PATH\" run_it a b); rc=$Q  # pipe-status-ok" > "$T/assigncmd.sh"
[ -z "$(lint "$T/assigncmd.sh")" ] && ok "marked assignments from or before a command are accepted" || bad "an assignment from or before a command was refused: $(lint "$T/assigncmd.sh")"
printf '%s\n' "x $P grep y" "out=\$(PATH=\"x:\$PATH\" run_it a b); rc=$Q  # pipe-status-ok" > "$T/assignsubst.sh"
[ -z "$(lint "$T/assignsubst.sh")" ] && ok "a marked assignment from a prefixed command, right after a pipe, is accepted" || bad "an assignment from a prefixed command was refused: $(lint "$T/assignsubst.sh")"

printf '%s\n' 'set -o pipefail' "yarn test $P tail -5" "[ $Q -eq 0 ]" > "$T/pipefail.sh"
[ -z "$(lint "$T/pipefail.sh")" ] && ok "CONTROL: under pipefail the shape is accepted, as before" || bad "pipefail no longer accepted"

printf '%s\n' "n=\$(grep -c x f $O)" > "$T/grepc.sh"
flags "$T/grepc.sh" && ok "CONTROL: the grep-count-or-echo-zero shape is still caught" || bad "the grep-count-or-echo-zero shape is no longer caught"

# Must still flag: each shape below passes the PIPE's status on, so an own-status rule that cleared it would let a
# real #632 hazard through (blind review round 1 found all five escaped the first version of the rule).
mustflag() { # <label> <line>...
  local label="$1"; shift
  printf '%s\n' "$@" > "$T/mf.sh"
  flags "$T/mf.sh" && ok "still caught: $label" || bad "escaped the lint: $label"
}
mustflag "a loop closer (done; rc=)" 'for i in 1; do' "  yarn test $P tail -5" "done; rc=$Q"
mustflag "an if closer (fi; rc=)" 'if true; then' "  yarn test $P tail -5" "fi; rc=$Q"
mustflag "a group closer (}; rc=)" '{' "  yarn test $P tail -5" "}; rc=$Q"
mustflag "a subshell closer (); rc=)" '(' "  yarn test $P tail -5" "); rc=$Q"
mustflag "a status read before the semicolon" "yarn test $P tail -5" "st=$Q; other=$Q"
mustflag "a semicolon inside quotes" "yarn test $P tail -5" "echo \"suite finished; status=$Q\""
# The continued line starts with a plain word (an argument of grep), so only the continuation rule can catch it.
mustflag "a continued pipe line" "yarn test $P grep \\" "  failed; rc=$Q"
mustflag "a comment between the pipe and the read" "yarn test $P tail -5" "# read it below" "[ $Q -eq 0 ] || exit 1"
mustflag "a function ending in the pipe, then its own call" 'run() {' "  yarn test $P tail -5" '}' "run; rc=$Q"
mustflag "a continued pipe line in a CRLF file" "yarn test $P grep \\"$'\r' "  failed; rc=$Q"$'\r'
mustflag "a pipeline continued by a trailing pipe" "yarn test 2>&1 $P tee log $P" "  tail -5; rc=$Q"
mustflag "a one-line function, then its call" "run() { yarn test $P tail -5; }" "run; rc=$Q"
mustflag "a decorated function closer, then its call" 'run() {' "  yarn test $P tail -5" '} 2>&1' "run; rc=$Q"
mustflag "a subshell-bodied function, then its call" 'run() (' "  yarn test $P tail -5" ')' "run; rc=$Q"
mustflag "a builtin that always succeeds owns no status" "yarn test $P tail -5" "local rc; rc=$Q"
mustflag "a pipe of its own before the semicolon" "x $P grep y" "foo $P jq .; rc=$Q"
mustflag "a trailing-pipe pipeline across a blank line" "make $P grep x $P" '' "tail -5; rc=$Q"
mustflag "a trailing-pipe pipeline across a comment" "make $P grep x $P" '# c' "tail -5; rc=$Q"
mustflag "a function closed on the pipe's own line" 'f() {' "  make $P tail -1; }" "f; rc=$Q"
mustflag "a subshell function closed on the pipe's own line" 'f() (' "  make $P tail -1; )" "f; rc=$Q"
mustflag "assignments alone own no status" "yarn test $P tail -5" "x=1; rc=$Q"
mustflag "a pipe line ending in an or-fallback" "yarn test $P tail -5 ||" "  report failed; rc=$Q"
mustflag "a pipe line ending in an and-chain" "yarn test $P tail -5 &&" "  report done; rc=$Q"
mustflag "a function closer with a trailing comment" 'f() {' "  make $P tail -1; } # end" "f; rc=$Q"
mustflag "a function closer with a trailing redirect" 'f() {' "  make $P tail -1; } 2>/dev/null" "f; rc=$Q"
mustflag "a subshell body closed on the pipe line without a semicolon" 'f() (' "  make $P tail -1 )" "f; rc=$Q"
mustflag "echo owns no status" "yarn test $P tail -5" "echo ran; rc=$Q"
mustflag "a sourced file is a function defined elsewhere" "yarn test $P tail -5" ". ./lib.sh; rc=$Q"
mustflag "arithmetic alone owns no status" "yarn test $P tail -5" "n=\$((n+1)); rc=$Q"
mustflag "an array assignment alone owns no status" "yarn test $P tail -5" "a=(1 2); rc=$Q"
mustflag "an append or element assignment alone owns no status" "yarn test $P tail -5" "a+=x; b[1]=y; rc=$Q"
mustflag "a mixed-quote assignment alone owns no status" "yarn test $P tail -5" "a=x\"y z\"; rc=$Q"
mustflag "a semicolon inside a comment" "yarn test $P tail -5" "x=1 # n; rc=$Q" "[ $Q -eq 0 ]"
mustflag "a status line whose last command is echo" "yarn test $P tail -5" "a; echo done; rc=$Q"
mustflag "a compound command before the status" "yarn test $P tail -5" "if foo; then bar; fi; rc=$Q"
mustflag "a prefixed always-zero builtin" "yarn test $P tail -5" "FOO=1 true; rc=$Q"
mustflag "a wrapper of another command" "yarn test $P tail -5" "sudo true; rc=$Q"
mustflag "trap owns no status" "yarn test $P tail -5" "trap x EXIT; rc=$Q"
mustflag "a subshell body closed against the last word" 'f() (' "  make $P tail -1)" "f; rc=$Q"
mustflag "an escaped-space assignment alone" "yarn test $P tail -5" "x=a\\ b; rc=$Q"
mustflag "two assignments split by a semicolon" "yarn test $P tail -5" "x=1 ; y=2; rc=$Q"
mustflag "a trailing pipe with a comment after it" "yarn test 2>&1 $P tee log $P   # keep a copy" "  tail -5; rc=$Q"
mustflag "an and-chain with a comment after it" "yarn test $P tail -5 &&  # then" "  report x; rc=$Q"
mustflag "a pipe-and-stderr continuation" "yarn test $P tee log $P&" "  tail -5; rc=$Q"
mustflag "a quoted filter argument that closes on the status line" "out=\"\$(yarn test 2>&1 $P sed \"s/a/b/" "  s/c/d/g\")\"; rc=$Q"
mustflag "a full path to an always-zero command" "yarn test $P tail -5" "/usr/bin/true; rc=$Q"
mustflag "a single-quoted literal that only looks like a substitution" "yarn test $P tail -5" "v='\$(x'; rc=$Q"
mustflag "a substitution that only runs as a default" "yarn test $P tail -5" "x=\${y:-\$(true)}; rc=$Q"
mustflag "return owns no status" "yarn test $P tail -5" "return; rc=$Q"

# The file the finding was about, as it is in this tree.
if [ -f "$HERE/tools/test-light-side-4911.sh" ]; then
  out="$(lint "$HERE/tools/test-light-side-4911.sh")"
  [ -z "$out" ] && ok "tools/test-light-side-4911.sh is accepted (it was refused on six correct lines)" || bad "test-light-side-4911.sh still refused: $out"
else
  bad "tools/test-light-side-4911.sh is missing, so the case this card is about was not checked"
fi

[ "$fails" -eq 0 ] && { echo "all pipe-lint checks passed"; exit 0; }
echo "$fails pipe-lint check(s) failed"; exit 1
