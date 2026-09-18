---
pre_challenge: true
method: challenge-loop
branch: installer-bar-a11y-3233
diff_hash: 95b9db8db3362fd75bfa3407ff0f2dcb3e8742dec7b67f7f9362bfa9e0147fee
validation: passed
subdir_audit: passed
timestamp: 2026-09-18T08:25:51Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 8 (1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 4 NITs)
**Fixed:** 6 | **Deferred:** 1 | **Asked (awaiting user):** 0

Small a11y fast-follow to the determinate installer progress bar shipped in #3248
(`install/pkg-scripts/installing.html`): `aria-valuenow`/`valuemin`/`valuemax` on the
`role="progressbar"` element, and a reduced-motion guard for the determinate width transition.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (general-purpose default)
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty at iteration 1; findings sit on the
pre-loop branch commit e602cd52b, Origin BRANCH)
- [BLOCKER] installing.html:42 — reduced-motion fix defeated by CSS specificity (`.bar.determinate>i` 0,2,1 out-specifies `.bar>i` 0,1,1; media queries add no specificity), so `transition:none` never applied to the one element with a transition --> FIXED (b2610ec59): name both selectors in the override (equal specificity, later source order wins).
- [WARNING] installing.html:371 — settle set `aria-valuenow="100"` unconditionally, falsely announcing 100% on the taken branch (nothing installed) --> FIXED (b2610ec59): gated on a `kpDeterminate` flag.
- [WARNING] install.installing-page.test.js:183 — the reduced-motion assertion certified the broken rule text --> FIXED (b2610ec59): updated to the corrected selector.
- [WARNING] install.installing-page.test.js:250 — coverage gap: nothing guarded aria-valuenow ABSENT while indeterminate --> FIXED (b2610ec59): added positional + static-0 guards.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 3 of the 4 (the aria/kpDeterminate/test findings sit on iteration-1 fix commit b2610ec59, Origin SELF; all code/test lines, fixed normally)
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] installing.html:370-379 — a no-content-length success stays ARIA-indeterminate at settle (the flip side of the kpDeterminate gate) --> DEFERRED (documented, 5e4b0f477): not a regression (matches the swoosh shown throughout + the pre-#3233 baseline of no aria-valuenow); the honest fix threads a success-vs-taken flag through the shared settle(), out of scope for this pass. Recorded in the code comment and the plan's weakest-premise.
- [WARNING] install.installing-page.test.js:186 — the reduced-motion assertion is a string check that cannot verify the runtime cascade (a future reorder would pass silently) --> FIXED (5e4b0f477): added a KNOWN TEST-QUALITY GAP comment flagging it (a jsdom/computed-style check would be needed).
- [NIT] installing.html:382 — `typeof p.bytes === "number"` does not exclude NaN, so a malformed byte count could write `aria-valuenow="NaN"` --> FIXED (5e4b0f477): NaN-safe clamp `if (!(pct >= 0)) pct = 0`, + a test guard.
- [NIT] installing.html:391 — no aria-valuetext (optional friendlier announcement) --> not taken (optional nicety, not a defect).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 of 1 (the Math.round line is on an earlier loop fix commit, Origin SELF)
**Converged** — zero new BLOCKER/WARNING/CONVENTION. Five STRENGTHs confirmed the cascade fix, the aria wiring on every branch, the NaN-safe clamp, the non-vacuous tests, and the documented no-total-success tradeoff.
- [NIT] installing.html:397 — `aria-valuenow` used `Math.round(pct)`, so 99.5-100% announced "100%" ~0.5s early, mildly inconsistent with the change's own care about not announcing completion early --> FIXED (b049dd75f): `Math.floor`, so AT never overstates progress; settle still mirrors the true 100.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | installing.html:42 | BRANCH | reduced-motion defeated by specificity | FIXED | b2610ec59 |
| 2 | 1 | WARNING | installing.html:371 | BRANCH | settle aria-valuenow=100 on taken branch | FIXED | b2610ec59 |
| 3 | 1 | WARNING | test.js:183 | BRANCH | assertion certified the broken rule | FIXED | b2610ec59 |
| 4 | 1 | WARNING | test.js:250 | BRANCH | no indeterminate-absence guard | FIXED | b2610ec59 |
| 5 | 2 | WARNING | installing.html:370-379 | SELF | no-total success stays indeterminate | DEFERRED | Not a regression; documented (code + plan) |
| 6 | 2 | WARNING | test.js:186 | SELF | string check cannot verify cascade | FIXED | 5e4b0f477 (gap comment) |
| 7 | 2 | NIT | installing.html:382 | SELF | NaN not excluded -> aria-valuenow=NaN | FIXED | 5e4b0f477 |
| 8 | 3 | NIT | installing.html:397 | SELF | Math.round announces 100% early | FIXED | b049dd75f |

### NITs (non-blocking)
- [NIT] installing.html:391 — no aria-valuetext (optional friendlier announcement, iteration 2). Not taken.

### Strengths (across all iterations)
- The reduced-motion fix reasons about specificity, not just presence (iteration 1/3).
- kpDeterminate gating correctly prevents a false "100%" on the taken branch (iteration 2/3).
- NaN-safe clamp closes the real `typeof NaN === "number"` hole (iteration 2/3).
- Tests are non-vacuous, assert against CODE (comment-stripped) for wiring and HTML for markup, and honestly document their own string-vs-cascade limitation (iteration 2/3).
- The no-total-success asymmetry is a sound, documented deliberate tradeoff (iteration 3).
