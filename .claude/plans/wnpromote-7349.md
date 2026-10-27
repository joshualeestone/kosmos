# wnpromote-7349: the What's New pool, checked before the cut claims the machine (kosmos#7349)

## Why
A Mac prod promote leaves `release/whats-new-pool.json` behind what prod serves until someone runs
`whats-new-pool.js build` again (#5713). The next cut found that at step 1b-ii, after it had marked itself, claimed the
machine and (possibly) waited up to 100 minutes on a pre-push build. On 2026-10-27 the 0.7.71 re-cut stopped there with
the fleet held.

## The change (card option 3)
1. `tools/release.sh`: step 1b-ii's two checks (whats-new-check for $V, then pool prod-check) become one function,
   `whats_new_gate`. It runs once right after `pointer_freeze_refuse`, before `kosmos_mark_run`, the machine claim and
   the waits, quietly (stdout dropped), refusing with a line that names the build to run. 1b-ii still runs it (the
   checkout can move during the waits). Exit 4 (prod unreadable) goes on, noted only at 1b-ii. The hotfix opt-out
   `KOSMOS_CUT_NO_WHATS_NEW=1` skips both.
2. `tools/promote-channel.sh`: a Mac prod promote ends by naming the build to run once its deploy serves.
3. `docs/releasing.md`: run `prod-check` yourself before holding merges for a cut.

## Rejected
- Printing an exact next version in the promote hint: the next cut's version is not the promoted patch plus one
  (0.7.70 was promoted while 0.7.71 was being cut), so a computed number would often be wrong.
- Having promote-channel.sh run the build itself: the build reads what prod SERVES, which changes only at the deploy
  after the promote, and it writes files that must go through a PR.
- Moving 1b-ii wholesale before the claim: the checkout can move during the waits, so the check at 1b-ii stays.

## Proof plan
`tools/test-whats-new-early-7349.sh` runs a copy of release.sh with stand-in tools that record how many run markers
exist when they are called: pool behind prod, highlights not for $V, a broken tool all stop with no marker and no cut
home; CONTROL a current pool goes on; exit 4 goes on with no early NOTE; the opt-out runs neither tool; 1b-ii and the
promote hint pinned structurally. Mutation list in the commit history of this plan's rounds.
`test-pointer-freeze.sh`'s release arm sets the opt-out (its sandbox has no What's New tools).
`tools.whats-new-check-3955.test.js` pins follow the call into `whats_new_gate`.

## Weakest premise
The hold itself is sent by a person before release.sh runs, so (2) moves the discovery before the machine claim and the
waits, not before the hold. The docs line and the promote hint are what reach the person; nothing enforces them.

## Review rounds
1. (default, 10:0x CDT) 1 BLOCKER, 1 WARNING, 3 NITs, all applied.
   - (B) tools.cut-home-2724.test.js also runs a copied release.sh with no What's New tools: 8 of 11 red. It now sets
     KOSMOS_CUT_NO_WHATS_NEW=1 (mutation-proven: without it, 8 fail). My own sweep had found only test-pointer-freeze.sh
     because I searched shell tests for a sandboxed release.sh and not the node tests.
   - (W) A direct prod cut moves prod too and never named the build; it now does, in its final prod block (pinned).
   - NITs: the early quiet run keeps prod-check's reason for a 4 to itself (a 3's reason still shows; both arms
     mutation-proven); the refusal says to fast-forward when the build is already on origin/main; the docs say where
     the check runs (not "at its very start") and what every prod-check exit means.
2. (sonnet, 10:3x CDT) 0 BLOCKERs, 2 WARNINGs, 2 NITs; all actionable ones applied.
   - (W) tools.release-gate.test.js's "#3955/#5713 ... stops the cut at 1b-ii" arms now stop at the early check, so
     deleting 1b-ii's refusal stayed green. They are retitled and assert the early stop; a new #7349 arm moves prod on
     between the two reads (a stand-in curl for the prod pointer's URL only, every other URL to the real curl) and the
     cut stops AT 1b-ii. Mutation-proven: 1b-ii's `|| exit 1` made `|| true` reaches step 1c and reds it.
   - (W) The early refusal's pool-build advice is said for a stale pool only, with "otherwise fix what it names".
   - NIT: whats-new-check can print a note on stderr when it passes; the early run keeps it (the check now sits behind
     _whats_new_check, like prod-check). The #3955 pins follow: the helper's exact command, both branches refuse on it,
     and the #5224 platform pin reads a call inside a one-line function. Both new arms mutation-proven.
   - NIT 2 (the reviewer verified the marker-count control can fail): nothing to change.
