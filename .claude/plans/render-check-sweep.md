# render-check-sweep - clear the 0.6.55 3b render-check backlog

Routed by Baron Draxum (render-check owner = me): 3b (the headless render checks)
aborts the 0.6.55 cut, and because the cut had been dying at step 3 for a while (no
CI on this repo, #835), render-check regressions may have landed on main uncaught.
The cut aborts at the FIRST failing check, so it can only reveal them one per cut.
The ask: sweep the FULL suite and fix every real failure in one PR.

## What the sweep found

Ran `tools/browser-checks.sh` (~150 headless checks) against current main.

**Real regression (1):** render-detail-header-1841 Part 2. It asserted the old idle
line `/say 'hello' to Beatrix to wake them/`, but autohello (#2686, PR #2719, merged)
now auto-sends the hello on restart and changed the copy to "Restarting re-reads the
changes and wakes <name>." (web/index.html instr-restart-note). The copy change is
INTENDED, so the CHECK is stale.

**Contention flakes (not real), on a loaded box (~10):**
- regress-a-night: its accounts arm clicks the accounts nav then waits a FIXED 200ms
  for `.acct-box` to render, which starves under load (`- retrying click action`,
  "failed once, retrying flaky-timeout guard"). Baron's clean cut passes it.
- render-role-limit: passed on the harness's own retry.
- assorted `page.click Timeout 30000ms`: classic contention.

These are NOT fixed here - they are not real, and fixing a 200ms wait is a separate
flake-hardening concern, not a 3b blocker (Baron's clean cut is green on them).

## Fix

`docs/browser-checks/render-detail-header-1841.js:192`: update the assertion regex to
`/Restarting re-reads the changes and wakes Beatrix/` and reword the message to name
autohello #2686. The sibling arm (`!/\bit\b/`, no "it" for the agent) still passes,
and the intent (the note names the agent) is preserved.

## Decision (mine, per the Kosmos night-shift ruling)

Update the CHECK, not revert the copy. autohello is a shipped feature; its copy is
intended. I do not revert a shipped feature's copy to satisfy a stale check.

## Files

- `docs/browser-checks/render-detail-header-1841.js` - one assertion.

## Verification

Ran the hermetic check standalone (it loads web/index.html over file://, no server):
exit 0, all Part 2 arms green including the updated assertion and the no-"it" sibling.

## Not in scope

Hardening regress-a-night's 200ms wait against contention (a real but separate
flake-robustness issue; it is green on a normally-loaded cut box). The other ~150
checks passed.

## Weakest premise

That regress-a-night and render-role-limit are contention-only and not masking a real
regression. Supported by: their failures are timing symptoms (fixed-wait starvation,
retry-passes), and Baron's independent clean cut flagged only render-detail-header-1841.
