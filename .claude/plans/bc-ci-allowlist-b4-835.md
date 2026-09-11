# bc-ci-allowlist-b4-835 - expand the per-PR browser-checks CI allowlist (batch 4)

## Source
#835 (cut-efficiency). Batch 4 of the incremental KOSMOS_BC_CI_ALLOWLIST expansion in
browser-checks.yml, so a break in more render checks fails at the PR, not at the cut.
Follows merged batches 1 (#2747), 2 (#2753), 3 (#2764).

## The mechanism (unchanged)
KOSMOS_BC_CI_ALLOWLIST is a FILTER over checks the driver already invokes; all four added
here are in browser-checks.sh's no-board/no-arg loop, so this is a names-only change.
Self-validating: this PR edits browser-checks.yml (in the job's own path filter), so the
expanded set runs on the runner in THIS PR's CI, and the driver's never-ran guard hard-reds a
misspelled/never-running name. A wrong pick reds this PR before merge.

## Change
Add four verified DOM-state candidates. Read each header + grepped each for its mechanism;
descriptions below are accurate to the code (server-boot vs file://, what is asserted):
- **render-model-change** - the Model section's three chained menus; a confirmed change
  reports its cost + outcome in the dialog. BOOTS a sandboxed in-process server
  (srv.start(0) + an OpenAI stub on a random port, AGENT_WORKFORCE_DATA = mkdtemp) - not
  pure file://; reads menu/dialog DOM + text state. No geometry/exact-color.
- **render-url-state** - an agent page / project / task view survives a refresh (#374).
  BOOTS a sandboxed in-process server (srv.start(0), mkdtemp root); reads navigation/DOM
  state after reload. No geometry/exact-color.
- **render-trust-restart-0644** - the View-Agent Terminal "Trust & Restart" button and its
  `because`/`error` message on a stubbed 200/400/500. file://, window.fetch stubbed in-page
  (no request leaves the page); reads hidden/button/message DOM + text. No geometry/color.
- **render-restore-dircheck-2615** - the removed-list Restore control is DISABLED when the
  account folder is gone. file://, window.fetch stubbed; reads the `disabled` control + the
  `#removed-list` hidden/open state. Pure disabled/hidden DOM state.

All four: DOM/text/disabled/menu/navigation state only - no exact-pixel geometry, width-band,
below-the-fold, screenshot, animation-completion, or exact cross-element color. Mutation-safe:
two boot sandboxed in-process servers (mkdtemp AGENT_WORKFORCE_* roots, random port), two are
file:// with window.fetch stubbed - none touch a live board.

## Excluded while shortlisting this batch
- render-restarting-2019 - renders the restarting state with an ANIMATED Kosmos K; animation
  is the headless-fragile class, left out conservatively.
- render-build-marker-2066 - asserts the build marker's channel "by WEIGHT" (small dim vs
  loud coloured STAGING badge): a computed font-weight + color comparison, closest to the
  fragile computed-style class.

## Verification
- This PR's own browser-checks CI runs the expanded allowlist on the runner. GREEN means all
  four run and pass headless; a RED naming one means drop it (with the driver's reason) and
  re-push. Merge only on green.
- Node unit suite unaffected (yaml-only change); test.yml stays green.

## Weakest premise
That all four run green headless on the runner. If one does not, this PR's own CI catches it
before merge and I drop that name - self-validating, so a wrong pick costs an iteration, never
a bad merge. The two server-booting checks (model-change, url-state) depend on their sandboxed
server starting on a random port under the runner's load; they already run this way at the cut,
and the CI isolation removes the cross-agent contention that would be the only added risk.
