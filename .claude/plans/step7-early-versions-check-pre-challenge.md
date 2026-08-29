---
pre_challenge: true
method: challenge-loop
branch: step7-early-versions-check
diff_hash: e14625de188945a7cfb18c4df5f32d5dfe9dcd82e3db25895160ff9b13993202
validation: passed
subdir_audit: passed
timestamp: 2026-08-29T15:26:15Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (this run). This is a RE-ENTRY regeneration after rebasing the branch onto
the current origin/main to resolve a merge conflict. The only conflict was package.json's
test:shell chain, resolved as a verified one-line union (main added test-report-hook-resolver;
this branch added versions-entry + test-versions-entry-gate; the diff vs the base is exactly
one line). The reviewed gate logic is byte-identical to the prior converged review. A fresh
blind agent re-reviewed the whole rebased diff and converged with zero actionable findings.

**Converged:** Yes.
**Total findings this run:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT.
**Fixed:** 0 | **Deferred:** 1 | **Asked:** 0

The full suite is green at 2923/2923 on the rebased tree.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT.
**Converged** - the one WARNING deduplicates to a pre-existing, already-carded issue (#1464)
that this change does not introduce; the NIT was in the prior proof artifact and is resolved
by regenerating this file em-dash-free.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/lib/versions-entry.sh:208 | kosmos_versions_entry_stamp_off parses the entry in the machine's local timezone while insert-release-entry.js hard-codes CDT, so on a non-Central machine or in winter (CST) the gate measures a different quantity than the page claims. | DEFERRED | Pre-existing, carried verbatim from the old step-7 inline check, not introduced by this change; already carded as #1464 and referenced in this PR body as a separate concern. The tighter 4-min step-1 bound increases its blast radius, but weakening the bound to mask a timezone bug would undermine the design; docs/releasing.md documents the false-refusal cases and the overridable KOSMOS_STEP1_PAST_BOUND knob, and the fix belongs in #1464. Both independent reviews reached this scoped-out conclusion. |
| 2 | 1 | NIT | .claude/plans/step7-early-versions-check-pre-challenge.md | The prior proof artifact carried 3 em dashes (all product/code/doc files in the diff are clean at 0). | FIXED | This regenerated proof uses hyphens only. |

### Outstanding questions (ASKED, still unresolved when the run ended)

None.

### NITs (non-blocking, across all iterations)

- [NIT] the prior proof artifact carried em dashes (resolved by this regeneration).

### Strengths (across all iterations)

- Fail-closed posture is correct and thoroughly proven: every non-integer/empty/NaN/overflow path routes to unparseable and refuses; the 10# base-10 normalization defeats the octal/leading-zero abort; the 9-digit magnitude cap defeats the 20-digit wraparound; validation and conversion are unified so the validated form and the used form cannot diverge (iteration 1).
- Injection-safe: version constrained to [0-9.] before use, grep -qF presence, awk index() reader, page content reaches node only via the V_ENTRY env var (iteration 1).
- Test quality is largely non-vacuous: the 12-minute arm pins the asymmetric bound; fail-open arms are separated so the node guard cannot mask the shell guard; env-override arms flip a verdict with a default-value control (iteration 1).
- Correct handling of the REPO -> BUILD reassignment: the lib is sourced once at step 1 before the freeze and persists to step 7, deliberately not re-sourced from the frozen tree (iteration 1).
- The documented usability regression is honest and complete: docs/releasing.md spells out the new pre-launch precondition, the D <= 35 ceiling, the false-refusal cases, and all three overridable knobs (iteration 1).
