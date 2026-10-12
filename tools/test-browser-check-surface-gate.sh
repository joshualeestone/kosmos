#!/bin/bash
# kosmos#2518: prove the surface-specific browser-check gate fires PRECISELY -- it
# refuses a web/index.html change that touches a MAPPED check's surface token without
# updating that check, and only that. Uses the real docs/browser-checks annotations
# (so it also validates the seeded ones parse) with synthesized diff/files/msgs seams.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=tools/lib/browser-check-surface-gate.sh
. "$HERE/lib/browser-check-surface-gate.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails + 1)); }

# Run the gate with controlled seams; returns its exit code.
run_gate() {
  local webdiff="$1" files="$2" msgs="$3"
  ( KOSMOS_BCSG_WEBDIFF="$webdiff" KOSMOS_BCG_FILES="$files" KOSMOS_BCG_MSGS="$msgs" \
      kosmos_browser_check_surface_gate ) >/dev/null 2>&1
}

# A web diff that CHANGES a line carrying render-subprojects-1994.js's mapped token pj-parent.
printf '%s\n' 'diff --git a/web/index.html b/web/index.html' '--- a/web/index.html' '+++ b/web/index.html' \
  '@@ -100,1 +100,1 @@' '-      <span class="pj-parent">under App</span>' \
  '+      <span class="pj-parent">Kosmos › App</span>' > "$TMP/webdiff-parent"
# A web diff touching a COMPOUND identifier that merely CONTAINS a mapped token as a
# substring (pj-parent inside pj-parenthetical-note) -- must NOT over-fire (boundary match).
printf '%s\n' 'diff --git a/web/index.html b/web/index.html' '--- a/web/index.html' '+++ b/web/index.html' \
  '@@ -5,1 +5,1 @@' '-  <div class="pj-parenthetical-note">a</div>' \
  '+  <div class="pj-parenthetical-note">b</div>' > "$TMP/webdiff-substr"
# A web diff touching only an UNMAPPED token (no check annotates it).
printf '%s\n' 'diff --git a/web/index.html b/web/index.html' '--- a/web/index.html' '+++ b/web/index.html' \
  '@@ -1,1 +1,1 @@' '-  <div class="zzz-unmapped-nonexistent-token">a</div>' \
  '+  <div class="zzz-unmapped-nonexistent-token">b</div>' > "$TMP/webdiff-unmapped"
# A web diff with only context (no +/- body lines) -> nothing changed.
printf '%s\n' 'diff --git a/web/index.html b/web/index.html' '--- a/web/index.html' '+++ b/web/index.html' \
  '@@ -1,1 +1,1 @@' '   <div class="pj-parent">unchanged context</div>' > "$TMP/webdiff-context"

: > "$TMP/files-none"                                                        # no check updated
printf 'M\tdocs/browser-checks/render-subprojects-1994.js\n' > "$TMP/files-updated"   # the check IS updated
: > "$TMP/msgs-none"
printf 'fix subprojects layout\n\nBrowser-check-surface: render-subprojects-1994.js the ancestry line is copy-only here\n' > "$TMP/msgs-override"
# Mixed-case key: the override must be recognized case-insensitively (sibling convention).
printf 'fix subprojects layout\n\nbrowser-check-Surface: render-subprojects-1994.js copy only\n' > "$TMP/msgs-override-mixedcase"
printf 'fix subprojects layout\n\nBrowser-check: deferring the check to the cut\n' > "$TMP/msgs-blanket"
# An override naming a DIFFERENT check must NOT excuse the check under test.
printf 'fix subprojects layout\n\nBrowser-check-surface: some-other-check.js unrelated reason\n' > "$TMP/msgs-wrongname"

# 1. RED: a mapped token changed, the check not updated, no override -> REFUSE (exit 1).
if run_gate "$TMP/webdiff-parent" "$TMP/files-none" "$TMP/msgs-none"; then
  fail "a pj-parent change with render-subprojects-1994 NOT updated should be refused"
else
  pass "refused: mapped surface token changed without updating its check (the #2487 shape)"
fi

# 2. PASS: same change but the mapped check IS updated -> allowed.
if run_gate "$TMP/webdiff-parent" "$TMP/files-updated" "$TMP/msgs-none"; then
  pass "allowed: the mapped check was updated alongside the surface change"
else
  fail "updating render-subprojects-1994 should satisfy the gate"
fi

# 3. PASS: a PER-CHECK named override excuses it.
if run_gate "$TMP/webdiff-parent" "$TMP/files-none" "$TMP/msgs-override"; then
  pass "allowed: a per-check 'Browser-check-surface: <check> <reason>' override"
else
  fail "a per-check named override should satisfy the gate"
fi

# 4. 🛑 RED-still: the BLANKET 'Browser-check:' trailer does NOT excuse a surface staleness
#    (this is the precision that catches #2498, which deferred with exactly this shape).
if run_gate "$TMP/webdiff-parent" "$TMP/files-none" "$TMP/msgs-blanket"; then
  fail "the blanket Browser-check: trailer must NOT excuse a surface-mapped staleness"
else
  pass "still refused under a blanket Browser-check: trailer (the #2498 precision)"
fi

# 3b. PASS: the per-check override key is case-insensitive (matching the sibling gate).
if run_gate "$TMP/webdiff-parent" "$TMP/files-none" "$TMP/msgs-override-mixedcase"; then
  pass "allowed: a mixed-case 'browser-check-Surface:' override is recognized (case-insensitive)"
else
  fail "the override key must be case-insensitive, like the sibling coarse gate"
fi

# 3c. 🛑 RED-still: an override naming a DIFFERENT check must NOT excuse this one (per-check
#     precision -- proves the override is scoped to its named basename, not any override).
if run_gate "$TMP/webdiff-parent" "$TMP/files-none" "$TMP/msgs-wrongname"; then
  fail "an override naming some-other-check must NOT excuse render-subprojects-1994"
else
  pass "still refused: a wrong-name override does not excuse the check under test (per-check scope)"
fi

# 4b. PASS: a compound identifier merely CONTAINING a mapped token as a substring must
#     NOT fire (whole-token boundary match), or the gate nags every unrelated edit.
if run_gate "$TMP/webdiff-substr" "$TMP/files-none" "$TMP/msgs-none"; then
  pass "allowed: pj-parenthetical (substring of pj-parent) does not over-fire (boundary match)"
else
  fail "a compound identifier containing a mapped token as a substring must not fire"
fi

# 5. PASS: a web change touching an UNMAPPED token -> allowed (no over-fire beyond the map).
if run_gate "$TMP/webdiff-unmapped" "$TMP/files-none" "$TMP/msgs-none"; then
  pass "allowed: an unmapped surface token change does not fire the surface gate"
else
  fail "an unmapped token change must not be refused by the surface gate"
fi

# 6. PASS: only context lines changed (no +/- body) -> nothing to guard.
if run_gate "$TMP/webdiff-context" "$TMP/files-none" "$TMP/msgs-none"; then
  pass "allowed: a diff with only context lines has no changed surface"
else
  fail "context-only lines must not be treated as a surface change"
fi

# 7. Fail-soft: an unreadable web diff seam -> return 0 (repo-local, never breaks a run).
if run_gate "$TMP/does-not-exist" "$TMP/files-none" "$TMP/msgs-none"; then
  pass "fail-soft: an empty/unreadable web diff returns 0"
else
  fail "an unreadable web diff must fail soft (return 0)"
fi

# 8. REAL fail-soft: with NO seams, in a non-git dir, the git diff of web/index.html FAILS
#    -> the gate must return 0 AND emit its "could not diff" diagnostic (a silent skip is
#    indistinguishable from a clean pass -- the hazard the gate exists to avoid). Arm 7
#    only reaches the empty-content return; this reaches the git-failure branch + its stderr.
mkdir -p "$TMP/nongit"
serr="$( ( cd "$TMP/nongit" && unset KOSMOS_BCSG_WEBDIFF KOSMOS_BCG_FILES KOSMOS_BCG_MSGS KOSMOS_BCSG_DIR; kosmos_browser_check_surface_gate ) 2>&1 )"
rc=$?
if [ "$rc" -eq 0 ] && printf '%s' "$serr" | grep -q "could not diff"; then
  pass "fail-soft (real git-diff failure): returns 0 AND says so, not a silent skip"
else
  fail "the git-diff-failure fail-soft must return 0 and emit its diagnostic (rc=$rc)"
fi

# 9. SELF-DEFENDING zsh arm: source the lib into zsh and reproduce the refuse path on a
#    MULTI-token check (tsk-crumb is render-alltasks's 3rd declared token). If either
#    zsh fix (find+while-read for the check glob, tr+while-read for the token split) were
#    reverted, this would ALLOW under zsh and red here -- the bash-only suite cannot see that.
if command -v zsh >/dev/null 2>&1; then
  printf '%s\n' '--- a/web/index.html' '+++ b/web/index.html' '@@ -1 +1 @@' \
    '-  <p id="tsk-crumb">3</p>' '+  <p id="tsk-crumb">4</p>' > "$TMP/wd-zsh"
  : > "$TMP/f-zsh"; : > "$TMP/m-zsh"
  BCDIR_ABS="$(cd "$HERE/.." && pwd)/docs/browser-checks"
  if zsh -c ". \"$HERE/lib/browser-check-surface-gate.sh\" && KOSMOS_BCSG_WEBDIFF=\"$TMP/wd-zsh\" KOSMOS_BCG_FILES=\"$TMP/f-zsh\" KOSMOS_BCG_MSGS=\"$TMP/m-zsh\" KOSMOS_BCSG_DIR=\"$BCDIR_ABS\" kosmos_browser_check_surface_gate" >/dev/null 2>&1; then
    fail "zsh: a multi-token surface change was ALLOWED (a zsh word-split/glob regression)"
  else
    pass "zsh: multi-token refuse reproduces under zsh (self-defends the zsh-safety fixes)"
  fi
else
  echo "SKIP  zsh not available for the self-defending zsh arm"
fi

# 9b. kosmos#4811: sourced into a zsh whose `grep` is not grep (the agent's own shell runs a function that calls
#     ugrep with --ignore-files and -I), the gate PASSED a branch CI refused. A grep that matches nothing stands in
#     for it; the gate must re-run itself under bash and still refuse.
if command -v zsh >/dev/null 2>&1; then
  printf '%s\n' '--- a/web/index.html' '+++ b/web/index.html' '@@ -1 +1 @@' \
    '-  <p id="tsk-crumb">3</p>' '+  <p id="tsk-crumb">4</p>' > "$TMP/wd-4811"
  : > "$TMP/f-4811"; : > "$TMP/m-4811"
  BCDIR_ABS="$(cd "$HERE/.." && pwd)/docs/browser-checks"
  # Every check in the REAL folder the gate itself maps to this change (#5072: a second check, render-subback-4586,
  # now claims tsk-crumb). Selected with the gate's own parser (bc_surface_tokens_of, bc_surface_token_hits), so the
  # compliant-change arms below update, or excuse, exactly the checks the gate would ask for.
  WD4811_CHANGED="$(command grep -E '^[-+][^-+]' "$TMP/wd-4811")"
  CRUMB_CHECKS="$(for f in "$BCDIR_ABS"/*.js; do
    [ -f "$f" ] || continue
    for tok in $(bc_surface_tokens_of "$f"); do
      if bc_surface_token_hits "$tok" "$WD4811_CHANGED"; then basename "$f"; break; fi
    done
  done)"
  case "$CRUMB_CHECKS" in
    *render-alltasks.js*) pass "#4811 setup: the checks that claim tsk-crumb were found ($(printf '%s' "$CRUMB_CHECKS" | tr '\n' ' '))" ;;
    *) fail "#4811 setup: render-alltasks.js no longer claims tsk-crumb, so the arms below test nothing" ;;
  esac
  # CONTROL: a gate that believes the lying grep passes this change. KOSMOS_BCG_REEXEC=1 forces the in-process answer
  # (the re-run's own marker), so this shows what the guard below protects against.
  if KOSMOS_BCG_REEXEC=1 bash -c 'grep() { return 1; }; . "$1" && KOSMOS_BCSG_WEBDIFF="$2" KOSMOS_BCG_FILES="$3" KOSMOS_BCG_MSGS="$4" KOSMOS_BCSG_DIR="$5" kosmos_browser_check_surface_gate' _ \
       "$HERE/lib/browser-check-surface-gate.sh" "$TMP/wd-4811" "$TMP/f-4811" "$TMP/m-4811" "$BCDIR_ABS" >/dev/null 2>&1; then
    pass "#4811 control: a gate that believes a grep matching nothing passes the change"
  else
    fail "#4811 control: the lying grep did not make the gate pass, so the arm below proves nothing"
  fi
  if zsh -c 'grep() { return 1; }; . "$1" && KOSMOS_BCSG_WEBDIFF="$2" KOSMOS_BCG_FILES="$3" KOSMOS_BCG_MSGS="$4" KOSMOS_BCSG_DIR="$5" kosmos_browser_check_surface_gate' _ \
       "$HERE/lib/browser-check-surface-gate.sh" "$TMP/wd-4811" "$TMP/f-4811" "$TMP/m-4811" "$BCDIR_ABS" >/dev/null 2>&1; then
    fail "#4811: sourced into zsh with a grep that matches nothing, the gate passed (it must run itself under bash)"
  else
    pass "#4811: sourced into zsh with a grep that matches nothing, the gate still refuses"
  fi
  # Review 3: a BASH whose `grep` is a shell function (a Claude Code session running bash) is not trusted either.
  if bash -c 'grep() { return 1; }; . "$1" && KOSMOS_BCSG_WEBDIFF="$2" KOSMOS_BCG_FILES="$3" KOSMOS_BCG_MSGS="$4" KOSMOS_BCSG_DIR="$5" kosmos_browser_check_surface_gate' _ \
       "$HERE/lib/browser-check-surface-gate.sh" "$TMP/wd-4811" "$TMP/f-4811" "$TMP/m-4811" "$BCDIR_ABS" >/dev/null 2>&1; then
    fail "#4811: in a bash with a grep that matches nothing, the gate passed (it must re-run in a fresh bash)"
  else
    pass "#4811: in a bash with a grep that matches nothing, the gate still refuses"
  fi
  # Review 4: an ALIASED grep in an interactive bash (alias expanded into the gate when it is sourced) re-runs too.
  if bash -c 'shopt -s expand_aliases; alias grep="false"; . "$1" && KOSMOS_BCSG_WEBDIFF="$2" KOSMOS_BCG_FILES="$3" KOSMOS_BCG_MSGS="$4" KOSMOS_BCSG_DIR="$5" kosmos_browser_check_surface_gate' _ \
       "$HERE/lib/browser-check-surface-gate.sh" "$TMP/wd-4811" "$TMP/f-4811" "$TMP/m-4811" "$BCDIR_ABS" >/dev/null 2>&1; then
    fail "#4811: in a bash with grep aliased to something that matches nothing, the gate passed"
  else
    pass "#4811: in a bash with grep aliased to something that matches nothing, the gate still refuses"
  fi
  # Review 4: a CDPATH under which bash's cd ECHOES the directory it found must not corrupt the recorded path. Bash,
  # sourcing by a relative path from the repo root with CDPATH set to it, and a grep function so the re-run is used.
  printf '%s\n' "$CRUMB_CHECKS" | while read -r c; do printf 'M\tdocs/browser-checks/%s\n' "$c"; done > "$TMP/f-4811ok"
  REPO_4811="$(cd "$HERE/.." && pwd)"
  if ( cd "$REPO_4811" && CDPATH="$REPO_4811" bash -c 'grep() { command grep "$@"; }; . tools/lib/browser-check-surface-gate.sh && KOSMOS_BCSG_WEBDIFF="$1" KOSMOS_BCG_FILES="$2" KOSMOS_BCG_MSGS="$3" kosmos_browser_check_surface_gate' _ \
       "$TMP/wd-4811" "$TMP/f-4811ok" "$TMP/m-4811" ) >/dev/null 2>&1; then
    pass "#4811: with CDPATH set, the gate still finds itself and passes a compliant change through the re-run"
  else
    fail "#4811: with CDPATH set, the re-run could not source the gate (a corrupted recorded path)"
  fi
  # Review 1: settings given as PLAIN zsh variables (not exported) must reach the bash re-run too, or it would check
  # the real branch instead and could pass. And a POSITIVE control through the re-run: the same change with its check
  # updated passes (rc 0), so a broken re-run (a bad path, lost settings) cannot read as a refusal.
  if zsh -c '. "$1" && KOSMOS_BCSG_WEBDIFF="$2"; KOSMOS_BCG_FILES="$3"; KOSMOS_BCG_MSGS="$4"; KOSMOS_BCSG_DIR="$5"; kosmos_browser_check_surface_gate' _ \
       "$HERE/lib/browser-check-surface-gate.sh" "$TMP/wd-4811" "$TMP/f-4811" "$TMP/m-4811" "$BCDIR_ABS" >/dev/null 2>&1; then
    fail "#4811: settings given as plain zsh variables did not reach the bash re-run (the gate passed)"
  else
    pass "#4811: settings given as plain zsh variables reach the bash re-run (still refused)"
  fi
  # From the repo root with the default checks folder: the gate matches an updated check by the same relative path
  # the file list carries (an absolute KOSMOS_BCSG_DIR would never match it, under bash too).
  printf '%s\n' "$CRUMB_CHECKS" | while read -r c; do printf 'M\tdocs/browser-checks/%s\n' "$c"; done > "$TMP/f-4811ok"
  if zsh -c 'cd "$5" && . "$1" && KOSMOS_BCSG_WEBDIFF="$2"; KOSMOS_BCG_FILES="$3"; KOSMOS_BCG_MSGS="$4"; kosmos_browser_check_surface_gate' _ \
       "$HERE/lib/browser-check-surface-gate.sh" "$TMP/wd-4811" "$TMP/f-4811ok" "$TMP/m-4811" "$(cd "$HERE/.." && pwd)" >/dev/null 2>&1; then
    pass "#4811 positive control: through the re-run, the same change with its check updated passes"
  else
    fail "#4811 positive control: a compliant change was refused through the re-run (a broken re-run reads as a refusal)"
  fi
  # Review 2: EACH setting must reach the re-run; an arm per setting where only that value flips the verdict.
  # KOSMOS_BCSG_DIR: a checks folder with no annotated check maps no token, so the same change passes.
  mkdir -p "$TMP/emptybc-4811"
  if zsh -c '. "$1" && KOSMOS_BCSG_WEBDIFF="$2"; KOSMOS_BCG_FILES="$3"; KOSMOS_BCG_MSGS="$4"; KOSMOS_BCSG_DIR="$5"; kosmos_browser_check_surface_gate' _ \
       "$HERE/lib/browser-check-surface-gate.sh" "$TMP/wd-4811" "$TMP/f-4811" "$TMP/m-4811" "$TMP/emptybc-4811" >/dev/null 2>&1; then
    pass "#4811: a plain zsh KOSMOS_BCSG_DIR reaches the re-run (an empty checks folder maps nothing)"
  else
    fail "#4811: a plain zsh KOSMOS_BCSG_DIR did not reach the re-run"
  fi
  # KOSMOS_BCG_MSGS: per-check override trailers in the given messages excuse every check in CRUMB_CHECKS.
  { printf 'x\n\n'; printf '%s\n' "$CRUMB_CHECKS" | while read -r c; do printf 'Browser-check-surface: %s excused for this test\n' "$c"; done; } > "$TMP/m-4811ok"
  if zsh -c '. "$1" && KOSMOS_BCSG_WEBDIFF="$2"; KOSMOS_BCG_FILES="$3"; KOSMOS_BCG_MSGS="$4"; KOSMOS_BCSG_DIR="$5"; kosmos_browser_check_surface_gate' _ \
       "$HERE/lib/browser-check-surface-gate.sh" "$TMP/wd-4811" "$TMP/f-4811" "$TMP/m-4811ok" "$BCDIR_ABS" >/dev/null 2>&1; then
    pass "#4811: a plain zsh KOSMOS_BCG_MSGS reaches the re-run (its override excuses the check)"
  else
    fail "#4811: a plain zsh KOSMOS_BCG_MSGS did not reach the re-run"
  fi
  # KOSMOS_BCG_BASE: a throwaway repo with one annotated check whose token the branch changes. The default base
  # (origin/main) sees the change; HEAD as the given base sees none. No seams, so the gate diffs real git.
  g4811="$TMP/repo4811"; mkdir -p "$g4811/web" "$g4811/docs/browser-checks"
  printf '// Browser-check-surface: zz-tok-4811\n' > "$g4811/docs/browser-checks/render-zz.js"
  printf '<p id="zz-tok-4811">1</p>\n' > "$g4811/web/index.html"
  ( cd "$g4811" && git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -q -m base \
      && git update-ref refs/remotes/origin/main HEAD && printf '<p id="zz-tok-4811">2</p>\n' > web/index.html \
      && git -c user.email=t@t -c user.name=t commit -q -am web ) >/dev/null 2>&1
  if zsh -c 'cd "$2" && . "$1" && kosmos_browser_check_surface_gate' _ "$HERE/lib/browser-check-surface-gate.sh" "$g4811" >/dev/null 2>&1; then
    fail "#4811 control: in the throwaway repo the default base did not refuse, so the base arm proves nothing"
  else
    pass "#4811 control: in the throwaway repo the default base refuses the mapped change"
  fi
  if zsh -c 'cd "$2" && . "$1" && KOSMOS_BCG_BASE=HEAD; kosmos_browser_check_surface_gate' _ "$HERE/lib/browser-check-surface-gate.sh" "$g4811" >/dev/null 2>&1; then
    pass "#4811: a plain zsh KOSMOS_BCG_BASE reaches the re-run (HEAD as base sees no change)"
  else
    fail "#4811: a plain zsh KOSMOS_BCG_BASE did not reach the re-run"
  fi
else
  echo "SKIP  #4811: zsh not available"
fi

# 10. #3893: a PR MERGED INTO BASE before CI checked out (two merge bases, a criss-cross).
#     Built with real git: main gains M1 (changes tok-x, updates render-x.js, excuses
#     render-y.js by trailer), the PR (an unrelated file) is merged into main as M2, and CI's
#     HEAD is the synthetic merge of the PR head into M1. With base=M2, `base...HEAD` picked
#     the PR head as merge base, so M1's change read as the PR's while `base..HEAD` never
#     showed M1's trailer: render-y.js was refused. Measured on #3893 and fed-msg-3311.
xrepo() {  # <dir> <pr-changes-token: 0|1> -> prints "M1 M2 H"
  local d="$1" g t=1700000000
  # Commit dates mirror #3893 (the PR head NEWER than main's change), because with two merge
  # bases git's pick follows commit dates, and only the PR-head pick exposes the bug.
  g() { GIT_COMMITTER_DATE="@$t +0000" GIT_AUTHOR_DATE="@$t +0000" \
          git -C "$d" -c user.email=t@t -c user.name=t -c init.defaultBranch=main "$@"; }
  mkdir -p "$d/docs/browser-checks" "$d/web"
  g init -q
  printf '%s\n' '<p id="tok-x">old</p>' '' '' '' '<b class="tok-x">b</b>' > "$d/web/index.html"
  printf '%s\n' '// Browser-check-surface: tok-x' 'x' > "$d/docs/browser-checks/render-x.js"
  printf '%s\n' '// Browser-check-surface: tok-x' 'y' > "$d/docs/browser-checks/render-y.js"
  g add -A && g commit -qm A
  t=$((t + 100))
  g branch pr
  # M1 first (main's trailer-excused change), then P, so P is the NEWER merge base.
  sed -i.bak 's|<p id="tok-x">old</p>|<p id="tok-x">new</p>|' "$d/web/index.html" && rm -f "$d/web/index.html.bak"
  echo x2 >> "$d/docs/browser-checks/render-x.js"
  g add -A && g commit -qm "M1" -m "Browser-check-surface: render-y.js wording only"
  t=$((t + 100))
  local m1; m1="$(g rev-parse HEAD)"
  g checkout -q pr
  # The positive variant changes the OTHER tok-x line, so the merge with M1 is clean.
  if [ "$2" = 1 ]; then sed -i.bak 's|<b class="tok-x">b</b>|<b class="tok-x">pr</b>|' "$d/web/index.html" && rm -f "$d/web/index.html.bak"; else echo e > "$d/engine.txt"; fi
  g add -A && g commit -qm P
  t=$((t + 100))
  g checkout -q main
  g checkout -q --detach "$m1" && g merge -q --no-ff -m H pr >/dev/null 2>&1
  local h; h="$(g rev-parse HEAD)"
  g checkout -q main && g merge -q --no-ff -m M2 pr >/dev/null 2>&1
  local m2; m2="$(g rev-parse HEAD)"
  g checkout -q --detach "$h"
  echo "$m1 $m2 $h"
}
gate_at() {  # <dir> <base> <lib> -> rc of the surface gate run in <dir> with no seams
  ( cd "$1" && unset KOSMOS_BCSG_WEBDIFF KOSMOS_BCG_FILES KOSMOS_BCG_MSGS KOSMOS_BCSG_DIR
    . "$3" && KOSMOS_BCG_BASE="$2" kosmos_browser_check_surface_gate ) >/dev/null 2>&1
}
read -r X_M1 X_M2 X_H <<< "$(xrepo "$TMP/xx" 0)"
nbases="$(git -C "$TMP/xx" merge-base --all "$X_M2" "$X_H" | wc -l | tr -d ' ')"
picked="$(git -C "$TMP/xx" merge-base "$X_M2" "$X_H")"; prhead="$(git -C "$TMP/xx" rev-parse "$X_H^2")"
# Both conditions, or the fixture no longer reproduces the dangerous pick and the arm below is vacuous.
[ "$nbases" = 2 ] && [ "$picked" = "$prhead" ] \
  && pass "criss-cross built: 2 merge bases, and git picks the PR head (the #3893 shape)" \
  || fail "the fixture did not reproduce #3893 (merge bases: $nbases; picked the PR head: $([ "$picked" = "$prhead" ] && echo yes || echo no))"
if gate_at "$TMP/xx" "$X_M2" "$HERE/lib/browser-check-surface-gate.sh"; then
  pass "#3893: a PR already merged into base is not refused for main's own excused change"
else
  fail "#3893: the gate refused main's own trailer-excused change on an already-merged PR"
fi
if gate_at "$TMP/xx" "$X_M1" "$HERE/lib/browser-check-surface-gate.sh"; then
  pass "#3893 control: the ordinary case (base = the tip the PR merged into) still passes"
else
  fail "#3893 control: the ordinary single-merge-base case must pass"
fi
# The fix must not blind the gate: a PR that DOES change tok-x without updating render-y.js
# (or excusing it) is still refused. First with one merge base (base = the tip it merged into),
# then IN the criss-cross (base = main after the PR merged), where anchoring on git's plain
# merge-base pick would read main's change and main's trailer and pass it (review, #3893).
read -r Y_M1 Y_M2 Y_H <<< "$(xrepo "$TMP/yy" 1)"
if gate_at "$TMP/yy" "$Y_M1" "$HERE/lib/browser-check-surface-gate.sh"; then
  fail "#3893 positive control: a PR changing tok-x with render-y.js not updated must be refused"
else
  pass "#3893 positive control: a PR's own unexcused surface change is still refused"
fi
if gate_at "$TMP/yy" "$Y_M2" "$HERE/lib/browser-check-surface-gate.sh"; then
  fail "#3893 criss-cross positive control: the PR's own unexcused change passed on main's trailer"
else
  pass "#3893 criss-cross positive control: the PR's own unexcused change is refused even when base already contains the PR"
fi
# The anchor helper is duplicated in both gate libs (each is sourced alone); the copies must match.
h1="$(sed -n '/^bcg_anchor_base() {/,/^}/p' "$HERE/lib/browser-check-surface-gate.sh")"
h2="$(sed -n '/^bcg_anchor_base() {/,/^}/p' "$HERE/lib/browser-check-gate.sh")"
if [ -n "$h1" ] && [ "$h1" = "$h2" ]; then
  pass "bcg_anchor_base is identical in both gate libs"
else
  fail "bcg_anchor_base differs between the two gate libs (or is missing)"
fi

# #5907: bc_surface_scan_checks (the gate's one-pass decision) agrees with the per-token primitives it replaced, on
# the real checks: every 10th annotated check, against a diff touching its first token and against one touching nothing
# mapped. The expected verdict is computed the original way (bc_surface_tokens_of + bc_surface_token_hits, token by
# token, the first hit wins), so a scan that drifted from the boundary match names the check. Plus one non-plain token:
# it must be SLOW, never decided by the scan.
. "$HERE/lib/browser-check-surface-lib.sh"
_SDIR="$(cd "$HERE/.." && pwd)/docs/browser-checks"
_sbad=0; _sn=0; _sreal=0
_expect() {   # $1 check path, $2 changed text -> "HIT <tok>", "MISS" or "SLOW"
  local toks t
  toks="$(bc_surface_tokens_of "$1")"
  while IFS= read -r t; do   # while-read, not for: no globbing of a token like `*`
    [ -n "$t" ] || continue
    case "$t" in *[!A-Za-z0-9_-]*) echo SLOW; return ;; esac
    if bc_surface_token_hits "$t" "$2"; then echo "HIT $t"; return; fi
  done <<< "$(printf '%s' "$toks" | tr ' \t' '\n\n')"
  echo MISS
}
_k=0
while IFS= read -r _c; do
  [ -n "$_c" ] || continue
  _toks="$(bc_surface_tokens_of "$_c")"; [ -n "$_toks" ] || continue
  _k=$((_k + 1)); [ $((_k % 10)) -eq 1 ] || continue
  _first="$(printf '%s' "$_toks" | tr ' \t' '\n\n' | grep -v '^$' | head -1)"
  for _chg in "+<p id=\"${_first}\">x</p>" "+<p id=\"zz-nothing-mapped-5907\">x</p>"; do
    _sn=$((_sn + 1)); _sreal=$((_sreal + 1))
    _want="$(_expect "$_c" "$_chg")"
    _got="$(bc_surface_scan_checks "$_SDIR" "$_chg" | awk -F '\t' -v f="$_c" '$1 == f { print ($2 == "HIT" ? $2 " " $3 : $2) }')"
    [ "$_got" = "$_want" ] || { fail "SCAN: ${_c##*/} on '$_chg': the scan says '$_got', the per-token primitives say '$_want'"; _sbad=1; }
  done
done <<< "$(find "$_SDIR" -maxdepth 1 -type f -name '*.js' 2>/dev/null)"
_nd="$TMP/bcsg-np"; mkdir -p "$_nd"   # under $TMP, so the EXIT trap removes it if the test dies here
printf '// Browser-check-surface: data-pmark="xai" plain-tok\n' > "$_nd/np.js"
_np="$(bc_surface_scan_checks "$_nd" '+<i data-pmark="xai" id="plain-tok">' | cut -f2)"
[ "$_np" = SLOW ] || { fail "SCAN: a check whose first token is not plain was decided by the scan ('$_np'), not left SLOW"; _sbad=1; }
# A plain token inside a longer run joined by `_`, `-` or capitals is not a match: the scan must agree with the primitives.
rm -f "$_nd/np.js"; printf '// Browser-check-surface: plain-tok tokx\n' > "$_nd/run.js"
for _chg in '+<i id="plain-tok_x">' '+<i id="plain-tok-y">' '+<i id="tokxZ">' '+<i id="plain-tok">'; do
  _sn=$((_sn + 1))
  _want="$(_expect "$_nd/run.js" "$_chg")"
  _got="$(bc_surface_scan_checks "$_nd" "$_chg" | awk -F '\t' '{ print ($2 == "HIT" ? $2 " " $3 : $2) }')"
  [ "$_got" = "$_want" ] || { fail "SCAN: run.js on '$_chg': the scan says '$_got', the per-token primitives say '$_want'"; _sbad=1; }
done
# A later token is the only hit, or both are: the first token in the annotation's order is the one named.
printf '// Browser-check-surface: first-tok second-tok\n' > "$_nd/run.js"
for _chg in '+<i id="second-tok">' '+<i id="second-tok"> <b id="first-tok">' '+<i id="first-tok">'; do
  _sn=$((_sn + 1))
  _want="$(_expect "$_nd/run.js" "$_chg")"
  _got="$(bc_surface_scan_checks "$_nd" "$_chg" | awk -F '\t' '{ print ($2 == "HIT" ? $2 " " $3 : $2) }')"
  [ "$_got" = "$_want" ] || { fail "SCAN: run.js on '$_chg': the scan says '$_got', the per-token primitives say '$_want'"; _sbad=1; }
done
# A Unicode space (U+00A0) around the key: the ambient-locale sed can read it as space, the C-locale scan cannot, so the
# scan must leave the check SLOW (to the sed), never skip it as unannotated.
printf '\302\240// Browser-check-surface: nb-tok\n' > "$_nd/run.js"
_nbv="$(bc_surface_scan_checks "$_nd" '+<i id="nb-tok">' | cut -f2)"
[ "$_nbv" = SLOW ] || { fail "SCAN: a key after a Unicode space was decided by the scan ('$_nbv'), not left SLOW"; _sbad=1; }
rm -rf "$_nd"
[ "$_sreal" -ge 20 ] || { fail "SCAN: only $_sreal real cases were sampled (want at least 20): the sampling found too few checks"; _sbad=1; }
[ "$_sbad" -eq 0 ] && pass "SCAN: bc_surface_scan_checks agrees with the per-token primitives on $_sreal real and $((_sn - _sreal)) synthetic cases, and leaves a non-plain token SLOW"

# #5907: the fallback (the scan cannot run, so every check takes the per-check path) gives the gate the same answer,
# word for word, as the scan does: forced by a TMPDIR the scan cannot write, on a diff touching a real mapped token.
_fbtok="$(bc_surface_tokens_of "$(find "$_SDIR" -maxdepth 1 -type f -name '*.js' | while IFS= read -r _c; do [ -n "$(bc_surface_tokens_of "$_c")" ] && { echo "$_c"; break; }; done)" | tr ' \t' '\n\n' | grep -v '^$' | head -1)"
printf '%s\n' '--- a/web/index.html' '+++ b/web/index.html' "+<p id=\"$_fbtok\">x</p>" > "$TMP/fb.wd"; : > "$TMP/fb.files"; : > "$TMP/fb.msgs"
_fbn="$( (KOSMOS_BCSG_WEBDIFF="$TMP/fb.wd" KOSMOS_BCG_FILES="$TMP/fb.files" KOSMOS_BCG_MSGS="$TMP/fb.msgs" KOSMOS_BCSG_DIR="$_SDIR" kosmos_browser_check_surface_gate) 2>&1; echo "rc=$?")"
_fbf="$( (TMPDIR="$TMP/no-such-dir" KOSMOS_BCSG_WEBDIFF="$TMP/fb.wd" KOSMOS_BCG_FILES="$TMP/fb.files" KOSMOS_BCG_MSGS="$TMP/fb.msgs" KOSMOS_BCSG_DIR="$_SDIR" kosmos_browser_check_surface_gate) 2>&1; echo "rc=$?")"
if [ -n "$_fbtok" ] && [ "$_fbn" = "$_fbf" ] && printf '%s' "$_fbn" | grep -q 'rc=1'; then
  pass "FALLBACK: with the scan unable to run, the gate refuses '$_fbtok' with the same words and exit as the scan path"
else
  fail "FALLBACK: the fallback and the scan path disagree on '$_fbtok' (or nothing was refused): scan='$(printf '%s' "$_fbn" | tail -1)' fallback='$(printf '%s' "$_fbf" | tail -1)'"
fi

# #5907: a check whose tokens did NOT change (a MISS to the scan) still prints its override line when a trailer names
# it, in any case, as the per-check path always did; with no trailer at all it prints nothing.
_ovchk="$(find "$_SDIR" -maxdepth 1 -type f -name '*.js' | while IFS= read -r _c; do [ -n "$(bc_surface_tokens_of "$_c")" ] && { echo "${_c##*/}"; break; }; done)"
printf '%s\n' '--- a/web/index.html' '+++ b/web/index.html' '+<p id="zz-nothing-mapped-5907">x</p>' > "$TMP/ov.wd"; : > "$TMP/ov.files"
_ovok=1
for _key in 'Browser-check-surface' 'BROWSER-CHECK-SURFACE' 'browser-Check-Surface'; do
  printf 'x\n\n%s: %s still fine\n' "$_key" "$_ovchk" > "$TMP/ov.msgs"
  _ovout="$( (KOSMOS_BCSG_WEBDIFF="$TMP/ov.wd" KOSMOS_BCG_FILES="$TMP/ov.files" KOSMOS_BCG_MSGS="$TMP/ov.msgs" KOSMOS_BCSG_DIR="$_SDIR" kosmos_browser_check_surface_gate) 2>/dev/null)"
  [ "$_ovout" = "browser-check surface gate: ${_ovchk} surface change overridden -- still fine" ] || { fail "OVERRIDE: a $_key trailer on an untouched check printed '$_ovout'"; _ovok=0; }
done
: > "$TMP/ov.msgs"
_ovnone="$( (KOSMOS_BCSG_WEBDIFF="$TMP/ov.wd" KOSMOS_BCG_FILES="$TMP/ov.files" KOSMOS_BCG_MSGS="$TMP/ov.msgs" KOSMOS_BCSG_DIR="$_SDIR" kosmos_browser_check_surface_gate) 2>&1)"
[ -z "$_ovnone" ] || { fail "OVERRIDE: with no trailer the gate printed '$_ovnone'"; _ovok=0; }
[ -n "$_ovchk" ] && [ "$_ovok" -eq 1 ] && pass "OVERRIDE: an untouched check's override line prints for a trailer in any case, and nothing prints without one"

echo "browser-check surface gate: $fails FAILED"
[ "$fails" -eq 0 ]
