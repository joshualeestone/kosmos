#!/bin/bash
# kosmos#4911 (Mona Lisa's finding, 2026-10-02): the pre-commit "$? after a pipe" lint (#632) refused
# tools/test-light-side-4911.sh on six correct lines, so any commit staging that file (a merge of main into an
# older branch) was refused. Two shapes were misread:
#   - "cmd || sed ..." : the "|" of "||" was read as a pipe into sed;
#   - "cmd; rc=$?" one or two lines after an unrelated pipe: that $? is cmd's own status.
# This runs the hook's OWN program (the region between PIPE-LINT-BEGIN and PIPE-LINT-END in .githooks/pre-commit),
# not a copy, against each shape, and against the real hazard it exists for, which must still be caught.
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
  FIX="$1" bash -c 'git() { cat "$FIX"; }; f=x.sh; eval "$1"; printf "%s" "$hits"' _ "$REGION"
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
[ -z "$(lint "$T/ownstatus.sh")" ] && ok "'cmd; rc=\$?' reads cmd's own status, whatever pipe came before" || bad "'cmd; rc=\$?' after an unrelated pipe was refused"

printf '%s\n' "x $P grep y" 'true' "out=\"\$(run_it 2>&1)\"; rc=$Q" "V=1 run_it; rc=$Q" > "$T/assigncmd.sh"
[ -z "$(lint "$T/assigncmd.sh")" ] && ok "an assignment from a command, or before one, still owns its status" || bad "an assignment from or before a command was refused: $(lint "$T/assigncmd.sh")"

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
mustflag "a comment between the pipe and the read" "yarn test $P tail -5" "# read it below; rc=$Q" "[ $Q -eq 0 ] || exit 1"
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

# The file the finding was about, as it is in this tree.
if [ -f "$HERE/tools/test-light-side-4911.sh" ]; then
  out="$(lint "$HERE/tools/test-light-side-4911.sh")"
  [ -z "$out" ] && ok "tools/test-light-side-4911.sh is accepted (it was refused on six correct lines)" || bad "test-light-side-4911.sh still refused: $out"
else
  bad "tools/test-light-side-4911.sh is missing, so the case this card is about was not checked"
fi

[ "$fails" -eq 0 ] && { echo "all pipe-lint checks passed"; exit 0; }
echo "$fails pipe-lint check(s) failed"; exit 1
