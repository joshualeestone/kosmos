---
pre_challenge: true
method: challenge-loop
branch: federation-ui-3312
diff_hash: 72255d5d1672b3eca001324b4bbea6b52e9f35957b02cf6e54f00bc3ef554743
validation: passed
subdir_audit: passed
timestamp: 2026-09-19T20:49:43Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (iteration 1 = the 6.0 fix-and-validate pass; iterations 2-7 = fresh blind reviews)
**Converged:** Yes -- iteration 7 (Opus) found zero new BLOCKER/WARNING/CONVENTION.
**Total findings:** 12 BLOCKER/WARNING/CONVENTION acted on (3 deferred), plus NITs.
**Fixed:** 9 | **Deferred:** 3 | **Asked:** 0

Reviewer models were alternated Sonnet/Opus across iterations, so convergence is witnessed by both.

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
**Reviewer model:** n/a (validation pass, no sub-agent)
**New findings:** 1 BLOCKER (synthetic)
**Self-generated:** 0
- [BLOCKER] surface gate #2518: web/index.html touches surface tokens `ferr` + `openAddProject` that render-inline-field-errors-2606.js / render-pjadd-back-2850.js assert --> FIXED (Browser-check-surface trailers; the new ferr is join-mode pj-join-err, and openAddProject only gained a reset call, so neither check's assertion changed).

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 2 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [WARNING] PJ_FEDERATION_REF comment claimed the ref is passed on create; the code does not --> FIXED (comment corrected to actual behaviour; create-side persistence is an open ICK coordination point).
- [WARNING] the mode toggle hand-rolled role=radio + aria-checked, against Mona Lisa's own #178 ruling --> FIXED (native radios in a fieldset; checked as single source of truth, browser arrow-key nav).
- [WARNING] pjMintInvite did not check an empty name (Create path does) --> FIXED (same inline error).
- [CONVENTION] em dashes in the plan file --> FIXED.
- [CONVENTION] pre-existing "New project" comments in unrelated rail/list regions --> DEFERRED (pre-existing, out of scope; touching them widens the diff into more surface tokens).
- [NIT] doors not disabled during a mint (race) --> FIXED. [NIT] pj-join-code competing aria-label --> FIXED.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 WARNING, 3 NITs
**Self-generated:** 0
- [WARNING] pjJoinSubmit (the join degrade/navigate path) had no test --> FIXED (success-navigate, no-edge no-op, non-ok + unreachable never navigate).
- [NIT] verify did not paint the empty-agents hint / re-hide a stale picker --> FIXED. [NIT] Verify/Join used a text swap, not the app spinner --> FIXED (pjSpin). [NIT] pjFedMessage read body.code (the invite secret) as an error key --> FIXED (reason||error only).

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 4 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** ~2 (the message-drift and the plan-verification findings were about earlier iterations' own additions)
- [WARNING] mint error copy drifted from the Create path ("...name first." vs "...name.") --> FIXED + pinned by test.
- [WARNING] the plan's Verification section promised a browser-check that was not added --> FIXED (plan amended to record the shipped trailer + the pure-UI browser-check as a named follow-up).
- [WARNING] pjResetFederation + pjCopyInvite untested --> FIXED (reset clears every surface; copy writes + confirms).
- [WARNING] no guard against minting an invite then abandoning create --> DEFERRED (depends on the project_ref reconciliation with ICK; documented as a follow-up).
- [CONVENTION] join agent chip diverged from the create picked-row --> FIXED (addAgentsHtml parameterised + reused; one visual language).
- [NIT] redundant .focus() after pjFieldBad --> FIXED.

#### Iteration 5
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 2 NITs
**Self-generated:** ~1 (the #750 comment became stale because this PR made the doors live)
- [WARNING] the #750 comment still said the external doors were disabled placeholders --> FIXED.
- [WARNING] the project-settings members screen still shows disabled external doors with a now-imprecise tooltip --> DEFERRED (pre-existing, a separate surface; documented as a follow-up).
- [NIT] copy result not in an aria-live region --> FIXED (announced via pj-invite-status). [NIT] a stale code could sit beside the empty-name error --> FIXED (panel cleared on that return).

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 1 NIT
**Self-generated:** ~1 (the aria-live status timer was added in iteration 5)
- [WARNING] pjCopyInvite's revert timers were never cancelled (a reopen inside the 2s window clobbers new state) --> FIXED (one cancellable PJ_COPY_TIMER, cleared on reset).
- [WARNING] pjJoinPickOptions/pjPaintJoinAgents (the join own-agent picker) untested --> FIXED.
- [NIT] pjJoinPickOptions parity gap with addPickOptions (disabled title + role in labels) --> FIXED.

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKER/WARNING/CONVENTION, 1 NIT
**Self-generated:** 0
**Converged** -- an independent Opus pass traced all three async flows (mint/verify/join), verified honest-degrade, no XSS, the isolation-test contract, race/state hygiene, native-radio a11y, and convention-cleanliness, and found nothing actionable.
- [NIT] a couple of copy tests arm the real 2000ms PJ_COPY_TIMER and hold node --test's event loop ~2s before exit (harmless; the reset test clears it). Recorded, not fixed (a NIT does not block convergence).

### Final Ledger (BLOCKER/WARNING/CONVENTION)

| # | Iter | Category | File | Origin | Description | Status |
|---|------|----------|------|--------|-------------|--------|
| 1 | 1 | BLOCKER | web/index.html | BRANCH | surface gate: ferr + openAddProject tokens | FIXED (trailers) |
| 2 | 2 | WARNING | web/index.html | BRANCH | PJ_FEDERATION_REF comment claimed create wiring | FIXED |
| 3 | 2 | WARNING | web/index.html | BRANCH | hand-rolled radio toggle (vs #178) | FIXED (native radios) |
| 4 | 2 | WARNING | web/index.html | BRANCH | mint no empty-name check | FIXED |
| 5 | 2 | CONVENTION | plan | BRANCH | em dashes | FIXED |
| 6 | 2 | CONVENTION | web/index.html | BRANCH | pre-existing "New project" comments | DEFERRED (pre-existing/out of scope) |
| 7 | 3 | WARNING | web/index.html | BRANCH | pjJoinSubmit untested | FIXED |
| 8 | 4 | WARNING | web/index.html | SELF | mint error copy drifted | FIXED + pinned |
| 9 | 4 | WARNING | plan | SELF | plan promised an unshipped browser-check | FIXED (plan amended) |
| 10 | 4 | WARNING | web/index.html | BRANCH | reset/copy untested | FIXED |
| 11 | 4 | WARNING | web/index.html | BRANCH | abandon-with-invite guard | DEFERRED (ICK project_ref coordination) |
| 12 | 4 | CONVENTION | web/index.html | BRANCH | join chip shape diverged | FIXED (addAgentsHtml reuse) |
| 13 | 5 | WARNING | web/index.html | SELF | stale #750 disabled-doors comment | FIXED |
| 14 | 5 | WARNING | web/index.html | BRANCH | settings-screen external doors | DEFERRED (pre-existing/separate surface) |
| 15 | 6 | WARNING | web/index.html | SELF | uncancelled copy revert timer | FIXED |
| 16 | 6 | WARNING | web/index.html | BRANCH | join picker untested | FIXED |

### Deferred (with reasoning)
- Pre-existing "New project" comments in unrelated regions (iter 2): out of scope; the rename does not require rewriting comments across the file, and doing so widens the diff into more browser-check surface tokens.
- Abandon-with-invite guard (iter 4): the defensive UX depends on how project_ref is reconciled with ICK (an open coordination point), so it is a follow-up card. Flagged to Splinter/ICK; noted in the plan.
- Settings-screen external doors + imprecise tooltip (iter 5): pre-existing, unchanged by this diff, and a separate surface (inviting to an already-created project). Tracked as a fast-follow in the plan; this PR intentionally does not touch those lines.

### NITs (recorded, non-blocking)
- lift() brace-bounding heuristic in the test is a convention, not guaranteed against a future reformat (iter 2).
- copy tests hold node --test's event loop ~2s via the real PJ_COPY_TIMER (iter 7).

### Strengths (across iterations)
- Honest-degrade is airtight and tested on all three flows (mint/verify/join): no fake code, no false success, no navigation without a resolved id; every catch says "could not reach".
- No XSS surface (textContent for owner name/desc, esc() for agent strings).
- Isolation-test contract respected: every lifted function calls only lifted-or-injected helpers; pjSpin self-contained; addAgentsHtml defaults keep create callers byte-identical.
- Native radios per #178 (checked as single source of truth, browser arrow-key nav); race/state hygiene (doors disabled mid-mint, copy timer cleared on reset); messaging-only guardrail upheld in all copy.
</content>
