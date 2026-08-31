#!/bin/bash
# Cut a release: bump, test, build, publish, and verify what is SERVED.
#
#   bash tools/release.sh 0.2.12
#
# ⚠️ THIS SCRIPT LIVED IN A SCRATCHPAD FOR THREE RELEASES. Every improvement it
# gained — including the step that copies `/setup`, added after the installer
# served on the site was found a whole change stale — would have died with the
# session that wrote it. A release procedure that is not in the repo is a
# procedure the next person reconstructs from memory, which is how the same step
# goes missing twice.
#
# ⚠️ IT DOES NOT VERIFY ANYTHING ITSELF. `tools/verify-served.sh` does that, and
# it derives the artifact list from the code that FETCHES each one. Two
# derivations of "what a user receives" is this codebase's worst habit, and the
# first one is what missed `/setup`.
set -euo pipefail
V="${1:-}"
[ -n "$V" ] || { echo "usage: bash tools/release.sh <version>   e.g. 0.2.12"; exit 1; }
# The cut's first line in the record, written the moment the version is known
# and before ANY check can refuse (Shredder, 2026-08-25; hoisted above the
# node read and the site-checkout check after two controls died silently in
# front of them): "no lines at all" now means no cut was attempted, never
# "an environment refused one". This names the
# checkout HEAD at launch, BEFORE the version bump, so it is NOT the cut's sha
# and is named pre_bump_head so nobody quotes it as one (the 545dd7e mistake,
# Shredder 2026-08-25); step 3's line names the FROZEN sha (frozen_sha=), which
# is the cut. A "started" with no matching step-3 line is a cut that died early.
mkdir -p "$HOME/.claude/logs" 2>/dev/null || true
# ⚠️ DELIBERATE, NOT UNTIDY: $REPO is not defined yet this early, so the repo is
# resolved as this script's parent dir. Do not "simplify" it to $REPO; that
# blanks pre_bump_head= on every cut (it did, once, until a control caught it).
printf '%s version=%s started pre_bump_head=%s\n' "$(date -u +%FT%TZ)" "$V" "$(git -C "$(cd "$(dirname "$0")/.." && pwd)" rev-parse --short HEAD 2>/dev/null || echo unknown)" >> "$HOME/.claude/logs/cut-suite-runs.log" 2>/dev/null || true
# The tail of the record, mirror of the head (Shredder, 2026-08-25): without a
# completion line, "still running steps 4-9d" and "died at 4b, 8 or 9d" read
# identically at the end. Written once, from the EXIT trap, with the exit
# status, so a cut that dies anywhere after the started line still says so.
_CUT_DONE_WRITTEN=0
# ⭐ WHICH STEP DIED, because three cuts died on 2026-08-26 and the record could
# not tell anyone which phase any of them fell in. `completed exit=1` names the
# fact and none of the cause, so every death cost a fresh investigation that
# started by guessing the phase from elapsed time.
# `step` replaces the bare `echo` on each phase header: same line on screen,
# and the last one reached is what the completion line reports.
_STEP="before step 1"
step() { _STEP="$1"; echo "$1"; }
cut_record_done() {
  [ "$_CUT_DONE_WRITTEN" = 1 ] && return 0
  _CUT_DONE_WRITTEN=1
  # #1388: decode the exit so a KILLED step is a different row from a FAILED one.
  # A browser gate SIGTERM'd by another cut killed release.sh with exit 143, the
  # trap logged a bare `exit=143`, and it read as a red, sending readers to hunt
  # a product defect on a cut that had nothing wrong.
  #
  # 🛑 THE SIGNAL NAME IS RESOLVED FIRST, AND `killed` IS ONLY CLAIMED IF IT
  # RESOLVES. A first version treated every status over 128 as 128+signal
  # unconditionally, which FABRICATED names: exit 255 became
  # `outcome=killed signal=SIG127`, 192 became SIG64, 160 became SIG32, and this
  # bash has no such signals (`kill -l 32` exits 1, control `kill -l 15` prints
  # TERM). That is this card's own defect INVERTED and worse: a bare exit=143
  # sent a reader hunting a defect that was not there, while a fabricated
  # `signal=SIG127` tells a reader to STOP looking for one that IS.
  #
  # ⚠️ AND THE CLASSIFICATION IS A HEURISTIC EVEN WHEN IT RESOLVES, which the
  # first version stated as a fact. 128+n is a CONVENTION, not a guarantee, and
  # the ambiguity is live here: git exits 129 for any usage error (measured:
  # `git commit --bogus` -> 129, control `git status` -> 0), and this script
  # makes several unguarded git calls, so a genuine git usage error decodes as
  # SIGHUP. Nothing can separate those two from the status alone.
  #
  # 🛑 SO THE HEDGE IS IN THE ROW, NOT ONLY HERE. `basis=exit-status` says the
  # kill was INFERRED from the status rather than observed, which is the whole
  # truth available. A comment cannot help the person reading the log, and
  # `signal=SIGHUP` alone positively asserts that something signalled the cut.
  local _crd_rc="$1" _outcome _sig=""
  if [ "$_crd_rc" -eq 0 ]; then _outcome=ok
  elif [ "$_crd_rc" -gt 128 ] && _sig="$(kill -l "$((_crd_rc - 128))" 2>/dev/null)"; then _outcome=killed
  else _outcome=failed
  fi
  printf '%s version=%s completed exit=%s outcome=%s%s served=%s step=%s\n' \
    "$(date -u +%FT%TZ)" "$V" "$_crd_rc" "$_outcome" \
    "$([ -n "$_sig" ] && printf ' signal=SIG%s basis=exit-status' "$_sig")" \
    "${DEPLOYED:-0}" "$(printf '%s' "${_STEP:-unknown}" | tr -d '=' | tr ' ' '_')" \
    >> "$HOME/.claude/logs/cut-suite-runs.log" 2>/dev/null || true
}
# Installed HERE, before step 1 can refuse: the full trap below (site restore,
# thaw) only exists after the freeze, so a death at step 1 or 2 would leave the
# started line with no completion. The full trap replaces this one and calls
# the same once-only writer, so exactly one completed line is written per cut.
trap '_rc=$?; cut_record_done "$_rc"' EXIT

# 🔑 AFTER 0.2.99 COMES 0.3.0, and this refuses anything else. Josh, 2026-08-22:
# *"since we are getting close, when we get to 0.2.99 then lets roll to 0.3.00"*.
#
# ⚠️ A RULE IN A CARD DEPENDS ON WHOEVER IS AWAKE AT 0.2.99 HAVING READ IT, and
# at the current rate that is three weeks and several people from now. The
# version is a bare argument to this script, so nothing otherwise stops
# `0.2.100` being typed at exactly the moment nobody is thinking about it — and
# by then it is published, polled by every install, and in the versions page.
# Mona Lisa's call, and it is the same argument as baking the version rather
# than fetching it: answer it once instead of asking every future author.
#
# ⚠️ IT REFUSES RATHER THAN CORRECTS. Silently shipping 0.3.0 when somebody
# asked for 0.2.100 would be a release nobody named, and the entry they wrote on
# the versions page is stamped with the version they typed.
_prev="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$(cd "$(dirname "$0")/.." && pwd)/package.json','utf8')).version)")"
if [ "$_prev" = "0.2.99" ] && [ "$V" != "0.3.0" ]; then
  echo "0.2.99 is the last of the 0.2 line: the next version is 0.3.0, not $V."
  echo "(Josh's ruling, 2026-08-22. If that has changed, this guard is in tools/release.sh.)"
  exit 1
fi
case "$V" in
  0.2.1[0-9][0-9]*)
    echo "$V is past the end of the 0.2 line. 0.2.99 is the last one; after it comes 0.3.0."
    exit 1 ;;
esac
# 🔑 FROM THE 0.6 LINE ON, THE PATCH IS TWO DIGITS AND THE LINE ENDS AT 99.
# Josh, 2026-08-28: he did not want 0.5.100 and up, he wanted "0.6.00 and then
# 0.6.01". Same reasoning as the 0.2 guard above and it is stated there: a rule
# in a card depends on whoever is awake having read it, and the version is a
# bare argument to this script.
#
# ⚠️ THIS FILE ALREADY ARGUED THE OPPOSITE AND BOTH ARGUMENTS ARE RIGHT. The
# 0.2.99 arm refuses "0.3.00" because engine/update.js parses a version into
# three NUMBERS, so "0.3.0" and "0.3.00" are the SAME version to every install
# and publishing both is an update no machine ever sees. That is a SECOND
# SPELLING hazard, not a padding hazard.
#
# ⇒ Josh's scheme is safe for exactly the reason the other was unsafe: the
# padded form is the ONLY form. The rule is "one spelling per line", and from
# 0.6 on the one spelling is padded. So this guard is not bookkeeping: without
# it, publishing 0.6.0 after 0.6.00 ships an update no install can see, which
# is the silent-no-update failure this project has already shipped once.
#
# 📌 It refuses rather than corrects, like the guard above, because the entry on
# the versions page is stamped with the version the author typed.
_v_major="${V%%.*}"
_v_rest="${V#*.}"
_v_minor="${_v_rest%%.*}"
_v_patch="${V##*.}"
case "$_v_major.$_v_minor" in
  0.[6-9]|0.[1-9][0-9]*)
    case "$_v_patch" in
      [0-9][0-9]) ;;
      [0-9])
        echo "from the 0.$_v_minor line on the patch is two digits: you asked for $V, which is spelled $_v_major.$_v_minor.0$_v_patch."
        echo "(Josh's ruling, 2026-08-28. $V and $_v_major.$_v_minor.0$_v_patch are the SAME version to every install,"
        echo " so only one spelling may ever be published. If that has changed, this guard is in tools/release.sh.)"
        exit 1 ;;
      *)
        echo "$V is past the end of the 0.$_v_minor line. 0.$_v_minor.99 is the last one; after it comes 0.$((_v_minor + 1)).00."
        exit 1 ;;
    esac
    # Standing at the end of a line, only the next line's first version will do.
    _p_rest="${_prev#*.}"
    _p_minor="${_p_rest%%.*}"
    if [ "${_prev##*.}" = "99" ] && [ "$_p_minor" = "$_v_minor" ]; then
      echo "0.$_p_minor.99 is the last of the 0.$_p_minor line: the next version is 0.$((_p_minor + 1)).00, not $V."
      echo "(Josh's ruling, 2026-08-28. If that has changed, this guard is in tools/release.sh.)"
      exit 1
    fi ;;
esac

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SITE="${KOSMOS_SITE:-$HOME/work/chaoskosmos-site}"
[ -d "$SITE/dist" ] || { echo "no site checkout at $SITE (set KOSMOS_SITE)"; exit 1; }
# ⚠️ THIS SITS AFTER THE SITE CHECK ON PURPOSE, and the ordering is pinned by a
# test rather than by this comment. tools.release-gate.test.js builds a sandbox
# holding ONLY tools/release.sh, and its positive control asserts that a valid
# version reaches the site check -- that is its definition of "got through the
# gate". Sourcing a sibling lib ABOVE that line made the script die on a missing
# file instead, so BOTH positive controls went red while every refusal test
# stayed green: the gate looked stricter, which is the comfortable direction and
# the one nobody questions. Found by Mona Lisa, 14 minutes after I shipped it.
# Nothing here mutates anything, so refusing a second cut one line later costs
# nothing and keeps the harness able to reach the check it exists to make.
# 🛑 TWO CUTS ON ONE MAC DESTROY EACH OTHER, and it has already happened: the
# 18:28 attempt at 0.5.73 died because a fixture server was SIGTERM'd by the
# other cut's teardown (#1050). They share the install gate's fixed ports, the
# real ~/Applications and /Applications fingerprints and the gui launchd
# domain, so either one's result can be the other's.
# ⭐ THE GUARD FOR EXACTLY THIS EXISTED AND NOTHING CALLED IT. tools/lib/
# cut-guard.sh was written for #708 and wired only into test-install.sh, so
# the one script that STARTS a cut never asked. A fix that reaches the artifact
# but not the running system is not delivered.
# ⚠️ Placed AFTER the started line on purpose: line 33's contract is that a
# refusal is recorded, so "no lines at all" keeps meaning "no cut attempted".
# ⚠️ And the guard asks whether a `bash tools/release.sh` is running, which is
# what THIS is: it excludes the caller's own pid, and tools/test-cut-guard.sh
# runs a real `bash tools/release.sh` to prove it does not refuse itself.
. "$REPO/tools/lib/cut-guard.sh"
if [ "${KOSMOS_HARNESS_IGNORE_CUT:-0}" != 1 ]; then
  kosmos_refuse_if_cut_live "a second cut" || exit 1
fi

step "== 1. main, clean, and carrying what you mean to ship =="
git -C "$REPO" fetch origin -q
[ "$(git -C "$REPO" rev-parse --abbrev-ref HEAD)" = main ] || { echo "not on main"; exit 1; }
[ -z "$(git -C "$REPO" status --porcelain)" ] || { echo "main is dirty"; exit 1; }

# 🛑 A FAILED BUMP PUSH IS SAFE FOR ONE CUT AND UNSAFE FOR TWO (kosmos#1335).
# Step 2 pushes the version bump and, if that push fails, says so and CONTINUES
# on purpose: the artifact it builds is still correct, and refusing a good
# release over a push failure would be worse.
#
# ⚠️ THE HAZARD IS ENTIRELY IN THE SECOND CUT, AND NOTHING IN THE FIRST
# WARNING'S TEXT SAYS SO. The unpushed bump leaves local `main` on a line that
# has diverged from origin, so the NEXT cut freezes a tree that is missing
# whatever landed on origin meanwhile, while its notes claim it. 0.5.101 was cut
# from a line with no #1332 in it and its notes promised #1332: a release served
# to the one person waiting for that fix, with the fix absent. That does not just
# ship nothing, it spends the credibility of every future release note.
#
# 🔑 SO THE CHECK IS ON THE DIVERGENCE, NOT ON THE PUSH. The failed push is only
# dangerous because of the state it leaves, and that state is directly
# observable, so this cannot go stale the way a remembered incident does.
#
#   local == origin           ancestor      -> cut
#   local BEHIND origin       ancestor      -> cut, because cutting an older
#                                              tree on purpose is a real thing
#                                              to want and this must not block it
#   local has what origin has not           -> REFUSE. This is the 0.5.100 and
#                                              0.6.00 shape, twice in one week.
#
# It refuses rather than reconciling, like the version guard above: silently
# rebasing somebody's tree during a release is a worse surprise than stopping.
#
# ⚠️ GUARDED ON `origin/main` RESOLVING, AND THAT IS NOT DEFENSIVE PADDING. The
# gate's own tests run this script in a sandbox that is not a git repo, where
# `git status` errors and prints nothing so the dirty check above passes by
# accident. An unguarded ancestry check would REFUSE there and turn the suite
# red for a reason that has nothing to do with releases.
if git -C "$REPO" rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
  if ! git -C "$REPO" merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
    echo "local main has commits origin/main does not, so this cut would freeze a diverged tree."
    echo "The usual cause is a previous cut printing 'COULD NOT PUSH THE BUMP' (kosmos#1335)."
    echo
    echo "   only here:  $(git -C "$REPO" log --oneline origin/main..HEAD | tr '\n' ' ')"
    echo "   only there: $(git -C "$REPO" log --oneline HEAD..origin/main | tr '\n' ' ')"
    echo
    echo "Reconcile first, then cut. If the local commits are a stranded version bump:"
    echo "   git -C $REPO reset --hard origin/main && git -C $REPO cherry-pick <bump> && git -C $REPO push origin main"
    exit 1
  fi
fi
git -C "$REPO" log --oneline -8 | cat

# ⚠️ LAST IN STEP 1, NOT FIRST, AND THE ORDER IS LOAD-BEARING. Placed before
# the divergence guard this pre-empts it, and a cut from a diverged tree then
# refuses with "no versions entry" instead of naming the stranded commits --
# measured, it turned three release-gate arms red. Every git-integrity refusal
# in this step keeps its precedence; this one only has to beat the BUILD.
# 🛑 THE VERSIONS ENTRY IS A PRECONDITION AND IT USED TO BE ASKED ABOUT ONLY AT
# STEP 7, AFTER THE SUITE, THE BROWSER GATE, THE INSTALL GATE AND THE BUILD
# (#1463). Four cuts died there -- 0.5.80, 0.5.90, 0.5.91, 0.6.06 -- each
# paying about fifteen minutes of machine time to learn something knowable in
# three seconds from `$V` and `$SITE`, both of which exist by now.
#
# 🔑 THE STEP 7 CALL IS KEPT AND THE TWO ARE NOT REDUNDANT: this one asks "can
# this cut finish?", that one asks "is the page right at the moment we deploy?"
# The rationale and the two windows are in the lib. They are NOT the same
# window: step 1 is stricter on the past side, because it can see that an
# already-stale entry is doomed once the cut adds its own fifteen minutes.
. "$REPO/tools/lib/versions-entry.sh"
# 🛑 ITS OWN STEP LABEL, AND THAT IS NOT COSMETIC. `cut_record_done` writes
# `$_STEP` into ~/.claude/logs/cut-suite-runs.log, and that log is the ONLY
# instrument that can count how a cut died. Left under step 1's banner, a
# versions-entry refusal records as `step=_1._main,_clean,...`, which is
# indistinguishable from "main is dirty" and from the divergence refusal.
#
# ⚠️ THE CASE FOR THIS WHOLE CHANGE WAS BUILT BY COUNTING THAT LOG: four lines
# read `step=_7._the_versions_page_needs_its_entry_BEFORE_you_deploy_`, against
# a fabricated-label control of zero. Moving the check earlier without moving
# its label would have made the next four uncountable -- the change would have
# destroyed the measurement that justified it, and nobody would notice, because
# the failures would simply blend into a busier bucket.
step "== 1b. the versions entry, before anything is built =="
kosmos_versions_entry_gate "$V" "$SITE/versions.html" "Nothing has been built yet." \
  "Stamp it for when you expect to PUBLISH, about 15 minutes out -- a stamp written now, or already minutes old, is stale by step 7." \
  "$KOSMOS_STEP1_PAST_BOUND" || exit 1

step "== 2. the version, in one place =="
node -e "
const fs=require('fs'),p='$REPO/package.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
if(j.version!=='$V'){ j.version='$V'; fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n'); console.log('   bumped to $V'); }
else console.log('   already $V');"

# 🛑 AND THE BUMP IS COMMITTED BEFORE ANYTHING IS BUILT, because otherwise THE
# GUARD IN STEP 1 IS DEFEATED BY STEP 2. It checks a clean tree, then this makes
# the tree dirty, and the bundle is stamped `<sha>-DIRTY` by
# `git describe --dirty` — which is honest and means the artifact people are
# running is not checkoutable. 0.2.11 and 0.2.12 both shipped that way, and both
# times somebody had to hash the bundle against a commit to establish that
# nothing unexpected was in it.
#
# ⚠️ THE POINT IS NOT TIDINESS. A version stamp that cannot be resolved to a
# commit means "what is this person running" is answerable only by comparison,
# which is exactly the question a release exists to make cheap.
if ! git -C "$REPO" diff --quiet -- package.json; then
  git -C "$REPO" add package.json
  git -C "$REPO" commit -q -m "v${V//./} -- version"
  echo "   committed the bump, so the build is stamped at a real commit"
  # 🛑 AND PUSHED, BECAUSE A COMMIT THAT NEVER LEAVES IS NOT A STAMP. This
  # script committed the bump and stopped, so every release left its version
  # commit on one machine. Nothing looked wrong: the bundle carried the right
  # version, the site served it, and `verify-served.sh` passed, because every
  # check here measures the ARTIFACT and none of them asks whether the commit
  # the artifact is stamped at exists anywhere else.
  #
  # ⚠️ The whole reason for the paragraph above is that a version resolves to a
  # commit. A commit only this machine has does not resolve for anybody, so the
  # unpushed state defeats the stated purpose rather than merely being untidy.
  #
  # 📌 A failure here is REPORTED AND NOT FATAL. The release is about what the
  # site serves; being unable to reach the remote is a real thing to say and a
  # bad reason to refuse to ship. Step 9 still proves what a user receives.
  if git -C "$REPO" push -q origin HEAD 2>/dev/null; then
    echo "   pushed it, so the stamp resolves somewhere other than this machine"
  else
    echo "   ⚠️  COULD NOT PUSH THE BUMP. The release continues, and the version"
    echo "      stamp resolves to a commit only this machine has until you do."
  fi
fi
[ -z "$(git -C "$REPO" status --porcelain)" ] || {
  echo "the tree is dirty after the bump; the bundle would ship as -DIRTY"; exit 1; }
# ⚠️ CAPTURED HERE, the instant the tree is known clean, so the frozen sha is
# HEAD-with-the-bump and everything downstream (tested == built == served ==
# named) keys off this one value. It is HEAD, not literally the bump commit:
# a fast-forward pull between the bump and this line would fold other agents'
# commits in, and that is fine -- the bump cannot be lost (a failed push
# leaves the pull non-ff, so HEAD never moves past the local bump), and the
# invariant holds whatever HEAD is. Reading it INSIDE 2b, later, was the only
# real hazard: a pull there could move the tree after some steps had run.
SHA="$(git -C "$REPO" rev-parse HEAD)"

step "== 2b. the tree that ships, frozen at one sha (#597) =="
# 🛑 FROM HERE ON, $REPO IS A DETACHED WORKTREE AT THE BUMP SHA, NOT THE
# SHARED CHECKOUT. The checkout this script lives in is pulled by every agent
# on the Mac; on 2026-08-24 two cuts in a row were fast-forwarded mid-run, so
# the suite and the page gate ran on one sha and the bundle shipped another.
# Steps 3 through 6 (3c's pkg build and 4b's install gate included) run in the frozen tree, and so does step 9:
# verify-served.sh reads $REPO/install/setup.sh and $REPO/package.json, and
# its baked-in default REPO is the shared checkout, so the REPO="$REPO" pass
# below is load-bearing, not redundant. Step 9b compares what is SERVED
# against the frozen tree; only step 10 (the board on this Mac runs from the
# shared checkout) goes back to MAIN_REPO. The worktree is removed on every exit.
. "$REPO/tools/lib/release-freeze.sh"
MAIN_REPO="$REPO"
BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-release.XXXXXX")" || { echo "no temp dir for the frozen tree"; exit 1; }
BUILD="$(release_freeze "$MAIN_REPO" "$SHA" "$BUILD_ROOT")" || { rm -rf "$BUILD_ROOT"; echo "could not freeze the tree at $SHA"; exit 1; }
# The versioned pair's presence BEFORE this cut, so a failure removes only what
# this cut created (a pair from an earlier, served cut is not ours to touch).
_pair_had=0; [ -f "$SITE/dist/kosmos-$V-arm64.tar.gz" ] && _pair_had=1
# #1548: whether the UNVERSIONED pointer (kosmos-arm64.tar.gz) existed before this
# cut. Unlike the versioned pair, the pointer is overwritten just before the deploy and
# must keep pointing at the SERVED version, so a failure restores the pre-cut copy
# (backed up under BUILD_ROOT, not in the site checkout, just before the overwrite)
# rather than removing it.
# had_ptr=0 means a fresh site clone: then the pointer this cut created is removed.
_ptr_had=0; [ -f "$SITE/dist/kosmos-arm64.tar.gz" ] && _ptr_had=1
DEPLOYED=0
# On any exit before step 8 finished, the site checkout stops claiming $V
# (#609 review, Splinter 23:05: a failed cut left latest.json and setup.sha256
# uncommitted at the new version, and the pair that made cut 5 refuse).
trap '_rc=$?; cut_record_done "$_rc"; [ "$DEPLOYED" = 1 ] || release_site_restore "$SITE" "$V" "$_pair_had" "$_ptr_had" "$BUILD_ROOT"; release_thaw "$MAIN_REPO" "$BUILD"; rm -rf "$BUILD_ROOT"' EXIT
REPO="$BUILD"
release_freeze_notice "$SHA" "$BUILD"

step "== 3. the whole suite, on the tree that ships =="
# ⚠️ CORRECTED CLAIM: the old `yarn test | grep` gate DID refuse a red
# suite (pipefail makes the pipeline's status yarn's, and errexit
# stops the script), measured by the PM against my first reading of it,
# which said otherwise from the shape alone. What the old gate did
# wrong was refuse SILENTLY, with the reason invisible. This form
# captures the exit before errexit can eat it, prints the suite's own
# summary lines, and names the log a red run's detail lives in.
_suite_log="$(mktemp)"
_suite_exit=0
( cd "$REPO" && yarn test >"$_suite_log" 2>&1 ) || _suite_exit=$?
grep -E '^ℹ (tests|pass|fail)' "$_suite_log" || true
# 📌 AN AUDIT TRAIL, NOT A GUARD (Splinter, 2026-08-25 05:30; the guard reading
# was withdrawn: this step cannot be skipped, it refuses a red on its own).
# One line per cut naming the frozen sha and the exit, appended BEFORE the
# refusal, because a red cut otherwise leaves only a temp log that is
# cleaned up: the reds were the least-recorded events in the pipeline. A
# green is a fact about one sha and expires on the next merge; the record
# says which. At many small cuts a day, "which sha did we ship and was it
# green" lives in one file rather than in chat.
mkdir -p "$HOME/.claude/logs" 2>/dev/null || true
printf '%s version=%s frozen_sha=%s suite_exit=%s\n' "$(date -u +%FT%TZ)" "$V" "$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)" "$_suite_exit" >> "$HOME/.claude/logs/cut-suite-runs.log" 2>/dev/null || true
# ⚠️ 126/127 IS NOT A RED SUITE. It means the suite could not be run at all
# (yarn or node missing or not executable), and saying "red" about it sends
# the person to read assertions that never ran (#785, three flavours of this
# in one day). Refuse either way, with the true sentence.
if [ "$_suite_exit" -eq 126 ] || [ "$_suite_exit" -eq 127 ]; then echo "the suite COULD NOT RUN (exit $_suite_exit: yarn, node or a program a shell test calls is missing or not executable); this is not a failing test. Full output: $_suite_log"; exit 1; fi
[ "$_suite_exit" -eq 0 ] || { echo "the suite is red (exit $_suite_exit); full output: $_suite_log"; exit 1; }
rm -f "$_suite_log"

step "== 3b. the page layer, headless (#39) =="
# ⚠️ THE PAGE IS PART OF WHAT SHIPS, and `node --test` cannot see it: round
# 16 of the project-chat review put 18 page mutations through the whole
# suite and 16 survived. The browser checks CAN see it and now gate the
# release the same way the suite does: exit code, printed reason, named
# log. The harness fails LOUD when no Playwright is on the machine
# (KOSMOS_SKIP_BROWSER_CHECKS=1 is the explicit, printed opt-out), so a
# release machine without a browser says so rather than shipping an
# unchecked page.
_page_log="$(mktemp)"
_page_exit=0
( cd "$REPO" && bash tools/browser-checks.sh >"$_page_log" 2>&1 ) || _page_exit=$?
grep -E '^PASS |^FAIL |^COULD NOT RUN|^‼️|retried:|all page' "$_page_log" || true
if [ "$_page_exit" -eq 126 ] || [ "$_page_exit" -eq 127 ]; then echo "the page gate COULD NOT RUN (exit $_page_exit: bash, node or a program it needs is missing or not executable); this is not a red check. Full output: $_page_log"; exit 1; fi
[ "$_page_exit" -eq 0 ] || { echo "the page checks are red (exit $_page_exit); full output: $_page_log"; exit 1; }
rm -f "$_page_log"

step "== 3c. the installer .pkg, rebuilt and published only when its inputs changed (#555, #638 B) =="
# 🛑 THE DOWNLOAD BUTTON SERVES THIS FILE AND NO RELEASE STEP EVER TOUCHED IT.
# Baron built and hand-copied the first Kosmos.pkg (2026-08-24); every
# installer fix after that reached nobody until someone remembered, and the
# same afternoon a hand republish went live beside the previous build's
# .sha256. This step is the remembering. It is NOT a rebuild every cut: the pkg is payload-free
# (a postinstall that runs the served /setup), so it changes only when its
# INPUTS change (pkg-scripts, pkg-resources, the build script, which carries
# the identifier; tools/lib/pkg-inputs.sh is the one definition). A rebuild
# costs a sign + notarise round trip, minutes, and only when one of those
# moved. It sits BEFORE step 4 on purpose: step 4 copies the cache-immutable
# versioned tarball into the site dist, and a notarisation flake after that
# would make the re-run refuse at the versioned name and cost a version bump.
# Here a flake aborts a cut nothing has been copied for, and a successful
# build leaves the triple in the site's working tree, so a later abort (the
# versions page, say) costs nothing on the re-run: 3c finds it current.
# ⚠️ AND IF THERE IS NO RE-RUN: the triple sits in the site's working tree,
# built from the pushed bump sha (not stale), and the next site deploy by
# anyone publishes it with no 9c behind it. verify-served.sh is the check
# that then applies; run it after any site deploy that follows an abandoned
# cut.
# ⚠️ NOT COMMITTED, CARRIED BY NAME: the site gitignores dist/*.pkg,
# dist/*.pkg.sha256 and dist/*.pkg.inputs (build output), so the triple has
# no commit behind it; step 8's export carries it as a named artifact class
# (tools/lib/site-deploy.sh), which is how #649's working-tree accident became
# a decision. Step 9c and verify-served.sh check what is actually served, and
# this step says out loud whether it published, so a stale pkg is a red line,
# never a quiet skip.
. "$REPO/tools/lib/pkg-inputs.sh"
# The upload filter must carry the triple, or 9c reds after a ten-minute wait
# for a reason a read can give now, BEFORE any sign + notarise minutes are
# spent (it depends on nothing the build produces). Evaluated by git on the filter's own
# patterns (the same semantics Vercel applies), and a MISSING filter is a
# refusal: without one Vercel falls back to the site's .gitignore, which
# excludes dist/*.pkg, which is the exact hole the site's .gitignore warns of.
# The COMMITTED filter, because the deploy ships the export of HEAD (#649),
# not the working tree: an uncommitted edit to .vercelignore is not what the
# deploy applies, so it is not what this guard may vouch for.
_vi_tmp="$(mktemp "$BUILD_ROOT/vercelignore.XXXXXX")"
if git -C "$SITE" show HEAD:.vercelignore > "$_vi_tmp" 2>/dev/null; then :; else rm -f "$_vi_tmp"; _vi_tmp="$BUILD_ROOT/no-such-vercelignore"; fi
set +e; _pkg_dropped="$(pkg_upload_filter_excludes "$_vi_tmp")"; _pkg_frc=$?; set -e
if [ "$_pkg_frc" = 1 ]; then
  echo "no committed .vercelignore at the site's HEAD (the export ships the committed one); Vercel would fall back to .gitignore and drop dist/Kosmos.pkg from the upload"; exit 1
elif [ "$_pkg_frc" != 0 ]; then
  echo "could not evaluate the site's .vercelignore (rc=$_pkg_frc); refusing to assume the deploy carries the pkg"; exit 1
elif [ -n "$_pkg_dropped" ]; then
  echo "the site's .vercelignore excludes $_pkg_dropped; the deploy would not carry the pkg triple"; exit 1
fi
echo "   .vercelignore carries dist/Kosmos.pkg, .sha256 and .inputs (evaluated by git)"
_pkg_want="$(pkg_input_sha "$REPO")" || { echo "could not compute the pkg input sha from the frozen tree"; exit 1; }
# ⚠️ THE VERDICT IS THE EXIT CODE (0 needed, 2 current), read under set +e so
# an ERROR inside the decision (exit 1, or anything else) stops the cut instead
# of reading as "current" and skipping the publish: fail closed.
set +e; _pkg_why="$(pkg_publish_needed "$SITE/dist" "$_pkg_want")"; _pkg_rc=$?; set -e
if [ "$_pkg_rc" = 0 ]; then
  echo "   rebuilding Kosmos.pkg: $_pkg_why"
  # Built FROM THE FROZEN TREE (REPO is the detached worktree from 2b), signed,
  # notarised, stapled; the script refuses to build unsigned. It writes
  # Kosmos.pkg + .sha256 + .inputs into $REPO/dist.
  ( cd "$REPO" && OUT_DIR="$REPO/dist" bash tools/build-installer-pkg.sh "$V" )
  [ "$(pkg_sidecar_inputs "$REPO/dist/Kosmos.pkg.inputs")" = "$_pkg_want" ] || { echo "the built pkg's input sidecar is not the sha this step computed; the build script and the guard disagree"; exit 1; }
  cp "$REPO/dist/Kosmos.pkg" "$REPO/dist/Kosmos.pkg.sha256" "$REPO/dist/Kosmos.pkg.inputs" "$SITE/dist/"
  PKG_PUBLISHED=1
  echo "   published to the site dist: Kosmos.pkg $(awk '{print substr($1,1,12)}' < "$SITE/dist/Kosmos.pkg.sha256"), inputs ${_pkg_want:0:12}"
elif [ "$_pkg_rc" = 2 ] && case "$_pkg_why" in current:*) true;; *) false;; esac; then
  PKG_PUBLISHED=0
  echo "   Kosmos.pkg not rebuilt: $_pkg_why"
else
  echo "could not decide whether the pkg needs publishing (rc=$_pkg_rc: ${_pkg_why:-no reason printed}); refusing to guess"; exit 1
fi


step "== 4. build =="
( cd "$REPO" && bash tools/build-kosmos-bundle.sh dist )

step "== 4b. a real install from the bundle just built, sandboxed, before anything is served (#624) =="
# 🛑 EVERY EARLIER CHECK MEASURED THE BYTES. Step 3 ran the suite, 9b proves
# served == built file by file, and neither ever INSTALLED the thing: a
# change to the bundle's SHAPE (a file the installer's post-extract check
# expects, a changed extract) passed all of them and could still fail on a
# stranger's Mac. tools/test-install.sh is that install, sandboxed in every
# root, run by hand before #583's cut and by nothing since; this runs it in
# gate mode (the install, update, uninstall and download-path passes, then
# the "nothing leaked" checks) on THIS build, and a red stops the cut here.
# The kosmos bundle is the one step 4 just packed. The tmux bundle is the
# site working tree's copy of the served pair (step 4 does not build it; the
# wire is what 9 verifies), extracted into the frozen dist the way the harness expects.
# 🛑 BEFORE ANY COPY INTO THE SITE DIST. The first placement of this step was
# after step 4's copies, so a bundle that failed to install already sat under
# the plain name in the site tree (the export carries dist/*.tar.gz by name,
# so the next site deploy by anyone would have shipped it), and the re-run
# after the fix hit the versioned-name refusal and cost a version bump.
[ -f "$SITE/dist/tmux-arm64.tar.gz" ] && [ -f "$SITE/dist/tmux-arm64.tar.gz.sha256" ] || { echo "no tmux bundle pair in $SITE/dist (a fresh site checkout has none: fetch the served pair from ${HOST:-https://installkosmos.com}/dist/tmux-arm64.tar.gz and .sha256 into $SITE/dist, or build one with tools/build-tmux-bundle.sh); the install gate cannot run"; exit 1; }
cp "$SITE/dist/tmux-arm64.tar.gz" "$SITE/dist/tmux-arm64.tar.gz.sha256" "$REPO/dist/"
rm -rf "$REPO/dist/tmux-bundle"; mkdir -p "$REPO/dist/tmux-bundle"
tar -xzf "$REPO/dist/tmux-arm64.tar.gz" -C "$REPO/dist/tmux-bundle" || { echo "the served tmux bundle does not extract"; exit 1; }
# A bare mktemp, like step 3's suite log: the red branch exits, the 2b trap
# removes BUILD_ROOT, and a log under it would be gone before anyone read it.
# ⚠️ DISK, SAID BY NAME. A gate run uses ~300 MB transiently (measured
# 2026-08-24: 277 MB peak, returned on exit; gate mode never reaches the
# probe blocks whose fresh homes each pull a 345 MB Claude Code install),
# but this Mac reached 288 MB free tonight, and an install failing on a
# full disk reads as a broken bundle, not as a full disk. Refuse below 2 GB
# and name the disk, so the red says what it is.
. "$REPO/tools/lib/disk-guard.sh"
kosmos_require_free_mb 2048 "${TMPDIR:-/tmp}" "the install gate (~300 MB transient)" || exit 1
_gate_log="$(mktemp "${TMPDIR:-/tmp}/kosmos-install-gate.XXXXXX")"
if ( cd "$REPO" && KOSMOS_INSTALL_GATE=1 bash tools/test-install.sh ) > "$_gate_log" 2>&1; then
  echo "   $(grep -E ' passed, ' "$_gate_log" | tail -1 || true): the bundle installs, updates, uninstalls and downloads-and-installs in a sandbox"
  rm -f "$_gate_log"
else
  echo "THE BUNDLE JUST BUILT DOES NOT INSTALL. No bundle was copied to the site. The gate said:"
  # The fallback: under set -e a log with no FAIL, summary or SKIP line (the
  # harness died before its first check, or refused at its staged-trees line)
  # would abort here with the headline and no reason; print its tail instead.
  grep -E '^FAIL|^   |passed, |SKIP' "$_gate_log" | sed 's/^/   /' || tail -15 "$_gate_log" | sed 's/^/   /'
  [ "${PKG_PUBLISHED:-0}" = 1 ] && echo "   (3c already put a rebuilt Kosmos.pkg triple in $SITE/dist; a site deploy before the next cut would carry it; verify-served.sh is the check that applies)"
  echo "   (full log: $_gate_log)"; exit 1
fi

# The connector's checksum, from the tarball THIS build just produced, so step
# 9b can prove the SERVED tunnel is byte-for-byte the one tested here (#583).
# The connector is not a tree file (kosmos-relay builds it), so this is its
# source of truth, the analog of the app/ files' tree comparison.
# ⚠️ `tar | shasum` in a pipeline: under set -o pipefail a member-absent tar
# would abort the assignment before the guard below could name the cause, so
# extract to a file first (tar's own non-zero is captured, not fatal here) and
# let the guard speak.
_tunnel_tmp="$(mktemp)"
if tar -xzOf "$REPO/dist/kosmos-arm64.tar.gz" app/bin/kosmos-tunnel > "$_tunnel_tmp" 2>/dev/null && [ -s "$_tunnel_tmp" ]; then
  TUNNEL_SHA="$(shasum -a 256 "$_tunnel_tmp" | awk '{print $1}')"
else
  rm -f "$_tunnel_tmp"; echo "the built bundle carries no Plus connector (app/bin/kosmos-tunnel); build-kosmos-bundle.sh should have refused"; exit 1
fi
rm -f "$_tunnel_tmp"
echo "   connector: kosmos-tunnel $TUNNEL_SHA"

# The native launcher's checksum (#677), same shape and same reason as the
# connector's above: it is compiled from a tree file (native-app/main.swift)
# but codesigning changes its bytes on every build, so the plain tree
# comparison that works for a .js file cannot apply to it -- this checksum,
# from the tarball THIS build just produced, is its source of truth instead.
_native_app_tmp="$(mktemp)"
if tar -xzOf "$REPO/dist/kosmos-arm64.tar.gz" app/bin/kosmos-app > "$_native_app_tmp" 2>/dev/null && [ -s "$_native_app_tmp" ]; then
  NATIVE_APP_SHA="$(shasum -a 256 "$_native_app_tmp" | awk '{print $1}')"
else
  rm -f "$_native_app_tmp"; echo "the built bundle carries no native app (app/bin/kosmos-app); build-kosmos-bundle.sh should have refused"; exit 1
fi
rm -f "$_native_app_tmp"
echo "   native app: kosmos-app $NATIVE_APP_SHA"
# 🛑 BEFORE THE FIRST COPY TOWARD THE SITE (#609): the bundle just built carries
# every file the tree and the app need, and each present file equals the
# tree's. The same comparator runs at 9b on the SERVED bytes; here it runs on
# the built ones, so a file the build forgot (#731: the codex bridge, absent
# from every served bundle for ten versions) stops the cut with nothing
# published, instead of being caught after step 8 has deployed it.
_cmp_rc=0; release_bundle_matches_tree "$REPO/dist/kosmos-arm64.tar.gz" "$BUILD" "$TUNNEL_SHA" "$NATIVE_APP_SHA" || _cmp_rc=$?
if [ "$_cmp_rc" -eq 0 ]; then
  echo "   the built bundle carries everything the tree and the app need, and every file in it is the tree's"
else
  if [ "$_cmp_rc" -eq 2 ]; then echo "THE BUNDLE JUST BUILT COULD NOT BE CHECKED AGAINST THE TREE (the lines above say why). No bundle was copied to the site."
  else echo "THE BUNDLE JUST BUILT IS NOT THE TREE THAT WAS TESTED, OR LACKS A FILE THE APP NEEDS (the lines above name it). No bundle was copied to the site."; fi
  [ "${PKG_PUBLISHED:-0}" = 1 ] && echo "   (3c already put a rebuilt Kosmos.pkg triple in $SITE/dist; a site deploy before the next cut would carry it; verify-served.sh is the check that applies)"
  exit 1
fi
# #1548: this overwrites the served unversioned pointer. Back the pre-cut copy up
# FIRST -- under BUILD_ROOT, NOT beside the served file -- so an abort before step 8
# restores it (release_site_restore) instead of leaving the abandoned build for the
# next deploy to publish against the stale committed latest.json, exactly how 0.6.06
# shipped mislabelled (#1565). The backup lives under BUILD_ROOT, which the EXIT trap
# removes on every path, so it never sits untracked in the SHARED site checkout where
# a stray `git add -A` by another agent could stage it into a deploy.
mkdir -p "$BUILD_ROOT/precut"
for _u in kosmos-arm64.tar.gz kosmos-arm64.tar.gz.sha256; do
  [ -f "$SITE/dist/$_u" ] && cp -p "$SITE/dist/$_u" "$BUILD_ROOT/precut/$_u"
done
cp "$REPO/dist/kosmos-arm64.tar.gz" "$REPO/dist/kosmos-arm64.tar.gz.sha256" "$SITE/dist/"
# The release manifest (#776) rides beside the versioned tarball, TRACKED: a
# few KB per release that says what produced the served bytes. The tarballs
# themselves stay untracked (48 MB each, and they prove only that bytes existed).
cp "$REPO/dist/kosmos-arm64.manifest.json" "$SITE/dist/kosmos-$V-arm64.manifest.json"
# ⚠️ THE VERSIONED NAME IS THE ONE A CACHE CANNOT LIE ABOUT. The plain
# name is one URL across every release, and an edge cache satisfied an
# update from it with the PRIOR release's bytes and matching checksum
# (Josh's machine, 2026-08-24). The installer prefers this name; the
# plain pair stays for installers older than this change.
# 🛑 A VERSIONED NAME IS A PROMISE OF IMMUTABILITY. Republishing the
# same version with different bytes recreates the incident one level
# up: an edge cache holding the first attempt serves an internally
# consistent old pair that passes every new guard. Bump instead.
if [ -f "$SITE/dist/kosmos-$V-arm64.tar.gz" ] && ! cmp -s "$REPO/dist/kosmos-arm64.tar.gz" "$SITE/dist/kosmos-$V-arm64.tar.gz"; then
  echo "refusing to republish $V with different bytes (the versioned name is cache-immutable); bump the version"; exit 1
fi
cp "$REPO/dist/kosmos-arm64.tar.gz" "$SITE/dist/kosmos-$V-arm64.tar.gz"
# The versioned .sha256 NAMES THE VERSIONED FILE (#930): a copy of the build's
# checksum carried the build-local name, so `shasum -c` on the served pair
# failed on good bytes for 35 releases. sha256_publish_as rewrites the name
# and proves the pair with shasum -c in place; a pair that cannot verify
# itself is a refusal, not a publish.
. "$(dirname "${BASH_SOURCE[0]}")/lib/sha256-name.sh"
sha256_publish_as "$REPO/dist/kosmos-arm64.tar.gz.sha256" "$SITE/dist/kosmos-$V-arm64.tar.gz.sha256" || exit 1
(cd "$SITE/dist" && shasum -a 256 --status -c kosmos-arm64.tar.gz.sha256) || { echo "the plain pair in $SITE/dist does not verify with shasum -c" >&2; exit 1; }
echo "   kosmos-$V-arm64.tar.gz.sha256 names its file and verifies in place (shasum -c)"
node -e "require('node:fs').writeFileSync('$SITE/dist/latest.json', JSON.stringify({version:'$V'})+'\n')"
echo "   latest.json -> $(cat "$SITE/dist/latest.json")"

# 🛑 THE INSTALLER, SERVED FROM THE SITE ROOT AND NOT FROM dist/. Copying the
# bundle does not carry it, and BOTH paths run it: a new install (`curl … /setup
# | sh`) and an existing one updating itself (engine/update.js re-runs
# `setupUrl()`). It was stale on the site by a whole change before this step
# existed, while three correct checks of the bundle passed.
step "== 5. the installer =="
cp "$REPO/dist/setup" "$SITE/setup"
cp "$REPO/dist/setup.sha256" "$SITE/setup.sha256"
diff -q "$SITE/setup" "$REPO/install/setup.sh" >/dev/null || { echo "the emitted installer is not install/setup.sh"; exit 1; }
sh -n "$SITE/setup" || { echo "the installer about to be published does not parse"; exit 1; }
# ⚠️ #1666: AND THE CHECKSUM MUST DESCRIBE THE INSTALLER BESIDE IT. The line
# above proves `setup` IS install/setup.sh. Nothing proved `setup.sha256`
# describes `setup`, and the two are copied from `dist/` independently, so a
# stale sidecar ships silently. Measured: a hand-sync of the installer at
# 2026-08-30 21:30 (the #1629 trust-mark pickup) left the checksum from the
# 10:28 cut, and production served an installer whose published checksum was
# a whole release behind.
#
# ⭐ IT PUNISHES EXACTLY THE CAUTIOUS USER. Anyone who does the careful thing
# and verifies before piping to a shell gets a mismatch, and the natural
# reading of that mismatch is "this download was tampered with". Everyone who
# pipes it straight to sh is unaffected, which is why it went unreported.
#
# 🛑 The emptiness checks are load-bearing, but NOT for the reason I first
# wrote here, and the correction is the useful part. An absent or empty
# SIDECAR is already caught by the comparison alone, because the installer
# still hashes to something. What the -n checks actually catch is BOTH files
# missing: this script runs without `set -e`, so a failed `cp` above leaves
# no setup and no sidecar, both sides become the empty string, and a bare
# equality test PASSES on exactly the state the guard exists to refuse.
# Measured, not argued: with the -n checks removed, every other arm of
# release.setup-sha-1666.test.js stays green and only the both-missing arm
# goes red.
_setup_have="$(awk '{print $1}' < "$SITE/setup.sha256" 2>/dev/null)"
_setup_want="$(cd "$SITE" && shasum -a 256 setup 2>/dev/null | awk '{print $1}')"
[ -n "$_setup_want" ] && [ -n "$_setup_have" ] && [ "$_setup_have" = "$_setup_want" ] || {
  echo "setup.sha256 does not describe the installer about to be published"
  echo "  setup.sha256 says : ${_setup_have:-<empty or unreadable>}"
  echo "  setup hashes to   : ${_setup_want:-<empty or unreadable>}"
  exit 1
}
echo "   /setup copied and parses"

step "== 6. what we are about to publish says $V =="
tar -xzOf "$SITE/dist/kosmos-arm64.tar.gz" app/package.json | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const v=JSON.parse(s).version;
  console.log('   bundled version:', v);
  if(v!=='$V'){ console.error('   THE BUNDLE IS NOT $V'); process.exit(1); }
});"

step "== 7. the versions page needs its entry BEFORE you deploy =="
# 🛑 DELIBERATELY NOT RE-SOURCED HERE, AND AN EARLIER VERSION OF THIS BRANCH DID.
# The functions defined at step 1 persist for the life of the script; I confirmed
# it. What the re-source added was harm:
#
#   `$REPO` is reassigned to `$BUILD` above, so a `.` here reads the lib out of
#   the FROZEN WORKTREE, not the tree this script is running from.
#
# ⚠️ (a) This script deliberately permits cutting a tree that is BEHIND origin.
# For any frozen sha predating this commit the lib does not exist there, and a
# failed `source` under `set -euo pipefail` aborts with a bare "No such file or
# directory" -- AFTER the suite, the browser gate, the install gate and the
# build. That is precisely the expensive late failure this whole change exists
# to remove, reintroduced by the fix for it.
# ⚠️ (b) When the shared checkout HAS moved mid-cut, which is the one case the
# freeze exists for, step 1 and step 7 would then run two DIFFERENT definitions
# of this gate and its three bounds. That is the "two copies of a window" shape
# the lib argues against, arrived at by sourcing rather than by copying.
#
# 📌 The comment that used to sit here said the reassignment was the REASON to
# re-source. It is the reason not to. I noticed the right fact and drew the
# opposite conclusion from it.
# ⚠️ Step 1 already ran this gate, and this is NOT a leftover. The site
# checkout can change under a cut that takes fifteen minutes, and a stamp that
# agreed with the clock at step 1 can be twenty minutes stale by the time we
# deploy. Step 1 asks whether the cut can finish; this asks whether the page is
# right at the moment it ships.
#
# 📌 WHY THE STAMP MUST BE THE CLOCK, WHICH USED TO BE WRITTEN OUT HERE AND NOW
# LIVES IN THE LIB. On the night of 2026-08-21 every entry from 0.2.38 to 0.2.57
# was written by adding a plausible gap to the entry above it instead of reading
# a clock, so the error COMPOUNDED: 16 minutes wrong at 0.2.38, 137 minutes at
# 0.2.57, and the four newest claimed release times that had not happened yet.
# A guess cannot satisfy a comparison against `date` at the moment of release,
# which is the one thing an estimate cannot agree with by accident.
#
# ⚠️ Moving the CHECK into tools/lib/versions-entry.sh moved its RATIONALE too,
# and a reader of release.sh was left with a bare call. This paragraph is the
# pointer back. The windows, the asymmetry and the six fail-open instances are
# documented in the lib.
kosmos_versions_entry_gate "$V" "$SITE/versions.html" "The build is done; only the deploy is unspent." \
  "Paste the clock line above into the entry's rel-d and re-run." \
  "$KOSMOS_LATE_PAST_BOUND" || exit 1

step "== 7b. the site's release files are committed and pushed BEFORE they deploy =="
# 🛑 SERVED FROM THE WORKING TREE MEANS SERVED FROM NOBODY'S HISTORY. This
# script committed and pushed $REPO but only COPIED into $SITE, and the deploy
# then shipped the working tree, so eleven releases' installers went live with
# no commit behind them (#568; step 8 now deploys an export of HEAD, so what
# is committed here is what ships): the swap-proof installer that ended the
# 0.5.13 wedge was serving and unrecorded, and the "error line numbers
# match no revision" tell that diagnosed that wedge is confounded while
# the served script matches no revision at all. Named paths only, never
# add -A: the site checkout carries other people's in-progress page work.
[ "$(git -C "$SITE" rev-parse --abbrev-ref HEAD)" = main ] || { echo "the site checkout is not on main"; exit 1; }
# 🛑 PATH-LIMITED AT EVERY STEP, the commit included. `git add <paths>`
# alone was not enough: a plain `git commit` takes the WHOLE index, so
# anything somebody had staged in this shared checkout would have ridden
# the release commit to origin/main unseen (caught in review). The
# `-- <paths>` on the commit leaves other staged work exactly as staged.
# What the push DOES carry: any commits already on this checkout's main
# that were not pushed yet, which the deploy would serve regardless.
_site_paths="dist/latest.json dist/kosmos-$V-arm64.manifest.json setup setup.sha256 versions.html"
# shellcheck disable=SC2086
git -C "$SITE" add $_site_paths
# shellcheck disable=SC2086
if ! git -C "$SITE" diff --quiet HEAD -- $_site_paths; then
  # shellcheck disable=SC2086
  git -C "$SITE" commit -q -m "$V: the served installer, pointer and versions entry" -- $_site_paths
fi
# The sha that deploys is the sha that is PUSHED, read before the push and
# pushed by name: the checkout is shared and a commit can land between a
# push of "HEAD" and the archive (#649).
# ⚠️ ON MAIN, CHECKED HERE and not only at the top of 7b's block: the push
# below names refs/heads/main as its target, so a site checkout left on some
# branch would put that branch's tip (plus this commit) onto main, or be
# rejected with a message that blames the wrong cause.
[ "$(git -C "$SITE" rev-parse --abbrev-ref HEAD)" = main ] || { echo "the site checkout is on '$(git -C "$SITE" rev-parse --abbrev-ref HEAD)', not main; refusing to push its tip onto origin/main"; exit 1; }
SITE_SHA="$(git -C "$SITE" rev-parse HEAD)"
git -C "$SITE" push -q origin "$SITE_SHA:refs/heads/main" || {
  echo "could not push the site (origin/main moved, or no network). The $V site commit is local."
  echo "Recover: git -C \"$SITE\" pull --rebase && git -C \"$SITE\" push, then re-run release.sh; expect to bump the version, because the bundle build is not byte-reproducible and the versioned name refuses different bytes."
  exit 1
}
# shellcheck disable=SC2086
[ -z "$(git -C "$SITE" status --porcelain -- $_site_paths)" ] || { echo "release files still dirty after the commit"; exit 1; }
echo "   site committed and pushed: $(git -C "$SITE" log --oneline -1 "$SITE_SHA")"

step "== 8. deploy, from an export of the COMMITTED site plus the named artifacts (#649) =="
# 🛑 NEVER THE WORKING TREE. This deployed $SITE itself, so a cut published
# whatever anybody had uncommitted in the shared checkout (a half-edited
# homepage twice during the 0.5.22 cut, caught by hand), and the gitignored
# release artifacts reached production only through that accident. The
# export is `git archive` of the sha 7b pushed (the pages as committed)
# plus each artifact class by name (tools/lib/site-deploy.sh says which and
# why), and it prints what the working tree holds that does NOT ship. It
# lives under BUILD_ROOT so the 2b trap removes it.
# ⚠️ The export has no .git, so the Vercel dashboard shows no commit for these
# deploys (the CLI reads <cwd>/.git for that); the manifest's "pages: commit"
# line below is the link from a deployment to its commit.
. "$REPO/tools/lib/site-deploy.sh"
_site_export="$BUILD_ROOT/site-export"
site_deploy_export "$SITE" "$_site_export" "$SITE_SHA" || { echo "could not export the site for deploy; nothing was deployed"; exit 1; }
# The filter that ACTUALLY ships is the export's; 3c read HEAD's early, and
# the sha can have moved since. Same evaluator, same refusal, on the real file.
set +e; _dep_dropped="$(pkg_upload_filter_excludes "$_site_export/.vercelignore")"; _dep_frc=$?; set -e
if [ "$_dep_frc" = 1 ]; then echo "the export has no .vercelignore; nothing was deployed"; exit 1
elif [ "$_dep_frc" != 0 ]; then echo "could not evaluate the export's .vercelignore (rc=$_dep_frc); nothing was deployed"; exit 1
elif [ -n "$_dep_dropped" ]; then echo "the export's .vercelignore would drop $_dep_dropped; nothing was deployed"; exit 1
fi
( cd "$_site_export" && vercel deploy --prod --yes )

DEPLOYED=1   # step 8 finished: the site checkout now claims what is served, so the trap leaves it
# #1548: the pre-cut pointer backup lives under BUILD_ROOT, which the EXIT trap removes
# on every path, so there is nothing to clean up in the site checkout here. (On a
# failure before this line, the trap's release_site_restore reads it first.)
step "== 9. verify what is SERVED, from the code that fetches it =="
# ⚠️ Retried, because a deploy is live before every edge has it, and a single
# read cannot tell "not published" from "not yet".
SERVED_OK=0
for i in 1 2 3 4 5 6; do
  if SITE="$SITE" REPO="$REPO" bash "$REPO/tools/verify-served.sh"; then SERVED_OK=1; break; fi
  echo "   (attempt $i did not match; waiting)"
  sleep 10
done
if [ "$SERVED_OK" != 1 ]; then
  echo "SOMETHING A USER RECEIVES IS STILL WRONG AFTER SIX READS"
  exit 1
fi

step "== 9b. the served bundle is the frozen tree, file by file (#597) =="
# The log's "built <sha>" is measured here rather than remembered: every
# tree-derived file in the versioned tarball people download (app/ and the
# top-level bin/kosmos) equals the frozen tree, web/index.html after the one
# substitution the build makes.
# ⚠️ RETRIED like step 9, and for the same reason: step 9 hit one edge; the
# edge THIS fetch lands on can still be a beat behind, and a single try would
# raise "not the tree that was tested" as a false alarm on cache lag rather
# than a real mismatch. Six reads, then it is real.
_served_tgz="$(mktemp)"
_bundle_ok=0
for i in 1 2 3 4 5 6; do
  if curl -fsSL -m 120 "${HOST:-https://installkosmos.com}/dist/kosmos-$V-arm64.tar.gz" -o "$_served_tgz" \
     && release_bundle_matches_tree "$_served_tgz" "$BUILD" "$TUNNEL_SHA" "$NATIVE_APP_SHA"; then _bundle_ok=1; break; fi
  echo "   (attempt $i did not match the frozen tree; waiting)"
  sleep 10
done
rm -f "$_served_tgz"
if [ "$_bundle_ok" = 1 ]; then
  echo "   the served kosmos-$V-arm64.tar.gz is ${SHA:0:12}: every tree file (app/ and bin/kosmos) matches, the connector is ${TUNNEL_SHA:0:12}, and the native app is ${NATIVE_APP_SHA:0:12}"
else
  echo "THE SERVED BUNDLE IS NOT THE TREE THAT WAS TESTED (${SHA:0:12}) AFTER SIX READS"; exit 1
fi

step "== 9c. the served installer .pkg is the one step 3c left in the site dist (#638, B guard) =="
# Step 3c decided from the site's working copy; this reads the SERVED host,
# because the deploy carries the pkg by name from an export (step 8) and an
# edge can serve the prior pair (Kosmos.pkg and its .sha256 share one cache).
# Four facts, all from the wire, and the red names the one that failed: the
# served inputs sidecar is the source's, the served pkg's bytes are the served
# checksum's, the sidecar vouches for those bytes, and those bytes are the
# site dist's. Retried like 9 and 9b: cache lag is not staleness until six
# reads agree. ⚠️ NO BARE `x="$(curl ...)"` CAPTURES: under set -e a 404 on
# the first read (a path that has never existed on the edge, exactly this
# step's first run) would kill the script before the loop retried, and the
# six-read message would never print. Every fetch lands in a file inside the
# if chain, the same shape as step 4's tar guard and step 9b. The temp dir
# lives under BUILD_ROOT so the EXIT trap from 2b removes it on an errexit
# inside the loop.
_pkg_ok=0; _pkg_dir="$(mktemp -d "$BUILD_ROOT/pkg9c.XXXXXX")"; _pkg_fact=""
for i in 1 2 3 4 5 6; do
  _pkg_fact="the served inputs sidecar could not be fetched"
  if curl -fsSL -m 30 -H 'Cache-Control: no-cache' "${HOST:-https://installkosmos.com}/dist/Kosmos.pkg.inputs" -o "$_pkg_dir/inputs"; then
    _pkg_fact="the served inputs ($(pkg_sidecar_inputs "$_pkg_dir/inputs" | cut -c1-12)) are not the source's (${_pkg_want:0:12})"
    if [ "$(pkg_sidecar_inputs "$_pkg_dir/inputs")" = "$_pkg_want" ]; then
      _pkg_fact="the served Kosmos.pkg or its .sha256 could not be fetched"
      if curl -fsSL -m 120 "${HOST:-https://installkosmos.com}/dist/Kosmos.pkg" -o "$_pkg_dir/Kosmos.pkg" \
         && curl -fsSL -m 30 "${HOST:-https://installkosmos.com}/dist/Kosmos.pkg.sha256" -o "$_pkg_dir/sha256"; then
        _pkg_real="$(_pkg_hash < "$_pkg_dir/Kosmos.pkg" | awk '{print $1}')"
        _pkg_fact="the served Kosmos.pkg's bytes (${_pkg_real:0:12}) are not its served checksum's ($(awk '{print substr($1,1,12)}' "$_pkg_dir/sha256"))"
        if [ "$_pkg_real" = "$(awk '{print $1}' "$_pkg_dir/sha256")" ]; then
          _pkg_fact="the served sidecar vouches for other bytes ($(pkg_sidecar_pkgsha "$_pkg_dir/inputs" | cut -c1-12)) than the served pkg's (${_pkg_real:0:12})"
          if [ "$(pkg_sidecar_pkgsha "$_pkg_dir/inputs")" = "$_pkg_real" ]; then
            _pkg_fact="the served Kosmos.pkg is not the one the export deployed (an edge is holding the prior pair)"
            # Against the EXPORT's copy (the file that deployed; a real copy
            # under BUILD_ROOT, not a link), not the shared working tree, which
            # can be replaced in place during the ten-minute wait.
            if cmp -s "$_pkg_dir/Kosmos.pkg" "$_site_export/dist/Kosmos.pkg"; then _pkg_ok=1; break; fi
          fi
        fi
      fi
    fi
  fi
  echo "   (attempt $i: $_pkg_fact; waiting)"
  sleep 10
done
rm -rf "$_pkg_dir"
if [ "$_pkg_ok" = 1 ]; then
  if [ "${PKG_PUBLISHED:-0}" = 1 ]; then echo "   the served Kosmos.pkg is the one published in 3c: inputs ${_pkg_want:0:12}, checksum agrees, sidecar vouches for these bytes"
  else echo "   the served Kosmos.pkg is current: inputs ${_pkg_want:0:12} match source, checksum agrees, sidecar vouches for these bytes"; fi
else
  if [ "${PKG_PUBLISHED:-0}" = 1 ]; then echo "THE SERVED INSTALLER PKG IS NOT THE ONE 3c PUBLISHED, AFTER SIX READS: $_pkg_fact."
  else echo "THE SERVED INSTALLER PKG IS NOT THE SITE DIST'S (nothing was rebuilt this cut), AFTER SIX READS: $_pkg_fact."; fi
  echo "   Either the deploy did not carry dist/Kosmos.pkg* or an edge is holding the prior pair."; exit 1
fi

step "== 9d. the served manifest answers for the served bytes (#776) =="
# The manifest the build wrote (step 4) was committed beside the pointer (7b)
# and deployed (8); this reads BOTH back from the wire and checks the
# artifact's sha and every file's sha against it. Not a volunteer's check
# after the fact: a cut is not done until the served bytes are the ones the
# build recorded. Small cuts, many times a day (Josh, 2026-08-25), is exactly
# when a check that depends on someone being awake stops happening.
if ! bash "$REPO/tools/verify-manifest.sh" "$V"; then
  echo "THE SERVED MANIFEST DOES NOT ANSWER FOR THE SERVED BYTES. The pointer is live; what it points at is not what the build recorded. Do not announce this cut; read the mismatch above."
  exit 1
fi

step "== 9e. the served artifact, audited from OUTSIDE the build (Splinter's check, owned by the cut since 2026-08-26) =="
# Every check above ran inside the build or read back what the build recorded.
# #927 is what that blind spot costs: a dead Applications icon shipped for
# eighteen releases because the build's own selftest ran on a macOS 26 host
# and could not see a macOS 26 floor. This fetches the SERVED pointer, tarball
# and installer and asks the bytes: floor on every Mach-O it finds (discovers,
# never enumerates), signatures, the .sha256's name, /setup against the site,
# known-prefix credentials, with its own controls. 0.5.47 through 0.5.60
# shipped with nobody running it; a step nobody has to remember is the fix.
# It runs AFTER the flip, against what is served, never the staged tree; a red
# here leaves the pointer live and the record line reads served=1 exit=1,
# which is the honest state: served, and failed the outside audit.
# --repo is the SHARED checkout (MAIN_REPO), not the frozen build tree: the
# check compares served /setup against ../chaoskosmos-site beside the repo,
# and the build tree has no site beside it. 0.5.65's 9e reported that check
# UNPROVEN and failed the cut on a sound artifact for exactly this reason.
if ! bash "$REPO/tools/kosmos-artifact-check.sh" --repo "$MAIN_REPO"; then
  echo "THE SERVED ARTIFACT FAILED THE OUTSIDE AUDIT (the lines above say which check). The pointer is live. Do not announce this cut as verified; read the red, and bump rather than republish if bytes must change."
  exit 1
fi

step "== 10. the board on THIS Mac, if it runs from this repo =="
# 🛑 Installs update themselves from what step 9 verified; the developer's own
# board runs the repo under launchd and never did, so every release left it
# serving the previous code until somebody noticed (#360). Gated on the job
# existing AND running from this repo; it says which case it found.
bash "$MAIN_REPO/tools/restart-local-board.sh"
