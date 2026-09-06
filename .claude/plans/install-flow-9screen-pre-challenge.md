---
pre_challenge: true
method: challenge-loop
branch: install-flow-9screen
diff_hash: 3ad82895b02e5a60abd3b5dbbb7edfccfb71f1f0007c6f1625be25704ae86c91
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T04:47:13Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (round 2 confirmed the round-1 fixes correct and found no new actionable defect)
**Method:** fresh blind CTO-lens reviewers, each spawned without the authoring agent's context.

install-flow-9screen reworks the first-run install wizard from 6 to 9 screens (Josh's
signed-off 2026-09-05 flow) and rewrites its browser-checks. This proof covers the full
branch (19 commits) as rebased onto settled origin/main.

### Round 1 (blind, all 7 focus areas)

**[BLOCKER] The S2 "Allow Access" button was dead.** web/index.html rendered the gold
primary "Allow Access" button on the launch-critical first permission screen (pane-2)
with NO click handler and no backend route — a labelled primary action that did nothing,
while S3's sibling "Turn On" buttons were wired to open System Settings. FIXED: new
engine `machine.openFileAccessSettings` (reuses the a11y Privacy-pane probe, swaps the
anchor to `Privacy_FilesAndFolders`, derives the URL so a caller cannot open arbitrary
URLs) + `/api/open-file-access-settings` (POST, mirrors open-accessibility-settings) + a
delegated `#fr-pane-2` handler on `.s2-allow` posting it, failures in a new `#fr-s2-msg`
line. +5 engine tests (opens with the Files & Folders anchor, refuses honestly with no
pane, says so when open fails, URL is derived, the button is present AND wired).

**[NIT] Dead fixtures executing at load.** render-first-run.js kept MACHINE_CLEAR /
MACHINE_MIXED (and LAPTOP_PMSET) — IIFEs with control-throws, unused after the machine-
check shots were retired, able to red the whole check if the engine drifted. REMOVED
(CLEAR_INPUTS + appFixture + MACHINE_APP_* kept — still used by the success shots).

**[NIT] Dead variable.** web/index.html `let FR_MACHINE = null;` — its only writer
(frPaintMachine) and reader (the fleet-fork snag-hedge) were removed. REMOVED.

**[NIT] Stale doc examples.** lib-firstrun-steps.js docstring said `#fr-fleet -> 7` /
`#fr-you -> 6` and referenced the retired `fr-pane-intro`. UPDATED (9 / 8 / retired).

Round 1 verified CLEAN (with evidence): the gated-Next contract (fail-safe, positive-only,
generation guard sound, 2<->3 transition correct); the hybrid head / FR_ACTIVE_H2 (no
null deref, pane-9's static #fr-fleet-title never clobbered, aria-labelledby always a
present h2); the fleet fork heading (every branch sets #fr-fleet-title before focus, no
default leak); the browser-checks' content anchors in the right renumbered panes; the 4
retirements fully unwired (runner loops, README, NOT_WIRED, KNOWN_STALE, reason-grep
count); the rebase resolution (machine.test.js keeps both blocks, browser-checks.sh keeps
main's goldbox and drops preflight, no merge artifact); and no executable orphaned
reference to any removed id/function.

### Round 2 (convergence)

CONVERGED — round 2 verified the S2 wiring correct (URL derived not caller-supplied,
endpoint mirrors the a11y one, handler keyed on .s2-allow -> the right endpoint, #fr-s2-msg
present), the dead-code removals clean (no dangling reference, the still-used fixtures
intact), and re-scanned the gate/head/fork logic with fresh eyes — no new actionable
defect.

### Validation

- Full node suite GREEN: 4839/0 (canonical run-tests.sh; +5 openFileAccessSettings tests).
- Full browser-checks suite EXITED 0 on the rebased code; every changed/new browser-check
  validated on a real board: click-first-run (all clear), render-first-run (no problems,
  planted-failure control fires), render-gated-next (all clear — S2/S3 block/unlock/fail-
  safe/poll-unlock), render-found-count (all passed), named-controls (S6 controls named).
- A prior round had caught FR_STEPS stuck at 7 (steps 8-9 unreachable) — fixed and guarded
  by web.firstrun-panecount-9screen.test.js (FR_STEPS pinned to the DOM pane count).

### Deferred (recorded, not blocking)

- **[NIT] No browser-check clicks `.s2-allow`.** Round 2 flagged that the S2 button's
  coverage is engine unit tests + static markup/handler-string assertions, with no
  browser-check that clicks it and asserts the POST fires / `#fr-s2-msg` shows a failure.
  This is the SAME coverage level as the pre-existing S3 open-settings buttons (no
  browser-check clicks those either), and the S2 failure-message DOM path is a verbatim
  copy of the shipped S3 path — consistent with the existing pattern, not a regression.
  Deferred rather than added, because adding it would change the reviewed diff and require
  a further round; a follow-up can add an end-to-end click assertion for both S2 and S3.
- **[NIT] S2 button lacks a browser-check by the same standing gap as S3.** Same item,
  recorded once as a follow-up for the open-settings buttons generally.
