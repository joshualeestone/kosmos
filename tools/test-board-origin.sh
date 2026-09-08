#!/bin/bash
# #708: board_origin_label must say WHICH kind of checkout a live board runs from.
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
G=(git -c user.email=t@t -c user.name=t -c commit.gpgsign=false -c init.defaultBranch=main)

mkdir -p "$T/mainco"
"${G[@]}" -C "$T/mainco" init -q
printf 'x\n' > "$T/mainco/f"
"${G[@]}" -C "$T/mainco" add f
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

[ "$FAILS" -eq 0 ] && echo "board-origin: all arms passed" || echo "board-origin: $FAILS FAILED"
exit "$FAILS"
