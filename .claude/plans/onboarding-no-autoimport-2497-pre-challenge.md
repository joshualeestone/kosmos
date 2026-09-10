---
pre_challenge: true
method: challenge-loop
branch: onboarding-no-autoimport-2497
diff_hash: ce1e91f3f20540328c053954733365a2cb5471c5ec731f463858e064f3086a59
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T22:27:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 found zero new BLOCKER/WARNING/CONVENTION)
**Total findings:** 8 (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs)
**Fixed:** 3 | **Deferred:** 4 | **Asked (awaiting user):** 0

Change under review (kosmos#2497): first-run onboarding no longer auto-scans the disk or
auto-imports/adopts existing terminal-agent projects onto the Screen 9 fleet wizard. `frPaintFleet`
(web/index.html) now short-circuits at the top to the no-agent "Create your first agent." / "Let's
get started." / Giddy Up screen, before any `frFindAgents`/`frScanAgents`/path fork, and returns.
The discovery/import engine is kept-but-bypassed (manual Import Agent, kosmos#1652, is untouched).
The diff also reconciles the node tests + 7 browser-checks to the suppression behavior and bumps two
emit-count constants. Convergence was witnessed across two models (opus, sonnet, opus).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (this is the first reviewer pass; ITER_COMMITS was empty)
- [WARNING] server.test.js:5657 — "the fork step does not promise a working agent" asserted only the
  ABSENCE of machine-snag copy that lived in the now-bypassed create arm, so #2497's unconditional
  Giddy Up render made it pass vacuously. --> FIXED (commit 4eb9f9b5): anchored all three cases
  (clean/snagged/never) on a positive `/create your first agent/i` assertion so the absence guards
  pass only because the Giddy Up screen genuinely rendered.
- [NIT] server.test.js — unused path/count consts left over from the pre-suppression assertions.
  --> DEFERRED: harmless dead locals; removing them is churn with no behavioral effect.
- [NIT] browser-checks — `waitForTimeout` used to prove an absence. --> DEFERRED: the checks pair the
  wait with a positive Giddy-Up anchor + a route-count===0 assertion, so the absence is not proven by
  the wait alone.

#### Iteration 2
**Reviewer model:** sonnet (a different model from iteration 1, per 6a)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (the flagged files were authored in the original branch work, not
by iteration 1's fix commit)
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] docs/browser-checks/render-found-undo.js — the suppression check counted only
  `/api/found-agents/decline` (the adopt-row Skip route) as "disconnect", but the found-row post-add
  Undo (`.fr-foundundo`, web/index.html:41215) posts to `/api/disconnect-agent`. A regression that
  partially restored found-row rendering and auto-fired the real Undo route would go uncaught.
  --> FIXED (commit bc5edb04): stub and count BOTH routes, assert both are zero (8/8 on a booted board).
- [NIT] web/index.html:8873 — the pre-JS static `#fr-fleet-title` default read "We found existing
  agents on this computer", so first run (which #2497 makes always land on create) briefly flashed the
  wrong heading before JS ran. --> FIXED (commit bc5edb04): static default set to "Create your first
  agent." to match the deterministic outcome (no test asserts the old text; grep clean).
- [NIT] proof file `-pre-challenge.md` not present in the diff yet. --> NOT A DEFECT: the proof is
  written at Step 7 after convergence (this file); expected absence mid-loop.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Verdict:** correct and complete. Traced every call site of `frFindAgents`/`frScanAgents`/
`frArmRescanOnGrant`/`frPaintScan`/`frPaintFound` and confirmed none fires on first run (all sit in
dead arms after the forced `return`); confirmed every reconciled test/check pairs a positive
Giddy-Up anchor with a failable suppression assertion; confirmed `EXPECTED_SITES=76` is a hard
`assert.equal` that catches drift-to-zero; confirmed no em dashes in added lines or commit bodies.
- [NIT] docs/browser-checks/render-first-run.js:126 — shot `firstrun-fleet-cannot-see` keeps its name
  while now capturing the create screen (its `expect` regex is already correct). --> DEFERRED:
  cosmetic filename parity; renaming a shot risks a manifest reference for zero behavioral gain, and
  the assertion is correct.
- [NIT] docs/browser-checks/render-first-run.js:124 — `firstrun-fleet-adopt` shot name describes the
  input path, not the create output. --> DEFERRED: same rationale.

### Final Ledger

| # | Finding | Severity | Origin | Status |
|---|---|---|---|---|
| 1 | server.test.js:5657 vacuous machine-promise test | WARNING | BRANCH | FIXED (4eb9f9b5) |
| 2 | server.test.js unused consts | NIT | BRANCH | DEFERRED |
| 3 | browser-checks waitForTimeout-for-absence | NIT | BRANCH | DEFERRED |
| 4 | render-found-undo.js wrong disconnect route | WARNING | BRANCH | FIXED (bc5edb04) |
| 5 | static #fr-fleet-title flash-of-wrong-heading | NIT | BRANCH | FIXED (bc5edb04) |
| 6 | proof file not yet present | NIT | (n/a) | NOT A DEFECT |
| 7 | render-first-run.js shot name firstrun-fleet-cannot-see | NIT | BRANCH | DEFERRED |
| 8 | render-first-run.js shot name firstrun-fleet-adopt | NIT | BRANCH | DEFERRED |

Converged at iteration 3: an independent blind pass (opus, model-rotated) found zero new
BLOCKER/WARNING/CONVENTION. Only cosmetic NITs remain, all read-and-judged deferrals.

### Post-convergence: one CI-found reconciliation (browser-checks, the strongest reviewer)

After the loop converged and the PR opened (#2507), the enforced browser-checks CI job went red on
`click-first-run` -- a first-run wizard-walk check in the CI allowlist that the 3 blind passes did
not surface (it is not one of the 7 render-* checks I reconciled, and it runs only on a fleet-present
"rich" board that the blind reviewers, reading the diff, had no reason to enumerate). It asserted the
old step-9 ending "the board is there" (`#grid` visible); #2497 makes step 9 always end in Giddy Up
-> `frFinish(openCreate)`, which opens `#panel-create` instead. Reproduced locally on the exact
rich-board fixture, reconciled the assertion to `#panel-create` (mirroring the check's own dedicated
create-fork section), and re-ran the harness frozen at the fix commit: PASS. This is a test-check
reconciliation surfaced and validated by CI, not new product logic; recorded here so the proof
reflects what actually happened and the diff_hash above is re-attested over the fix.
- [BLOCKER] docs/browser-checks/click-first-run.js:232 -- stale step-9 ending assertion (`#grid`
  visible) contradicts the #2497 Giddy Up -> create-panel ending. Origin: CI (browser-checks).
  --> FIXED (commit c5f2477e); harness frozen at the fix = PASS on the rich-board fixture.
