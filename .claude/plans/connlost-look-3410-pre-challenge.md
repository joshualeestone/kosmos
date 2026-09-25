---
pre_challenge: true
method: challenge-loop
branch: connlost-look-3410
diff_hash: 75dcc78affd85d22792624aeeffe24192497f1924e78d1dbe88f307add188c5b
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T13:47:54Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes
**Total findings:** 2 BLOCKERs, 14 WARNINGs, 1 CONVENTION, 16 NITs, plus 2 validation findings
**Fixed:** 2 BLOCKERs, 12 WARNINGs, 2 validation findings, most NITs | **Deferred:** 2 WARNINGs (tracked as #3726, and a question answered with evidence) | **Asked:** 0

Scope grew during the loop by decision, not drift: after iteration 4, Mona Lisa (design owner) ruled that a
given-up connection counts under the Issue tile and filter, and April handed over #3718 (needs_trust, the
same predicate at the same sites), which was folded in. The branch was rebased onto main before iteration 9
(one export-line conflict, both sides kept).

Validation: full run on HEAD af6b38689, 9289 tests, 0 failures; subdir audit passed. Browser checks
render-connlost-reconnect-3410 and render-chip-filters-3423 (headless, pw-runtime) pass, each with red
controls; render-dm-badges-2863 re-run and passing (44 PASS) for the surface-gate trailer.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] pjMember read cardStOf(m), so the members row stayed grey beside a red card --> FIXED (liveM; browser check; red control bit)
- [WARNING] members check compared only the label --> FIXED
- [WARNING] Issue filter omitted given up --> ASKED of Mona Lisa, then FIXED after her ruling (iteration 5)
- [WARNING] two comments stale about the look --> FIXED
- NITs: check-in verb, variable name, README row, cardStOf readability (the split was reverted in iteration 2)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING
**Self-generated:** 1 (the iteration-1 NIT fix)
- [BLOCKER] splitting cardStOf across lines broke two tests that slice it to the newline --> FIXED (one line, comment names both tests)
- [WARNING] org chart and detail panel take the look via cardStOf, unstated --> FIXED (plan)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 new actionable (its WARNING was the Issue-filter item), 3 NITs --> two comment NITs FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 NIT
**Converged** on the look change. Mona Lisa then ruled on the Issue filter and #3718 was folded in.

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 4 NITs
**Self-generated:** 1
- [BLOCKER] needs_trust rows are built by the route after countAgents, so the tile never counted them while the filter showed them --> FIXED (engine/status.js needsPerson; the route adds offline rows with it; source pin with red control)
- [WARNING] the countAgents test fed an input production never sends --> FIXED (route pin)
- [WARNING] project Issue pill still needs_you only --> DEFERRED: filed #3726, cited in the plan and at engine/projects.js
- NITs: org comment, snapshot counts note, plan wording --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 new WARNING (chip-filter check header stated the old rule) --> FIXED; the project-pill WARNING duplicated iteration 5

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
- [WARNING] seven inline copies of the Issue rule were not all pinned --> FIXED (browser-check arm 2f compares card, list row and org node with needsPerson for needs_trust, given up, reconnecting, idle; red control on the needs_trust list-row copy bit)
- [WARNING] #3726 not cited where the next reader looks --> FIXED
- [CONVENTION] raw 'connection_lost' literal --> FIXED (STATE.CONNECTION_LOST)
- NITs: needsPerson above its own doc block, 2e wording, route pin robustness --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
- [WARNING] Windows has a --resume path, so "anything it was in the middle of is lost" might not hold there --> DEFERRED with evidence: engine/win32supervisor.js resumes only when an agent dies under a live supervisor; a restart from the board runs main(), "a fresh conversation, as a Mac restart gives". Recorded in the plan.
Validation finding: surface gate flagged render-dm-badges-2863 (lrow changed) --> FIXED (re-ran the check, 44 PASS; per-check trailer)

#### Iteration 9 (after rebasing onto main)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 new WARNING (README index row stated the old rule), 3 NITs
- [WARNING] README row --> FIXED
- NITs: CARD_ST header, an assertion that could not fail (removed)
It checked the new main (Agent Swarms, the setup-assistant bubble): nothing new reads the changed counts, states or filters.

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT (a blank line)
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html pjMember | BRANCH | members row grey beside red card | FIXED | liveM |
| 2 | 1 | WARNING | render-connlost-reconnect-3410.js | BRANCH | members check label-only | FIXED | pjm-attn assert |
| 3 | 1 | WARNING | web/index.html data-attn | BRANCH | Issue filter omits given up | FIXED | Mona's ruling, needsPerson |
| 4 | 2 | BLOCKER | web/index.html cardStOf | SELF | multi-line broke slicing tests | FIXED | one line |
| 5 | 5 | BLOCKER | server.js /api/status | BRANCH | offline needs_trust never counted | FIXED | needsPerson on offline rows |
| 6 | 5 | WARNING | engine/status.test.js | SELF | test fed an impossible input | FIXED | route pin |
| 7 | 5 | WARNING | engine/projects.js | BRANCH | project pill needs_you only | DEFERRED | #3726 |
| 8 | 6 | WARNING | render-chip-filters-3423.js header | BRANCH | stated old rule | FIXED | header |
| 9 | 7 | WARNING | web/index.html (7 copies) | BRANCH | copies not all pinned | FIXED | arm 2f |
| 10 | 8 | WARNING | web/index.html give-up copy | BRANCH | Windows resume doubt | DEFERRED | evidence: fresh session on board restart |
| 11 | 9 | WARNING | docs/browser-checks/README.md | BRANCH | index row stated old rule | FIXED | row |

### NITs (non-blocking, across all iterations)
- [NIT] needs_trust has no STATE constant (repo-wide, left)
- [NIT] the route pin is a text pin (Windows-only producer; documented in the test)
- [NIT] a blank line after needsPerson (iteration 10)

### Strengths (across all iterations)
- [STRENGTH] — One rule (needsPerson) drives the tile count and, via arm 2f, is checked against every render copy of the filter
- [STRENGTH] — The look is one derivation (cardStOf) for card, row, org node, detail and members row
- [STRENGTH] — Every new test has a control that returns the dangerous answer, and red controls were run for each fix
