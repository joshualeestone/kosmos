# Plan: fix render-firstrun-wizard-flow NOT-GRANTED arm for the #3112 reorder

The 6.69 reorder (#3112) moved Model to display position 2. The cut-time browser-check
`render-firstrun-wizard-flow.js` NOT-GRANTED arm clicked Next ONCE from Welcome expecting the
file-access gate (pane 2), but now lands on Model (pane 5) -> "step=5 nextDisabled=false" RED at
the staging cut (stage 3b). Third stale first-run check the reorder made (siblings:
render-win32-board-copy, click-first-run, both already fixed).

Why PR CI missed it: this check is NOT in the PR CI allowlist (.github/workflows/browser-checks.yml)
-- it is cut-time-only. Confirmed for Baron.

## Done-condition
- The NOT-GRANTED arm reaches the file-access gate (pane 2) regardless of the reorder and asserts
  it disables Next (the S2 blocking is re-verified post-reorder).
- Works on a clean/not-connected machine (Model hides #fr-next -> the walk takes the #fr-alt Skip).
- The GRANTED arm is unchanged (it already walks by content, reorder-robust).
- render-firstrun-wizard-flow PASSES (both arms).

## Approach (chosen)
Walk the NOT-GRANTED arm forward by CONTENT to pane 2: loop reads FR_STEP, breaks at 2, else clicks
the first usable forward control (fr-next, else fr-alt), waiting for FR_STEP to change. Same robust
pattern the GRANTED arm uses. Break happens BEFORE the clickable-check each iteration, so once pane 2
shows the loop stops without clicking the gate.

## Rejected
- Hardcode "advance twice": brittle if the display order changes again; content-walk is order-robust.

## Weakest premise
That the file-access gate (pane 2) exposes no forward #fr-alt that the loop could click past. Mitigated:
the loop breaks at FR_STEP===2 at the TOP of the iteration, before evaluating clickable, so it stops
at pane 2 before any click. Verified locally: the NOT-GRANTED arm reaches pane 2 and the gate blocks.

## Verification
- Local (pinned Playwright, headless, KOSMOS_BC_CI_ALLOWLIST=render-firstrun-wizard-flow): PASSES,
  both GRANTED and NOT-GRANTED arms. Fresh not-connected sandbox -> exercised the clean #fr-alt path.
- Note: this check is cut-time-only, so PR CI green will NOT cover it -- verified locally instead.
- Challenge-loop to convergence.
