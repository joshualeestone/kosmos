#!/usr/bin/env bash
# #708: board_origin_label must say WHICH kind of checkout a live board runs from,
# and run-tests.sh must actually use it.
#
# The fixtures are REAL git repos made by git itself -- `git init` for the main
# checkout and `git worktree add` for the linked one -- rather than a hand-written
# `.git` file. A hand-rolled fixture would not fail loudly if git changed the
# layout; it would quietly answer a different question and still pass.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
. "$REPO/tools/lib/board-origin.sh"
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/board-origin.XXXXXX")"; trap 'rm -rf "$T"' EXIT
# Hermetic: an operator's global core.hooksPath / init.templateDir would otherwise
# run foreign hooks and templates inside these fixtures.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
G=(git -c user.email=t@t -c user.name=t -c commit.gpgsign=false -c init.defaultBranch=main)

mkdir -p "$T/mainco"
"${G[@]}" -C "$T/mainco" init -q
mkdir -p "$T/mainco/engine"
printf 'x\n' > "$T/mainco/engine/f"
"${G[@]}" -C "$T/mainco" add engine/f
"${G[@]}" -C "$T/mainco" commit -qm seed
"${G[@]}" -C "$T/mainco" worktree add -q "$T/wt" -b side

# --- the fixtures must have the shape this function keys on, or nothing below means
# anything. If git ever changes it, THIS is what goes red, not the assertions.
[ -d "$T/mainco/.git" ] && ok "FIXTURE: the main checkout's .git is a DIRECTORY" \
  || bad "FIXTURE: main checkout .git is not a directory -- every arm below is now vacuous"
[ -f "$T/wt/.git" ] && ok "FIXTURE: the linked worktree's .git is a FILE" \
  || bad "FIXTURE: worktree .git is not a file -- every arm below is now vacuous"

m="$(board_origin_label "$T/mainco")"
case "$m" in *"MAIN CHECKOUT"*) ok "a main checkout is named as the MAIN CHECKOUT" ;;
  *) bad "a main checkout was not named: $m" ;; esac
case "$m" in *"$T/mainco"*) ok "the main-checkout label carries the path" ;;
  *) bad "the path was dropped from the main-checkout label: $m" ;; esac
# The label must claim only what was measured. "read-only reference" is true of
# ~/work/<repo> and false of e.g. a dotfiles repo, and this function cannot tell
# them apart, so it must not say it.
case "$m" in *"read-only"*) bad "the label asserts a house rule it cannot verify for an arbitrary repo: $m" ;;
  *) ok "CONTROL: the label claims only the .git shape and what follows from it" ;; esac

w="$(board_origin_label "$T/wt")"
case "$w" in *worktree*) ok "a linked worktree is named as a worktree" ;;
  *) bad "a worktree was not named: $w" ;; esac
# DISCRIMINATION: the whole point is telling the two apart. A label that said
# MAIN CHECKOUT for both would pass every arm above.
case "$w" in *"MAIN CHECKOUT"*) bad "a worktree was labelled the MAIN CHECKOUT -- the two are not discriminated: $w" ;;
  *) ok "CONTROL: a worktree is NOT labelled the main checkout" ;; esac
case "$m" in *worktree*) bad "the MAIN CHECKOUT label contains the word 'worktree', so it collides with the worktree match: $m" ;;
  *) ok "CONTROL: the main-checkout label does not contain the word 'worktree'" ;; esac

# --- THE ACCEPTED LIMITATION, asserted so it stays a decision rather than drifting.
# A subdirectory is NOT classified: it prints the bare path, the pre-#708 output,
# which is always true. An earlier version searched upward with `git rev-parse` and
# that one call brought three failure modes; see the library header.
sub="$(board_origin_label "$T/mainco/engine")"
[ "$sub" = "$T/mainco/engine" ] \
  && ok "ACCEPTED: a subdirectory is not classified, it prints the bare path (always true)" \
  || bad "a subdirectory was classified, so the upward search is back: $sub"

# The function must not consult git at all, which is what makes the environment
# below irrelevant rather than merely handled.
mkdir -p "$T/plainenv"
env_probe="$(GIT_DIR="$T/mainco/.git" GIT_WORK_TREE="$T/mainco" board_origin_label "$T/plainenv")"
[ "$env_probe" = "$T/plainenv" ] \
  && ok "CONTROL: GIT_DIR/GIT_WORK_TREE in the environment cannot make it describe another directory" \
  || bad "the environment changed the answer: $env_probe"

mkdir -p "$T/plain"
p="$(board_origin_label "$T/plain")"
[ "$p" = "$T/plain" ] && ok "a non-repo directory is reported unchanged (an installed board runs from \$HOME; that is not a violation)" \
  || bad "a non-repo directory was reclassified: $p"

gone="$T/does-not-exist"
[ "$(board_origin_label "$gone")" = "$gone" ] && ok "a vanished cwd is reported as given, not classified" \
  || bad "a vanished cwd was classified: $(board_origin_label "$gone")"

[ "$(board_origin_label "")" = "an unknown directory" ] \
  && ok "an empty cwd reads 'an unknown directory', the pre-#708 wording" \
  || bad "empty cwd: $(board_origin_label "")"
[ "$(board_origin_label)" = "an unknown directory" ] \
  && ok "a MISSING argument does not trip set -u" \
  || bad "a missing argument did not produce the unknown-directory wording"

mkdir -p "$T/has space"
"${G[@]}" -C "$T/has space" init -q
s="$(board_origin_label "$T/has space")"
case "$s" in *"MAIN CHECKOUT"*"has space"*) ok "a path containing a space survives intact" ;;
  *) bad "a path with a space was mangled: $s" ;; esac

# --- INTEGRATION. Every arm above calls the library directly. Delete the source
# line or the call in run-tests.sh and all of them stay green while the feature is
# gone, because the fail-open path is deliberately silent.
# Both arms match the LINE, not a mention: a bare path/name grep also matches a
# comment or the `command -v` guard, which is how the first version of the second
# arm stayed green when the call was deleted.
grep -qF '. "$REPO/tools/lib/board-origin.sh"' "$REPO/tools/run-tests.sh" \
  && ok "INTEGRATION: run-tests.sh SOURCES the library" \
  || bad "INTEGRATION: run-tests.sh no longer sources the library -- the feature is silently gone"
grep -qF 'board_origin_label "$cwd"' "$REPO/tools/run-tests.sh" \
  && ok "INTEGRATION: run-tests.sh CALLS board_origin_label on the board's cwd" \
  || bad "INTEGRATION: run-tests.sh no longer calls board_origin_label -- the feature is silently gone"

# --- THE FAIL-OPEN PATH, EXECUTED, AND EXECUTED FROM run-tests.sh's OWN BYTES.
# The first version of this arm re-typed the guard inside a `bash -c` string, so it
# asserted against its own private copy: change the real fallback and this stayed
# green. Extract the actual block and run THAT. (The two INTEGRATION arms above
# check the source line and the call line; neither covers the `else` branch.)
fallback_block="$(awk '/^ *local where$/,/^ *fi$/' "$REPO/tools/run-tests.sh")"
case "$fallback_block" in
  *'command -v board_origin_label'*)
    ok "the guard block was extracted from run-tests.sh (so the arm below is not vacuous)" ;;
  *)
    bad "could not extract run-tests.sh's guard block; the fail-open arm cannot run"
    fallback_block="" ;;
esac
if [ -n "$fallback_block" ]; then
  fo="$(bash -c 'set -uo pipefail
probe() {
  local cwd="$1"
'"$fallback_block"'
  printf "%s" "$where"
}
probe ""')"
  [ "$fo" = "an unknown directory" ] \
    && ok "FAIL-OPEN: run-tests.sh's OWN guard block yields the pre-#708 wording when the library is absent" \
    || bad "FAIL-OPEN produced: $fo"
fi

[ "$FAILS" -eq 0 ] && echo "board-origin: all arms passed" || echo "board-origin: $FAILS FAILED"
exit "$FAILS"
