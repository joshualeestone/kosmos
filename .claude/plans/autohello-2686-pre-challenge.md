---
pre_challenge: true
method: challenge-loop
branch: autohello-2686
diff_hash: 344015dfbd5a15e5c633172be29ed34c343967be5f1804b0acae5d09278b7285
validation: passed
subdir_audit: passed
timestamp: 2026-09-10T23:30:41Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 surfaced zero new BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 8 actionable (2 BLOCKER, 6 WARNING) + 4 CONVENTION/NIT + strengths
**Fixed:** 7 | **Deferred:** 1 (model/provider-switch auto-hello, to kosmos#2716) | **Asked:** 0

Reviewer models rotated across iterations (kosmos#2032): opus, sonnet, opus, sonnet, opus.
Each blind pass ran on a fresh agent with no knowledge of prior findings.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER
**Self-generated:** 0 of the above (the initial feature commit predates the loop's fix commits)
- [BLOCKER] tools/browser-checks.sh - the committed browser-check render-autohello-2686.js was never wired into the runner; tools.browser-checks-wired.test.js (#1387) requires every check to be run or listed unwired-with-reason --> FIXED (commit f0ba329a). Independently found by the 6.0 full-suite validation too.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER
**Self-generated:** 0 (the defect was in the initial feature commit's code)
- [BLOCKER] web/index.html - on the stale-instructions notice (the card's primary path), the note node lives in #d-instr-stale, which renderStale regenerates via setLive innerHTML= on every tick; moving the note write to after await tick() wrote to a DETACHED node, so the interim/confirmation never reached the screen --> FIXED (commit 65726a11): guard the writes with isConnected, aligning with the file's existing "the notice's receipt is that it DISAPPEARS" design; added browser-check arm 7.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 2 WARNING
**Self-generated:** 1 of the above (the missing guard was on the showNote the iteration-2 fix added)
- [WARNING] web/index.html - the rst-go showNote guarded only isConnected, but the detail-page note (d-restart-msg) is SHARED across agents and stays connected, so navigating to another agent during the 30s wait landed agent A's resolution in agent B's dialog --> FIXED (commit 8d7d3c19): added the CURRENT.sessionName===name open-agent guard the doctrine site already uses; added browser-check arm 8.
- [WARNING] web/index.html - the doctrine comment's "same protection as the rst-go site" parity claim was false until the guard above was added --> FIXED (comment corrected in 8d7d3c19).

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 3 WARNING
**Self-generated:** 1 of the above (the timing regression was in the loop's own rst-go edits)
- [WARNING] web/index.html (completeness) - the plan claimed only two restart sites, but changeModelNow and moveAccountNow also restart the agent and still tell the user to say hello --> DEFERRED to kosmos#2716: those run through changeDialog's Josh-tuned success-only minBusyMs interstitial (~10s) whose timing differs from the auto-hello readiness wait (up to 30s); reconciling them is a focused follow-up. Plan's scope-guard section corrected to name #2716.
- [WARNING] web/index.html - renderStale's pre-click banner still promised a manual hello --> FIXED (commit b673e56e): updated to "Restarting re-reads the changes and wakes <name>."
- [WARNING] web/index.html - the rst-go interim "Waking..." write was after await tick(), leaving the detail-page note blank during the fetch --> FIXED (commit b673e56e): moved before closeRestartModal()/tick(), matching the doctrine site.

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION (3 NITs only)
**Self-generated:** 0
**Converged** -- the reviewer verified red-capability by construction (removing each guard reds a specific arm) and found no actionable defects.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | tools/browser-checks.sh | BRANCH | new check not wired into the runner (#1387) | FIXED | f0ba329a |
| 2 | 2 | BLOCKER | web/index.html | BRANCH | note write to a renderStale-detached node on the primary path | FIXED | 65726a11 |
| 3 | 3 | WARNING | web/index.html | SELF | rst-go receipt could land in another agent's dialog (no CURRENT guard) | FIXED | 8d7d3c19 |
| 4 | 3 | WARNING | web/index.html | SELF | doctrine comment's parity claim was false | FIXED | 8d7d3c19 |
| 5 | 4 | WARNING | web/index.html | BRANCH | model/provider-switch restarts still require a manual hello | DEFERRED | kosmos#2716 |
| 6 | 4 | WARNING | web/index.html | BRANCH | stale banner promised a manual hello | FIXED | b673e56e |
| 7 | 4 | WARNING | web/index.html | SELF | interim receipt written after a status round-trip | FIXED | b673e56e |

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html:32180 - RESTART_HELLO_SEQ accumulates one key per distinct agent name restarted, never pruned. Negligible (bounded by roster size, page lifetime). (iterations 3, 5)
- [NIT] web/index.html - the "said hello" success gates on delivery.state === 'placed' only, diverging from the composer's placed||unconfirmed; deliberate (a false greeting is worse than a possible redundant double-hello for a wake word). (iteration 5)
- [NIT] commit bodies cite loose arm counts (12/15/16); cosmetic, the file computes its own pass tally. (iteration 5)

### Strengths (across all iterations)
- The readiness state machine is correct: restartedAndReady excludes the #2019 'restarting' gap, sawUnready refuses a stale pre-restart snapshot, per-agent RESTART_HELLO_SEQ supersedes only same-agent waits, supersession re-checked after the wait/fetch/in the catch, no path fires the hello into a dead/booting pane.
- The browser-check arms are red-capable by construction: removing state!=='restarting' reds arm 2, removing sawUnready reds arm 3, claiming success on unconfirmed reds arm 5, removing the CURRENT guard reds arm 8; arms 7/8 drive the real handler against DOM detachment and navigate-away.
- Delivery is claimed as reached only on 'placed', never bare 'recorded', mirroring the composer.
- The scope deferral to kosmos#2716 is honestly represented in the plan and commit history; the plan names its own weakest premise (gap observability within the poll window).
