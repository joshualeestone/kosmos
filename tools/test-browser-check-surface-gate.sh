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
# (or excusing it) is still refused, in the same criss-cross shape.
read -r Y_M1 Y_M2 Y_H <<< "$(xrepo "$TMP/yy" 1)"
if gate_at "$TMP/yy" "$Y_M1" "$HERE/lib/browser-check-surface-gate.sh"; then
  fail "#3893 positive control: a PR changing tok-x with render-y.js not updated must be refused"
else
  pass "#3893 positive control: a PR's own unexcused surface change is still refused"
fi

echo "browser-check surface gate: $fails FAILED"
[ "$fails" -eq 0 ]
