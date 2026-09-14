---
pre_challenge: true
method: challenge-loop
branch: dm-badges-2863
diff_hash: 4ce299d1788416e004c8e4ad8704fe585e05ffe80db4eda95abdaed2e0d43ceb
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T06:31:22Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (Sonnet, Opus, Sonnet, Opus - model varied per kosmos#2032, and it earned its keep:
every one of the four passes found a real issue the previous had left, including a BLOCKER)
**Converged:** Yes, iteration 4 found no BLOCKER/WARNING/CONVENTION and independently ran the full
suite green.
**Total findings:** 9 (1 BLOCKER, 5 WARNINGs, 0 CONVENTIONs, 3 NITs)
**Fixed:** 6 | **Deferred:** 3 (all NITs) | **Asked:** 0

The change is the render half of #2863 (the engine half, a.dmUnread + POST /seen, shipped in Angel's
#2881): a red numbered DM-unread bubble (dmBadge) on the agent grid card (running AND offline),
suppressed for the open agent, cleared by a gated paintTalk POST /seen. List-view badge, org node and
the top tallies are the scoped follow-up.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (first reviewer pass)
- [WARNING] offline card dropped the badge (engine attaches dmUnread to offline agents too) --> FIXED
- [WARNING] paintTalk POST /seen fired every ~5s poll (project precedent is gated + local-zero) --> FIXED
- [NIT] .dmbadge z-index:2 was a no-op (DOM order already stacks it) --> FIXED

#### Iteration 2
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 (the BLOCKER was introduced by iteration 1's offline-card fix)
- [BLOCKER] web.not-running.test.js lifts card() and evals it in isolation; card now calls dmBadge
  (which reads CURRENT), so it threw ReferenceError, failing 5/15. --> FIXED (lift dmBadge + inject
  CURRENT). This is the web-index-helper-delegation-breaks-isolation-tests class.
- [NIT] a poll-lag re-fire edge (benign, idempotent) --> DEFERRED
- [NIT] commit-subject special chars (house style, widely ignored in-repo) --> DEFERRED

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [WARNING] .agauge:has(.dmbadge) .membadge offset hit the bottom-anchored .unk variant too,
  stretching it tall on an agent with unread DMs AND unknown memory --> FIXED (scope to :not(.unk))
- [WARNING] server.test.js:3734 slice captures dmBadge but not CURRENT; green today only because all
  fixtures use dmUnread:0 (early return), a latent landmine for a future dmUnread>0 fixture --> FIXED
  (inject CURRENT). (server.socket-split.test.js was the same class, fixed alongside web.not-running.)
- [NIT] the card-wiring test matches the literal template string (brittle by house-style convention) --> DEFERRED

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0. **Converged** - no actionable findings; the reviewer independently audited every
card-referencing test (confirming exactly three isolation-eval sites, all hardened), verified the
:not(.unk) scope complete, the gated clear correct, the dark twin synced, and ran the full suite green.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | BRANCH | offline card dropped the badge | FIXED | 808c6db5 |
| 2 | 1 | WARNING | web/index.html | BRANCH | ungated /seen POST every ~5s | FIXED | 808c6db5 |
| 3 | 1 | NIT | web/index.html | BRANCH | .dmbadge z-index no-op | FIXED | 808c6db5 |
| 4 | 2 | BLOCKER | web.not-running.test.js | SELF | card()->dmBadge broke the isolation eval | FIXED | c1002668 |
| 5 | 2 | NIT | web/index.html | BRANCH | poll-lag re-fire (benign) | DEFERRED | idempotent cursor advance |
| 6 | 2 | NIT | git subject | BRANCH | special chars in subject | DEFERRED | house style, widely ignored |
| 7 | 3 | WARNING | web/index.html | BRANCH | :has offset stretched the .unk badge | FIXED | e68bf518 |
| 8 | 3 | WARNING | server.test.js | BRANCH | slice captures dmBadge w/o CURRENT (latent) | FIXED | e68bf518 |
| 9 | 3 | NIT | web.dm-badge-2863.test.js | BRANCH | brittle literal-template match | DEFERRED | matches house style |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking)
- .dmbadge z-index no-op (iteration 1, FIXED)
- poll-lag re-fire, benign/idempotent (iteration 2)
- commit-subject special chars, house style (iteration 2)
- brittle literal-template match, house style (iteration 3)

### Strengths
- The gated clear mirrors the proven project p.unread precedent (local-zero + gated POST + body
  read-and-dropped for #39 networkidle) rather than inventing a path. (iterations 3-4)
- dmBadge handles null/undefined/falsy/cap/singular-plural/CURRENT-suppression correctly, numeric-only
  output (no XSS surface). (iteration 4)
- The isolation-eval hardening is exhaustive: exactly three sites execute card(), all inject CURRENT,
  and every other card-referencing test was audited as unaffected. (iteration 4)
- Tests use real fleet fixtures with a documented field mutation, and paired match/doesNotMatch
  controls that can return the dangerous answer. (iterations 3-4)

### Validation note
Full suite + post-test gates passed clean (6271 tests, 6262 pass, 0 fail; `validation PASSED for
stack=typescript`), and the iteration-4 reviewer independently ran the full suite green (exit 0). The
fleet's frequent install-harness activity caused several tools.release-gate.test.js contention
false-reds during the run (the collision names the harness PID; release-gate passes 26/26 in
isolation, and a CSS/JS badge cannot touch release-cut logic) - the passing run above was taken in a
clean window. Subdir CLAUDE.md audit clean.
