# agent-create-preflight-1185 — pre-flight tmux on adoption + capitalize the "not made" cause

Card: kosmos#1185 ("Agent creation runs four steps before failing on a precondition it
already knew, and never names the cause").

## Where the card stands (measured against current main)

The card's original scenario ("Ben was not made", opaque "could not start it") was
filed 2026-08-28. Since then the **creation** pre-flight was rebuilt by #1616/#548/#979:
`createAgent` now checks the runner AND tmux are runnable *before* doing any work
(`engine/create.js` ~2984 loop), names the cause, and routes to the remedy (Connect a
Claude account, or create on OpenAI). So the card's points 1 and 2 are already handled
for creation. Two residuals remained; this branch closes them.

## Change 1 — adoption (`installJob`) tmux pre-flight symmetry

`installJob` (adoption) checked `runnerRunnable(runnerBin)` but only `unusablePath(tmuxBin)`
(injection chars, not existence). A missing tmux therefore wrote a plist naming an absent
binary, `launchctl bootstrap` failed, and the adoption reported the opaque "could not
start it just now" with no cause. Added `runnerRunnable(tmuxBin)` right after the runner
check, refusing before the plist is written, with a named cause in installJob's own voice
(not the word "tmux", per the 2115 rationale). This does not regress the deliberate "THE
JOB STAYS EITHER WAY" behaviour — that governs a bootstrap *failure* after the plist is
written, not a known-absent binary before it.

## Change 2 — capitalize the cause sentence on the "not made" screen

The partial-outcome screen renders the engine `because` right after "… was not made." and
the bolded "Nothing was made.", but every partial `because` starts lowercase (they are
also spoken mid-sentence elsewhere). All three partial returns hit this render, so the fix
is at the render site (`web/index.html`, both the `made-say` a11y live region and the
visible `made-warn`): capitalize the first letter for this screen only, idempotent — the
class fix rather than one string.

## Decisions / rejected

- Rejected capitalizing the single string the card named (`create.js:3610`): three partial
  returns produce four lowercase `because` variants, all reaching this render, so a
  one-string fix would leave the others lowercase. The render-site fix covers all present
  and future partial messages.
- The `web/` change carries a `Browser-check:` trailer: no existing browser-check drives a
  partial outcome, and a new one is disproportionate for an idempotent first-letter
  capitalization; verified by reasoning + the create unit tests.

## Tests

`engine/create.runner-dir-1616.test.js` — an `installJob` tmux-path arm: a directory /
stripped file at the tmux path is refused before the plist is written (asserted), with the
correct cause sentence and a real-tmux control reaching `ok:true`.
