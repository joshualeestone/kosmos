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
T="$(mktemp -d "${TMPDIR:-/tmp}/board-origin.XXXXXX")" || { echo "FAIL  could not create a temp dir; no arm below can run"; exit 1; }
[ -n "$T" ] && [ -d "$T" ] || { echo "FAIL  mktemp produced no directory; refusing to run with an empty \$T"; exit 1; }
trap 'rm -rf "$T"' EXIT
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
case "$w" in *"$T/wt"*) ok "the worktree label carries the path" ;;
  *) bad "the path was dropped from the worktree label: $w" ;; esac
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
[ "$p" = "$T/plain" ] && ok "a non-repo directory is reported unchanged" \
  || bad "a non-repo directory was reclassified: $p"

# --- THE INSTALLED BOARD RUNS FROM $HOME, AND $HOME IS OFTEN A GIT REPO.
# Without the decline, ordinary dotfiles make every red suite accuse the installed
# board of the violation #708 exists to name. The second arm is the control: the
# SAME directory must still classify when it is not $HOME, so the first arm cannot
# pass because classification is broken generally.
mkdir -p "$T/fakehome"
"${G[@]}" -C "$T/fakehome" init -q
h_as_home="$(HOME="$T/fakehome" board_origin_label "$T/fakehome")"
[ "$h_as_home" = "$T/fakehome" ] \
  && ok "a git-managed \$HOME is NOT accused (the installed board runs there)" \
  || bad "a git-managed \$HOME was labelled: $h_as_home"
h_not_home="$(HOME="$T/nowhere" board_origin_label "$T/fakehome")"
case "$h_not_home" in *"MAIN CHECKOUT"*) ok "CONTROL: the same directory DOES classify when it is not \$HOME" ;;
  *) bad "CONTROL failed: classification is broken generally, so the arm above proves nothing: $h_not_home" ;; esac
# The decline must survive a SPELLING difference between $HOME and the cwd lsof
# reports. A string compare passed the arm above and failed both of these; `-ef`
# compares device and inode, so the same directory matches however it is spelled.
ln -s "$T/fakehome" "$T/symhome"
h_sym="$(HOME="$T/symhome" board_origin_label "$T/fakehome")"
[ "$h_sym" = "$T/fakehome" ] \
  && ok "the \$HOME decline survives a SYMLINKED \$HOME (spelling differs, directory is the same)" \
  || bad "a symlinked \$HOME defeated the decline: $h_sym"
h_slash="$(HOME="$T/fakehome/" board_origin_label "$T/fakehome")"
[ "$h_slash" = "$T/fakehome" ] \
  && ok "the \$HOME decline survives a TRAILING SLASH on \$HOME" \
  || bad "a trailing slash defeated the decline: $h_slash"
h_unset="$(env -u HOME bash -c '. "$1"; board_origin_label "$2"' _ "$REPO/tools/lib/board-origin.sh" "$T/fakehome")"
case "$h_unset" in *"MAIN CHECKOUT"*) ok "CONTROL: with \$HOME unset the decline does not fire and set -u is not tripped" ;;
  *) bad "an unset \$HOME changed behaviour unexpectedly: $h_unset" ;; esac

gone="$T/does-not-exist"
[ "$(board_origin_label "$gone")" = "$gone" ] && ok "a vanished cwd is reported as given, not classified" \
  || bad "a vanished cwd was classified: $(board_origin_label "$gone")"

[ "$(board_origin_label "")" = "an unknown directory" ] \
  && ok "an empty cwd reads 'an unknown directory', the pre-#708 wording" \
  || bad "empty cwd: $(board_origin_label "")"
[ "$(board_origin_label)" = "an unknown directory" ] \
  && ok "a MISSING argument does not trip set -u" \
  || bad "a missing argument did not produce the unknown-directory wording"

# A `.git` that is a SYMLINK to a real gitdir: `-d` follows symlinks, so this
# reads as a main checkout. The classification is defensible (it is not a linked
# checkout) but the code never measures "link", so this arm pins the behaviour and
# the label must not claim otherwise. The second arm is the claim check.
mkdir -p "$T/symgit"
ln -s "$T/mainco/.git" "$T/symgit/.git"
sg="$(HOME=/nonexistent board_origin_label "$T/symgit")"
case "$sg" in *"MAIN CHECKOUT"*) ok "a symlinked .git reads as a main checkout (documented residual)" ;;
  *) bad "a symlinked .git changed classification: $sg" ;; esac
case "$sg" in *"rather than a link"*|*"not a link"*)
    bad "the label claims '.git is not a link' while -d FOLLOWS symlinks: $sg" ;;
  *) ok "CONTROL: the label does not claim to measure 'link', which the code never does" ;; esac

# A path beginning with '-' must be an operand, never an option, to `[`.
mkdir -p "$T/-dashdir"
"${G[@]}" -C "$T/-dashdir" init -q
dd="$(HOME=/nonexistent board_origin_label "$T/-dashdir")"
case "$dd" in *"MAIN CHECKOUT"*"-dashdir"*) ok "a path segment beginning with '-' is treated as an operand, not an option" ;;
  *) bad "a dash-prefixed path was mishandled: $dd" ;; esac

# The header states the label collision is bounded to PROSE: a checkout whose own
# PATH contains "worktree" still collides. Pin it so the scope stays honest.
mkdir -p "$T/my-worktree-repo"
"${G[@]}" -C "$T/my-worktree-repo" init -q
wp="$(HOME=/nonexistent board_origin_label "$T/my-worktree-repo")"
case "$wp" in *"MAIN CHECKOUT"*) ok "a main checkout whose PATH contains 'worktree' still classifies correctly" ;;
  *) bad "a path containing 'worktree' broke classification: $wp" ;; esac
case "$wp" in *worktree*) ok "KNOWN SCOPE: such a label does contain the word, so the prose-only invariant is exactly that" ;;
  *) bad "unexpected: the path's own 'worktree' vanished from the label: $wp" ;; esac

mkdir -p "$T/has space"
"${G[@]}" -C "$T/has space" init -q
s="$(board_origin_label "$T/has space")"
case "$s" in *"MAIN CHECKOUT"*"has space"*) ok "a path containing a space survives intact" ;;
  *) bad "a path with a space was mangled: $s" ;; esac

# --- INTEGRATION. Every arm above calls the library directly. Delete the source
# line or the call in run-tests.sh and all of them stay green while the feature is
# gone, because the fail-open path is deliberately silent.
# Both arms match a distinctive FRAGMENT OF THE LINE rather than a bare path or
# name, which is how the first version of the second arm stayed green when the
# call was deleted (it matched the `command -v` guard). Stated precisely: these
# are unanchored substring matches, so a comment quoting the same fragment would
# still satisfy them. The fragments are distinctive enough that this is
# theoretical, but it is a substring match and not an anchor.
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
  # Drive the extracted block with a REAL REPO ROOT, not "". With "" both
  # branches of the guard produce the same string, so the arm could not say which
  # one ran. With a repo root they differ, which is what makes each arm below
  # about its own branch. stderr is folded in so a malformed extraction reports
  # the syntax error instead of an unexplained empty result.
  run_block() { # $1 = cwd, $2 = "source" to make the library available
    bash -c 'set -uo pipefail
[ "$2" = source ] && . "$3"
probe() {
  local cwd="$1"
'"$fallback_block"'
  printf "%s" "$where"
}
probe "$1"' _ "$1" "$2" "$REPO/tools/lib/board-origin.sh" 2>&1
  }
  fo="$(run_block "$T/mainco" absent)"
  [ "$fo" = "$T/mainco" ] \
    && ok "FAIL-OPEN: run-tests.sh's OWN guard block yields the bare path when the library is absent" \
    || bad "FAIL-OPEN produced: $fo"
  # Nothing else in this suite executes the guard's THEN branch.
  ft="$(run_block "$T/mainco" source)"
  case "$ft" in *"MAIN CHECKOUT"*)
      ok "GUARD-THEN: with the library present the same block classifies, so the two branches differ" ;;
    *) bad "GUARD-THEN produced: $ft" ;; esac
  fe="$(run_block "" absent)"
  [ "$fe" = "an unknown directory" ] \
    && ok "FAIL-OPEN: an empty cwd still reads the pre-#708 wording" \
    || bad "FAIL-OPEN empty-cwd produced: $fe"
fi

[ "$FAILS" -eq 0 ] && echo "board-origin: all arms passed" || echo "board-origin: $FAILS FAILED"
exit "$FAILS"
