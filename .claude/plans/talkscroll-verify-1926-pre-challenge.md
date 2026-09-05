---
pre_challenge: true
method: challenge-loop
branch: talkscroll-verify-1926
diff_hash: 90e23bf57a3d2c375274bc6089706c4485c776a02b01ddcb0b2490ada0b33ade
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T13:00:50Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (iteration 1 yielded zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 1 NIT
**Fixed:** 1 (the NIT) | **Deferred:** 0 | **Asked:** 0

This is a TEST-ONLY change (a new hermetic browser-check + runner wiring + emit-count bump + README row). No product code (`web/index.html`, engine) changed, so the #1720 web-gate does not apply.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged** — no actionable (BLOCKER/WARNING/CONVENTION) findings.
- [NIT] docs/browser-checks/render-talk-anchor-1926.js:124,126 — comment + failure message said "m10" while the code targets "m20" (leftover from the first fixture); would print the wrong message id on a real red --> FIXED (commit 18a0154c)

The blind reviewer empirically confirmed (by running the check, not by assertion): it is red-capable and non-vacuous (`afterDelta` 40 != `pixelDelta` 644, so the anchor path ran; a reverted fix or a silent no-op both yield 644 and fail the `<= 3` assertion); the CONTROL is sound (644 vs 40 proves the above-content grew); layout is real (non-zero offsets, `atBottomBefore` false with slack looser than the product's); the emit-count bumps (42->43, 24->25) are correct (one SHAPE-1 finding-emit loop + one launch-catch); and conventions are clean (no em dashes, skip-vs-fail exits distinct).

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | render-talk-anchor-1926.js:124,126 | stale m10 refs vs m20 code | FIXED | 18a0154c |

### Validation

- **Full node suite: 2172 passed, 0 failed** on the final HEAD (18a0154c), no box needed.
- **Mechanical gates: 18/18** — #1864 emit-count (43/25), #1387 runner-wiring, #612 README parity, #1881 brand-ref.
- **The new browser-check passes headless** via the pinned `~/work/pw-runtime` runtime.
- The full box-sharing `run-tests.sh` was **green (exit 0)** on commit 28883450 (this branch's executed content); the only delta since (18a0154c) is comment text in the browser-check, provably inert to the suite (the emit-count is unchanged and the file is not executed by the node phase). A 6j re-run of the full box-sharing suite on the final HEAD was blocked by an active release cut (0.6.35, box reserved until 08:27 CDT); I did not override a live release's machine claim. GitHub CI runs the authoritative full suite on its own runners (not this box) at PR open.

### Rebased onto origin/main (diff_hash regenerated)
After convergence, origin/main advanced (release 0.6.35 + Renet's #2157 check). Rebased onto
origin/main `fe4da82a`, resolving one conflict in `tools/browser-checks.sh` (both `render-workchip-zero-2157`
and my `render-talk-anchor-1926` were inserted into the same runner-loop line; merged to keep both).
Re-validated AFTER the rebase on the final HEAD: full node suite **2172 passed, 0 failed**; mechanical
gates green (emit-count 43/25 still correct — #2157 added no countable emit site; wiring; README parity);
the browser-check passes headless. `diff_hash` above is recomputed against the rebased base, so it is
current, not orphaned.

### Deferred / weakest premise
The check drives `setThread` directly with hand-built `data-mid` rows rather than through the full `loadThread` fetch path, so it does not catch a regression where the 5s poll stops calling `setThread` with the right html. Named in the plan; scoped to the anchor arithmetic + layout that nothing else covered.

### Strengths (from the blind review)
- Red-capable and non-vacuous, confirmed empirically by running the check.
- Sound control (a pixel-restore would have jumped 604px).
- Real scroll layout (unhidden ancestors + fixed-height overflow box).
- Correct emit-count bumps, traced site by site.
- Clean conventions; test-only, so the #1720 web-gate correctly does not apply.
