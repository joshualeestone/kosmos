# bc-ci-allowlist-b7-835 - expand the per-PR browser-checks CI allowlist (batch 7)

## Source
#835 (cut-efficiency). Batch 7 of the incremental KOSMOS_BC_CI_ALLOWLIST expansion in
browser-checks.yml, so a break in more render checks fails at the PR, not at the cut.
Follows merged batches 1-6 (#2747, #2753, #2764, #2765, #2768, #2772). Allowlist at 29 before this.

## The mechanism (unchanged)
KOSMOS_BC_CI_ALLOWLIST is a FILTER over checks the driver already invokes; all three added
here are in browser-checks.sh's no-board/no-arg loop, so this is a names-only change.
Self-validating: this PR edits browser-checks.yml (in the job's own path filter), so the
expanded set runs on the runner in THIS PR's CI, and the driver's never-ran guard hard-reds a
misspelled/never-running name. A wrong pick reds this PR before merge.

## Candidate selection - fragile-signal grep + mechanism check
Each candidate was grepped for fragile signals (getBoundingClientRect / boundingBox /
screenshot / requestAnimationFrame / scrollIntoView / .scroll / getComputedStyle); only
0-signal candidates in the no-board/no-arg loop were taken. Each was then checked for its
mechanism (file:// vs sandboxed spawn-server) and its waitForTimeout count, so the plan is
accurate up front (batch 6 taught that some 0-signal checks boot a sandboxed server).
render-firstrun-wizard-flow was 0-signal + in-loop but DEFERRED this batch: it carries 6
waitForTimeout settles (higher CI-time and a larger timing surface on the contended runner);
revisit in a later batch.

## Change
Add three verified checks (0 fragile signals; mechanism noted):
- **render-worldrename-1704** - world rename flow. file:// (fetch stubbed), 0 waitForTimeout.
  Pure DOM/text state.
- **render-firstrun-import-1652** - first-run import behaviour. BOOTS its own sandboxed server
  (spawn node server.js, mkdtemp AGENT_WORKFORCE_* roots, fake-tmux), 0 waitForTimeout. Reads
  DOM/text/row state.
- **render-reactions-2255** - message reactions rendering. BOOTS its own sandboxed server, 1
  waitForTimeout settle. Reads DOM/text state.

None asserts geometry/computed-color/screenshot/animation/scroll. Mutation-safe: worldrename is
file:// with fetch stubbed; firstrun-import and reactions boot sandboxed temp-rooted servers
(mkdtemp roots frozen before require, fake-tmux) - the established no-board-loop pattern; none
touches the operator's real board/data.

## Verification
- This PR's own browser-checks CI runs the expanded allowlist on the runner. GREEN means all
  three run and pass headless; a RED naming one means drop it (with the driver's reason) and
  re-push. Merge only on green.
- Node unit suite unaffected (yaml-only change); test.yml stays green.

## Weakest premise
That all three run green headless on the runner. The fragile-signal grep + mechanism check are
strong lexical filters but not proofs; this PR's own CI is the definitive backstop - a wrong
pick reds this PR before merge and I drop that name, so a miss costs an iteration, never a bad
merge.
