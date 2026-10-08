---
pre_challenge: true
method: challenge-loop
branch: consenthash-5531
diff_hash: c05849de3f86bac06239ecd0c9bbf713d7419cd403077dae0a547514a52da35d
validation: passed (Mortals full suite at 0ec7df4d9, hash c05849de3f86)
subdir_audit: passed
timestamp: 2026-10-08T17:12:35Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6, each a fresh blind reviewer, alternating Opus (odd) and Sonnet (even).
**Converged:** Yes, at iteration 6 (Sonnet): no new BLOCKER, WARNING or CONVENTION. It was reviewed stacked on orgenroll-5531 at c05134e89. After #5595 merged, the same change was re-applied onto main as one commit. The patch applied cleanly, and its changed lines are identical (the sorted +/- lines hash the same: f7df92975829). That base differs from what merged only by an empty trailer commit and the proof file.
**Total findings:** 0 BLOCKERs, 12 WARNINGs (11 fixed, W11 decided and recorded in the plan), 3 CONVENTIONs (fixed), plus NITs as marked.
**Self-generated:** 1 (W12 was on the guard iteration 4 added).
**Validation:** engine/orgenroll-5531.test.js and server.orgenroll-5531.test.js (70 pass); render-orgenroll-5531.js, all 18 checks; full suite on Mortals at the head named above. The full browser checks run in CI.

## Ledger (verbatim, iteration by iteration)

# consenthash-5531 ledger
#### Iteration 1 (Opus) on f944c72f9
- [WARNING] (1) enroll's 409 org_consent_changed read as a lost answer (MEASURED by the reviewer). FIXED (SAY sentence; page code list; O14; pinned).
- [WARNING] (2) the plan scoped the enroll-side 409 out on a wrong premise. FIXED (plan corrected).
- [NIT] served hash vs cleaned words (comment); malformed served hash (pinned).
#### Iteration 2 (Sonnet) on a2b64d0f0
- [WARNING] (3) missing/malformed served hash still recorded a local hash (mayReport true, rollup always 409). FIXED (fail closed: nothing recorded; logged; pinned).
- [WARNING] (4) move refused for changed words said check the code. FIXED (move sentence; pinned).
- [NIT] stacked comments; repeated hex pattern; plan cites a relay sha (kept).
#### Iteration 3 (Opus) on 0bffcc432
- [WARNING] (5) two options for one fact (sent servedHash, recorded consentHash). FIXED (one option, sent and recorded; pinned).
- [WARNING] (6) stale test comment. FIXED. [CONVENTION] (7) stale test title FIXED; (8) plan What/Proof contradicted Review 2 FIXED; (9) consentHash() comment FIXED.
- [NIT] 'would never match' overstated (FIXED wording); hex pattern repeated (kept); move end-to-end composition (pieces covered).
#### Iteration 4 (Sonnet) on 2168f6dfb
- [WARNING] (10) echo assumed cleaning leaves served words unchanged, unpinned. FIXED (guard: echo only when the shown words equal the served; pinned two ways + control).
- [WARNING] (11) no served hash: joined but silent. DECIDED (the joined view says it sends nothing; refusing the preview would block companies that serve none); recorded in the plan.
- [NIT] stacked comments; repeated hex pattern; move sentence constant; rollup 409 (rollup branch) (kept).
#### Iteration 5 (Opus) on 863bb2971
- [WARNING] (12) non-array list passed the review-4 guard (MEASURED). SELF (r4). FIXED (non-array -> no echo; pinned).
- [CONVENTION] (13) stale 'the echo assumes' comment. FIXED.
- [NIT] consentHash() comment (FIXED: tests only); log names one cause (FIXED: three); plan What section (FIXED).
#### Iteration 6 (Sonnet) on 76dc7c1f5
- [NIT] log line on every hashless preview (kept); hex regex repeated (kept); refusal tests bypass preview (server test covers the wiring).
- Verified by the reviewer: the live coordinator's words (apostrophes included) survive cleaning, so the served hash IS echoed in production.
- ZERO NEW B/W/C -> CONVERGED at iteration 6.
