#!/bin/bash
# Break the code on purpose and watch the named test go red.
#
#   bash tools/prove-it-fails.sh <test-file> <label> <node-expression>
#
# 🛑 IT REFUSES ON A DIRTY TREE, AND THAT REFUSAL IS THE WHOLE POINT. The loop
# ends in `git checkout` to undo the break, and `git checkout` discards
# UNCOMMITTED work with no warning. On 2026-08-21 that ate a real fix SEVEN
# TIMES in one day — twice it went unnoticed until a test written minutes later
# failed, and once a reverted state was committed on top.
#
# ⚠️ "Commit before you perturb" was written down after the first one and failed
# six more times. A habit that has to hold seven times a day is not a habit, it
# is a load-bearing assumption (Mona Lisa). So the tool holds it instead: it
# cannot run against work that a checkout would destroy.
#
# The expression is plain node, given the file as `f`:
#
#   bash tools/prove-it-fails.sh engine/trust.test.js "drop the symlink guard" \
#     "s = s.replace(\"if (fs.lstatSync\", \"if (false && fs.lstatSync\")"
set -uo pipefail
TESTFILE="${1:-}"; LABEL="${2:-}"; EXPR="${3:-}"
[ -n "$TESTFILE" ] && [ -n "$LABEL" ] && [ -n "$EXPR" ] || {
  echo "usage: bash tools/prove-it-fails.sh <test-file> <label> <node-expression>"; exit 2; }
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

DIRTY="$(git status --porcelain)"
if [ -n "$DIRTY" ]; then
  echo "REFUSING: the tree is dirty, and this ends in a checkout that would destroy it."
  echo "$DIRTY" | sed 's/^/    /'
  echo "  Commit first. That is the whole reason this refusal exists."
  exit 1
fi

# Which files the expression touches is not knowable in advance, so it is read after the break: the files that
# differ then (the tree was clean a moment ago) are the break, and only they are restored (kosmos#7619). A tracked
# file the TEST itself changes is therefore left as the test left it, and is not reported.
#
# ⚠️ THE FILE LIST INCLUDES SHELL, AND IT DID NOT UNTIL 2026-08-22. It globbed
# `*.js` and `*.html` only, so `install/setup.sh` — the file a stranger's whole
# first impression runs through — was UNPROVABLE. Every mutation aimed at it
# reported "the mutation did not apply", which reads as a badly written
# expression rather than as a hole in the tool, and the two guards written for
# it that night were covered by tests that READ the file with nothing ever
# showing they could fail.
# 📌 `install/kosmos` is named explicitly because it carries no extension: the
# launcher is shell, it holds one of the three copies of the default port, and
# a glob by suffix cannot see it. A list that misses a file silently is the
# same defect one level up.
#
# 🛑 AND A MUTATION IN SHELL CANNOT BE PROVED BY THE NODE SUITE. `yarn test`
# never executes setup.sh; what covers it is `tools/test-install.sh`, which
# really installs. So a shell mutation must name that file as its test target,
# and it takes minutes rather than seconds. The tool does not enforce which
# runner you point it at — it cannot know — but the trap is worth stating: a
# shell break "proved" against a node test file goes green for the same reason
# the mutation used to not apply at all.
#
# 🔑 AND WHEN YOU CANNOT USE THIS TOOL AND MUST PERTURB BY HAND, ASSERT THE PLANT
# TOOK (kosmos#1759). A perturbation that never applied returns GREEN, and GREEN
# is what a working guard looks like: a broken guard and an edit that never landed
# produce the SAME output, and nothing in the run separates them. ⇒ AN ARM SUPPOSED
# TO FAIL IS WORTH MORE THAN ONE SUPPOSED TO PASS -- a no-op perturbation cannot
# fake a red, but a green is equally consistent with the guard working, the edit
# not applying, the edit tool failing, or the file not being the one you think.
# For a hand edit this tool cannot run (a sed/perl/python on a workflow, a .rs in
# another repo): `assert old in s` / `grep -q` BEFORE writing, so a missed target
# fails LOUD instead of writing the file unchanged; keep perl/shell-special syntax
# (`${`, `$`, backticks) OUT of a `perl -e` pattern (prefer python3 + an assert);
# and when a should-be-RED arm comes back GREEN, suspect the perturbation before
# the guard. Both #1759 instances were hand plants that silently never applied.
#
# 🛑 KILLED MID-RUN, IT STILL RESTORES (kosmos#7619). The 10-30 08:29 tmux server death sent SIGHUP to every run in
# every pane at once, and a mutation run that dies holding a break leaves that break in the tree for the next commit
# to carry. A hangup, an interrupt or a terminate now restores the tree before exiting (safe for the same reason the
# end is: the tree was clean a moment ago). The test it was running is a child, so it is ended too, or it would keep
# testing a tree that is no longer broken. SIGKILL cannot be caught: the refusal above then names the file at the
# next start.
#
# It restores only the files the break changed, and each only while it still holds the break: a whole-tree checkout
# would also wipe an edit somebody else made in this worktree during the run (review 2). A file that changed again
# since the break is left alone and named.
_broken=()
_broken_hash=()
_restore() {
  local i f now left=""
  for i in "${!_broken[@]}"; do
    f="${_broken[$i]}"
    now="$(git hash-object -- "$f" 2>/dev/null)"
    if [ "$now" = "${_broken_hash[$i]}" ]; then git checkout -q -- "$f" || left="$left $f"; else left="$left $f"; fi
  done
  [ -z "$left" ] || echo "    NOT restored, changed again during the run (check by hand):$left"
  [ -z "$left" ]
}
# Every restore at an ending runs with the signals ignored (review 4): a second Ctrl-C, or a TERM after a HUP, must not
# kill the restore halfway, and a signal during a normal finish must not re-run it over files it has just restored.
_final_restore() { trap '' HUP INT TERM; _restore; }
# Every process under the test, ended without one escaping (kosmos#7629 B1): a server or worker the test file started
# would otherwise keep running against the restored tree. Each process is STOPPED as it is read, so nothing in the
# tree can fork between the read and its kill, then every one is sent TERM and CONT. Not caught, stated: a TERM
# handler that forks a cleanup child once it is continued (that child is born after the tree was read). Exact pids
# only, never a group or pkill.
_tree_of() {
  local p c
  for p in "$@"; do
    kill -STOP "$p" 2>/dev/null
    printf '%s\n' "$p"
    for c in $(pgrep -P "$p" 2>/dev/null); do _tree_of "$c"; done
  done
}
_restore_on_signal() {   # $1 the signal's number: the exit is 128 + it, as a shell reports a death by that signal
  trap '' HUP INT TERM
  if [ -n "${_test_pid:-}" ]; then
    local _tree _q
    _tree="$(_tree_of "$_test_pid")"
    for _q in $_tree; do kill "$_q" 2>/dev/null; done
    for _q in $_tree; do kill -CONT "$_q" 2>/dev/null; done   # a stopped process acts on its TERM only once continued
    wait "$_test_pid" 2>/dev/null
  fi
  rm -f "${_outf:-}"
  # A signal can land after the break is written but before _broken is filled (or while node is mid-write, review
  # 3). The tree was clean at the start, so whatever differs now is the break: restore that whole, unconditionally.
  # Known limit (review 6): an edit a colleague makes in this same instant cannot be told from the break, and goes too.
  if [ "${#_broken[@]}" -eq 0 ] && ! git diff --quiet; then
    git diff --name-only -z | xargs -0 git checkout -q --
    git diff --quiet && echo "    interrupted while the break was being written: restored (clean)" || echo "    interrupted: restore incomplete"
  elif [ "${#_broken[@]}" -gt 0 ]; then
    _restore && echo "    interrupted: restored (clean)" || echo "    interrupted: restore incomplete"
  else
    echo "    interrupted before the break was applied: nothing to restore"
  fi
  exit $((128 + $1))
}
trap '_restore_on_signal 1' HUP
trap '_restore_on_signal 2' INT
trap '_restore_on_signal 15' TERM
before="$(git rev-parse HEAD)"
echo "── $LABEL"
node -e "
const fs = require('node:fs');
const paths = process.argv.slice(1);
for (const f of paths) { let s = fs.readFileSync(f, 'utf8'); const was = s; ${EXPR}; if (s !== was) fs.writeFileSync(f, s); }
" $(git ls-files '*.js' '*.html' '*.sh' 'install/kosmos' | tr '\n' ' ') 2>/dev/null
[ -n "${PIF_TEST_PAUSE_AFTER_BREAK:-}" ] && sleep "$PIF_TEST_PAUSE_AFTER_BREAK"   # tests only: holds the window below open

if git diff --quiet; then
  echo "    ⚠️  THE MUTATION DID NOT APPLY - nothing changed, so nothing was proven."
  exit 1
fi
git diff --stat | tail -1 | sed 's/^/    changed: /'
# Built aside and published in one step (review 4): a signal mid-loop would otherwise see a list that is non-empty but
# short, and restore only part of the break.
_b=(); _h=()
while IFS= read -r -d '' _f; do _b+=("$_f"); _h+=("$(git hash-object -- "$_f")"); done < <(git diff --name-only -z)
_broken_hash=("${_h[@]}"); _broken=("${_b[@]}")

# 🛑 A SHELL MUTATION CANNOT BE PROVED BY THE NODE SUITE, and this refuses
# rather than leaving it to a person to remember. `yarn test` never executes
# install/setup.sh or install/kosmos: it reads them, at most. So a break in
# shell "proved" against a .test.js file goes GREEN for the same reason the
# mutation used to not apply at all — the runner never touched the changed
# bytes — and a green run is read as "the guard held", which is the exact
# inversion this tool exists to prevent.
#
# ⚠️ REFUSAL RATHER THAN A WARNING. A warning printed above a green result is
# read as a green result; the whole point of this tool is that its output is
# trusted. Splinter's line when the glob was widened: the enforcement was "a
# person knowing", which is the thing we had spent the evening replacing.
#
# 🛑 BUT NOT EVERY NODE TEST OF A SHELL FILE IS WRONG, and the first version of
# this refusal blocked a proof I had legitimately run an hour earlier. A node
# test can READ setup.sh and assert about its text -- that every copy of the
# default port agrees, that a phrase is absent, that one block precedes another
# -- and mutating the file really does turn those red. What it cannot do is
# prove anything about what the script DOES when it runs.
# 🔑 The two are not separable by inspection, so the caller states which it is.
# `SHELL_READ_ONLY=1` is a claim, printed in the output, that can be wrong and
# be seen to be wrong; silence was an assumption that could not.
#
# 📌 It restores first, so a refusal never leaves the tree broken.
_changed_shell="$(git diff --name-only | grep -E '\.sh$|^install/kosmos$' || true)"
case "$TESTFILE" in
  *.test.js)
    # #590: the old rule assumed no JS test ever runs a shell file, and it was
    # false in the same tree (engine/create.test.js runs bin/agent-supervisor.sh
    # through runLauncher and asserts on it). A refusal that names the wrong
    # reason teaches the override as the habit. So the question is asked of
    # the test file itself: a test that NAMES the changed script is treated as
    # executing it and the proof runs, stated out loud; a test that does not
    # name it is refused as before, with the override kept for the read-only
    # case. Naming is evidence, not proof (a test can mention a script it
    # never runs), which is why the run says which case it took.
    _executed=""
    for _f in $_changed_shell; do
      if grep -qF -- "$(basename "$_f")" "$TESTFILE" 2>/dev/null; then _executed="$_executed $_f"; fi
    done
    if [ -n "$_changed_shell" ] && [ -n "$_executed" ] && [ "${SHELL_READ_ONLY:-}" != "1" ]; then
      echo "    (shell changed and $TESTFILE names it, so the proof runs:$_executed)"
    elif [ -n "$_changed_shell" ] && [ "${SHELL_READ_ONLY:-}" != "1" ]; then
      echo "    🛑 THIS MUTATION CHANGED SHELL, AND $TESTFILE DOES NOT NAME IT, SO IT CANNOT EXECUTE IT."
      echo "$_changed_shell" | sed 's/^/       changed: /'
      echo "       A JS test that never mentions the script cannot be running it, so if"
      echo "       your guard is about what the script DOES, a green result here would"
      echo "       mean the runner never touched the break. Point it at a test that"
      echo "       runs the script (engine/create.test.js runs the supervisor), or at"
      echo "       tools/test-install.sh, which really installs (minutes, not seconds)."
      echo
      echo "       If your guard READS the file instead - the port copies, a banned"
      echo "       phrase, an ordering check - that is a legitimate proof and this"
      echo "       is the wrong refusal. Say so and it runs:"
      echo "           SHELL_READ_ONLY=1 bash tools/prove-it-fails.sh ..."
      _final_restore && echo "    restored"   # it names what it could not restore otherwise (review 5)
      exit 1
    fi
    if [ -n "$_changed_shell" ] && [ "${SHELL_READ_ONLY:-}" = "1" ]; then
      # Stated, so the run's own record says which case it was. A claim made
      # out loud can be wrong and be seen to be wrong; an assumption cannot.
      echo "    (SHELL_READ_ONLY: this test reads the shell file rather than running it)"
    fi
    ;;
esac

# 🛑 THREE OUTCOMES, AND THE THIRD IS THE ONE THIS TOOL GOT WRONG FIRST.
# Pointed at a test file that does not exist, the original printed "restored"
# and nothing else — indistinguishable from "the mutation fired no test". The
# runner never ran and the tool had no way to say so.
#
# ⚠️ THAT IS THE SHAPE LEO HIT THE SAME DAY: a harness passed cargo's arguments
# as one quoted string, cargo errored, the usage error matched no known failure
# pattern, and all fifteen mutations scored GREEN. Anything classifying outcomes
# by pattern-match needs an explicit UNRECOGNISED branch, or every unanticipated
# failure lands on the default — and the default is always success.
#
# 🔑 A UNIFORM RESULT IS AN INSTRUMENT SMELL, NOT A FINDING.
# In the background with a wait, not in $( ): bash runs a trap only after its foreground command ends, and `wait` is
# the one thing a signal interrupts (#7619).
_outf="$(mktemp "${TMPDIR:-/tmp}/prove-it-fails.XXXXXX")"
node --test "$TESTFILE" > "$_outf" 2>&1 &
_test_pid=$!
wait "$_test_pid"
_test_pid=""
out="$(cat "$_outf")"; rm -f "$_outf"
summary="$(printf '%s' "$out" | grep -E '^ℹ (pass|fail) ' | head -2)"
failed="$(printf '%s' "$out" | sed -n '/failing tests:/,$p' | grep -c '^✖')"

if [ -z "$summary" ]; then
  echo "    🛑 THE RUNNER PRODUCED NO SUMMARY, so nothing is proven either way."
  printf '%s\n' "$out" | head -4 | sed 's/^/      /'
  _final_restore
  exit 1
elif [ "$failed" -gt 0 ]; then
  printf '%s' "$out" | sed -n '/failing tests:/,$p' | grep '^✖' | sed 's/^/    /' | head -4
else
  echo "    ⚠️  NOTHING WENT RED. The break applied and no test noticed it."
  printf '%s' "$summary" | sed 's/^/      /'
fi
_final_restore || { echo "    restore failed"; exit 1; }
[ "$(git rev-parse HEAD)" = "$before" ] || { echo "    HEAD moved; something is wrong"; exit 1; }
echo "    restored"
