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
# board_code_dir_from_args resolves through `cd && pwd`, which collapses the `//`
# that a trailing-slash $TMPDIR leaves in $T and resolves any symlinked segment.
# The resolver arms below compare against this same-normalised form; the
# board_origin_label arms keep bare $T, since that function returns paths as-given.
TP="$(cd "$T" && pwd)"
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
# DISCRIMINATION: the whole point is telling the two apart. Stated precisely, since
# an earlier version of this comment overclaimed: the *worktree* arm above already
# reds for a label that said MAIN CHECKOUT for both, because these fixture paths do
# not contain the string "worktree". This arm is still worth having, as the direct
# statement of the property rather than a side effect of the fixture's path.
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
# `set -u` INSIDE the child: a fresh `bash -c` does not inherit it from this shell,
# so without this the "does not trip set -u" half of the arm was vacuous and would
# have passed even if the library dereferenced a bare $HOME.
h_unset="$(env -u HOME bash -c 'set -u; . "$1"; board_origin_label "$2"' _ "$REPO/tools/lib/board-origin.sh" "$T/fakehome")"
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
# Match the TOKEN, not two phrasings: "not a symlink" or "a real directory, not a
# link to one" would have slipped past the literal forms this used to check.
case "$sg" in *link*)
    bad "the label mentions 'link' while -d FOLLOWS symlinks, so the code never measures it: $sg" ;;
  *) ok "CONTROL: the label does not mention 'link', which the code never measures" ;; esac

# A path beginning with '-'. NOTE the fixture below is ABSOLUTE, so `[` never
# actually receives a leading-dash operand from it; the arm covers the realistic
# shape. The bare-dash ARGUMENTS, which do reach `[` directly, are covered by the
# three arms after it.
mkdir -p "$T/-dashdir"
"${G[@]}" -C "$T/-dashdir" init -q
dd="$(HOME=/nonexistent board_origin_label "$T/-dashdir")"
case "$dd" in *"MAIN CHECKOUT"*"-dashdir"*) ok "a path SEGMENT beginning with '-' classifies normally" ;;
  *) bad "a dash-prefixed path was mishandled: $dd" ;; esac
for opt in -d -n --; do
  got="$(HOME=/nonexistent board_origin_label "$opt")"
  [ "$got" = "$opt" ] && ok "a bare '$opt' argument is returned as an operand, never read as an option" \
    || bad "argument '$opt' was mishandled: $got"
done

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

# --- #2515: the CODE tree, resolved from the process argv, not the cwd.
# The pure parser first (fixture argv strings), then the resolver, then the
# end-to-end property. lsof -d txt gives the node interpreter, not the script
# (measured), so the argv is the only source; these arms pin the parse and the
# path resolution rather than the one-line `ps` probe the caller does.
[ "$(board_script_path_from_args "/opt/homebrew/bin/node $T/mainco/server.js")" = "$T/mainco/server.js" ] \
  && ok "argv: the script token is extracted from a node command line" \
  || bad "argv: script token not extracted: $(board_script_path_from_args "/opt/homebrew/bin/node $T/mainco/server.js")"
[ "$(board_script_path_from_args "node --enable-source-maps $T/mainco/server.js --port 16180")" = "$T/mainco/server.js" ] \
  && ok "argv: flags before and args after the script are skipped (first .js token wins)" \
  || bad "argv: flags/args around the script confused the parse: $(board_script_path_from_args "node --enable-source-maps $T/mainco/server.js --port 16180")"
[ -z "$(board_script_path_from_args "$T/bin/kosmos start")" ] \
  && ok "argv: a no-.js command line (kosmos start) yields nothing, so the caller falls back" \
  || bad "argv: a .js-less command line invented a script: $(board_script_path_from_args "$T/bin/kosmos start")"
[ -z "$(board_script_path_from_args "")" ] \
  && ok "argv: an empty command line yields nothing" \
  || bad "argv: an empty command line produced a token: $(board_script_path_from_args "")"

[ "$(board_code_dir_from_args "node $T/mainco/server.js" "")" = "$TP/mainco" ] \
  && ok "resolver: an absolute script resolves to its checkout root" \
  || bad "resolver: absolute script dir wrong: $(board_code_dir_from_args "node $T/mainco/server.js" "")"
[ "$(board_code_dir_from_args "node server.js" "$T/mainco")" = "$TP/mainco" ] \
  && ok "resolver: a relative script resolves against the board's cwd" \
  || bad "resolver: relative script not anchored to cwd: $(board_code_dir_from_args "node server.js" "$T/mainco")"
[ "$(board_code_dir_from_args "node $T/mainco/engine/../server.js" "")" = "$TP/mainco" ] \
  && ok "resolver: a .. segment in the script path is normalised" \
  || bad "resolver: .. not normalised: $(board_code_dir_from_args "node $T/mainco/engine/../server.js" "")"
[ -z "$(board_code_dir_from_args "$T/bin/kosmos start" "$T/mainco")" ] \
  && ok "resolver: a no-.js command line resolves to nothing (caller falls back to cwd)" \
  || bad "resolver: a .js-less command line resolved a dir: $(board_code_dir_from_args "$T/bin/kosmos start" "$T/mainco")"
[ -z "$(board_code_dir_from_args "node relative/server.js" "")" ] \
  && ok "resolver: a relative script with no cwd declines rather than guessing" \
  || bad "resolver: a relative script with no cwd was resolved: $(board_code_dir_from_args "node relative/server.js" "")"

# THE #2515 PROPERTY, end to end at the label: code = the main checkout, cwd =
# a git-managed $HOME (which board_origin_label correctly declines on its own).
# Keying on the cwd (the pre-#2515 behaviour) declines to the bare $HOME path;
# keying on the resolved code tree names the MAIN CHECKOUT. This is the live miss.
_code="$(board_code_dir_from_args "node $T/mainco/server.js" "$T/fakehome")"
_lbl="$(HOME="$T/fakehome" board_origin_label "${_code:-$T/fakehome}")"
case "$_lbl" in *"MAIN CHECKOUT"*"$TP/mainco"*)
    ok "#2515: a board whose CODE is the main checkout but whose cwd is \$HOME is named the MAIN CHECKOUT" ;;
  *) bad "#2515: the code tree was not named (the cwd-keyed miss is back): $_lbl" ;; esac
# CONTROL: prove the arm above is not passing because classification is broken --
# the OLD cwd-keyed input (the $HOME cwd) must still DECLINE to the bare path.
_old="$(HOME="$T/fakehome" board_origin_label "$T/fakehome")"
[ "$_old" = "$T/fakehome" ] \
  && ok "#2515 CONTROL: keying on the \$HOME cwd still declines to the bare path (the miss #2515 fixes)" \
  || bad "#2515 CONTROL: the \$HOME cwd did not decline, so the arm above proves nothing: $_old"

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
grep -qF 'board_origin_label "${codedir:-$cwd}"' "$REPO/tools/run-tests.sh" \
  && ok "INTEGRATION: run-tests.sh CALLS board_origin_label on the code tree (cwd fallback)" \
  || bad "INTEGRATION: run-tests.sh no longer calls board_origin_label on the code tree -- the feature is silently gone"
# #2515: the code tree must be RESOLVED from the argv, not left as the cwd. Delete
# this call and the label silently reverts to the pre-#2515 cwd keying (green here
# only because ${codedir:-$cwd} degrades to $cwd), so pin the resolution wiring.
grep -qF 'board_code_dir_from_args' "$REPO/tools/run-tests.sh" \
  && ok "INTEGRATION: run-tests.sh RESOLVES the code tree from the process argv (#2515)" \
  || bad "INTEGRATION: run-tests.sh no longer resolves the code tree -- #2515's cwd-keyed miss is back"
# THE THIRD DELETION PATH. Sourcing the library and calling it are not enough: the
# computed value must reach the line that is actually printed. Measured, and this
# is why the arm exists: changing the emit line back to ${cwd:-an unknown
# directory} while leaving the source AND the call intact removes the feature from
# the red report entirely, and all other arms still pass.
grep -qF 'running from $where' "$REPO/tools/run-tests.sh" \
  && ok "INTEGRATION: the computed label reaches the line run-tests.sh EMITS" \
  || bad "INTEGRATION: \$where is no longer emitted -- the label is computed and thrown away"

# --- THE FAIL-OPEN PATH, EXECUTED, AND EXECUTED FROM run-tests.sh's OWN BYTES.
# The first version of this arm re-typed the guard inside a `bash -c` string, so it
# asserted against its own private copy: change the real fallback and this stayed
# green. Extract the actual block and run THAT. (The two INTEGRATION arms above
# check the source line and the call line; neither covers the `else` branch.)
fallback_block="$(awk '/^ *local where$/,/^ *fi$/' "$REPO/tools/run-tests.sh")"
# Two checks, because the substring alone is not enough. A block truncated or
# over-extended still contains this string, so it would pass the substring test and
# then execute the wrong bytes. The structural counts reject that. Measured on the
# two perturbations awk can actually produce (an earlier version of this comment
# cited if/fi = 1/0, which this range CANNOT yield, because awk's terminator line
# is inclusive):
#   a stray early `fi` after the then-branch  -> 4 lines,  if=1 else=0 fi=1
#                                                (rejected by the ELSE count)
#   the real `fi` deleted, range runs to EOF  -> 44 lines, if=2 else=1 fi=1
#                                                (rejected by the IF count)
fb_if=$(printf '%s\n' "$fallback_block" | grep -c '^[[:space:]]*if ')
fb_fi=$(printf '%s\n' "$fallback_block" | grep -c '^[[:space:]]*fi$')
fb_el=$(printf '%s\n' "$fallback_block" | grep -c '^[[:space:]]*else$')
case "$fallback_block" in
  *'command -v board_origin_label'*)
    if [ "$fb_if" = "1" ] && [ "$fb_fi" = "1" ] && [ "$fb_el" = "1" ]; then
      ok "the guard block was extracted from run-tests.sh whole (if/else/fi all exactly 1)"
    else
      bad "the extracted block is structurally wrong (if=$fb_if else=$fb_el fi=$fb_fi); it would execute the wrong bytes"
      fallback_block=""
    fi ;;
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
  run_block() { # $1=cwd  $2=codedir  $3="source" to make the library available
    bash -c 'set -uo pipefail
[ "$3" = source ] && . "$4"
probe() {
  local cwd="$1" codedir="$2"
'"$fallback_block"'
  printf "%s" "$where"
}
probe "$1" "$2"' _ "$1" "$2" "$3" "$REPO/tools/lib/board-origin.sh" 2>&1
  }
  fo="$(run_block "$T/mainco" "" absent)"
  [ "$fo" = "$T/mainco" ] \
    && ok "FAIL-OPEN: run-tests.sh's OWN guard block yields the bare path when the library is absent" \
    || bad "FAIL-OPEN produced: $fo"
  # Nothing else in this suite executes the guard's THEN branch.
  ft="$(run_block "$T/mainco" "" source)"
  case "$ft" in *"MAIN CHECKOUT"*)
      ok "GUARD-THEN: with the library present the same block classifies, so the two branches differ" ;;
    *) bad "GUARD-THEN produced: $ft" ;; esac
  # #2515 IN THE REAL BYTES: with a code tree resolved, the guard must classify
  # THAT over the cwd. Drives the actual extracted block with codedir=the main
  # checkout and cwd=a $HOME-ish path; keying on cwd would not say MAIN CHECKOUT.
  fc="$(run_block "$T/fakehome" "$T/mainco" source)"
  case "$fc" in *"MAIN CHECKOUT"*"$T/mainco"*)
      ok "#2515: run-tests.sh's OWN guard block classifies the code tree over the cwd" ;;
    *) bad "#2515: the guard block did not key on the code tree: $fc" ;; esac
  fe="$(run_block "" "" absent)"
  [ "$fe" = "an unknown directory" ] \
    && ok "FAIL-OPEN: an empty cwd still reads the pre-#708 wording" \
    || bad "FAIL-OPEN empty-cwd produced: $fe"
fi

[ "$FAILS" -eq 0 ] && echo "board-origin: all arms passed" || echo "board-origin: $FAILS FAILED"
exit "$FAILS"
