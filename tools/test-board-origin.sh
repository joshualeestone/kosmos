#!/bin/bash
# #708: board_origin_label must say WHICH kind of checkout a live board runs from,
# and run-tests.sh must actually use it.
#
# The fixtures are REAL git repos made by git itself -- `git init` for the main
# checkout and `git worktree add` for the linked one -- rather than a hand-written
# `.git` file. A hand-rolled fixture would not fail loudly if git changed the
# layout; it would quietly answer a different question and still pass.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/board-origin.sh
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
case "$m" in *"$T/mainco"*) ok "the main-checkout label still carries the path" ;;
  *) bad "the path was dropped from the main-checkout label: $m" ;; esac

w="$(board_origin_label "$T/wt")"
case "$w" in *worktree*) ok "a linked worktree is named as a worktree" ;;
  *) bad "a worktree was not named: $w" ;; esac
# DISCRIMINATION: the whole point is telling the two apart. A label that said
# MAIN CHECKOUT for both would pass every arm above.
case "$w" in *"MAIN CHECKOUT"*) bad "a worktree was labelled the MAIN CHECKOUT -- the two are not discriminated: $w" ;;
  *) ok "CONTROL: a worktree is NOT labelled the main checkout" ;; esac
# The worktree arm is detected by matching the word "worktree", so the OTHER label
# must not contain it or the two collide on any substring match.
case "$m" in *worktree*) bad "the MAIN CHECKOUT label contains the word 'worktree', so it collides with the worktree match: $m" ;;
  *) ok "CONTROL: the main-checkout label does not contain the word 'worktree'" ;; esac

# A board's cwd is very often a SUBDIRECTORY of the checkout, not its root.
sub="$(board_origin_label "$T/mainco/engine")"
case "$sub" in *"MAIN CHECKOUT"*) ok "a SUBDIRECTORY of the main checkout is still classified" ;;
  *) bad "a subdirectory fell through to the bare path, the pre-#708 output: $sub" ;; esac
case "$sub" in *"$T/mainco/engine"*) ok "the subdirectory label names where the board actually sits" ;;
  *) bad "the actual cwd was dropped: $sub" ;; esac

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
# `set -u` is on in run-tests.sh, so a missing argument must not abort the run.
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
# gone, because the fail-open path is deliberately silent. These two arms are what
# make the deliverable, rather than the library, the thing under test.
grep -q 'tools/lib/board-origin.sh' tools/run-tests.sh \
  && ok "INTEGRATION: run-tests.sh sources the library" \
  || bad "INTEGRATION: run-tests.sh no longer sources tools/lib/board-origin.sh -- the feature is silently gone"
# Match the CALL, not the bare name: the `command -v` guard one line above also
# contains the name, so a bare-name grep stays green when the call is deleted.
# Found by perturbing this very arm -- it did not go red until it matched this.
grep -qF 'board_origin_label "$cwd"' tools/run-tests.sh \
  && ok "INTEGRATION: run-tests.sh CALLS board_origin_label on the board's cwd" \
  || bad "INTEGRATION: run-tests.sh no longer calls board_origin_label \"\$cwd\" -- the feature is silently gone"

[ "$FAILS" -eq 0 ] && echo "board-origin: all arms passed" || echo "board-origin: $FAILS FAILED"
exit "$FAILS"
