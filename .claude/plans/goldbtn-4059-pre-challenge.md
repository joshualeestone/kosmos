---
pre_challenge: true
method: challenge-loop
branch: goldbtn-4059
diff_hash: 12e21a35343e47840595a5b8f370c27459523ca2cbbef88c8f63bb0aa474b828
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T07:03:58Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind reviewer passes, after the 6.0 initial-validation pass
**Converged:** Yes, at iteration 2 (no new BLOCKER, WARNING or CONVENTION)
**Total findings:** 9 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 8 NITs), plus three validation reds found by the helper
**Fixed:** 4 (the WARNING and three NITs) | **Deferred:** 6 NITs | **Asked (awaiting user):** 0

### Validation runs (6.0 and 6g)

- 6.0 at b4068c9 FAILED on three unit tests.
  - "the gold primary carries NO edge" and "hovering the gold primary keeps it gold" were pinned to the old
    flat-gold text. They now check the intent: the border is transparent or equal to the fill, and the hover is
    gold. Controls are recorded in f2882e3's report: a #14161a border, a var(--attn-bg) hover, and a grey
    gradient swapped into --gold-polished-hover each go red. I reran the var(--attn-bg) hover control myself.
    Its first run went red only on ENOENT, because the tests read web/index.html relative to cwd. Run from the
    right directory, it goes red with the intended message.
  - "the pre-rail grid rows are auto, never 0" was a REAL regression. The new script was a 39th direct child
    of the body, and the consolidated layout reserves 38 rows. The script moved to the head (f2882e3). Control:
    the pre-fix branch is red at 39 children.
- 6g #1 at f39930f: the unit tests reported fail 0. The run FAILED on the surface-annotation lint:
  gold-polished and gold-polished-hover are CSS variables, which the gate can never fire on. Dropped from the
  header in 4ababc9.
- 6g #2 at 4ababc9: the unit tests reported fail 0. The run FAILED on the surface gate #2518: a head comment
  said "grid", a token that render-phone-offline-718.js watches. Reworded in a1309be. That is a comment-only
  change made after convergence, so no reviewer saw this wording. The gate run alone gives rc 0, and
  web.consolidated-980 gives 13/13.
- 6g #3 at a1309be: PASSED (stack=typescript, hash 12e21a35343e, fail 0, no FAIL lines).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html frame() — The empty board repaints "Create your first agent" on every poll. That
  throws the hosted canvas away, and the light drops until the pointer next moves. --> FIXED (4ababc9):
  rehost() carries the light to the new copy under a still pointer. At the same size the canvas simply moves.
  Browser-check arm G11. Control: with the rehost() call removed, G11 is red in WebKit. Chromium passes either
  way; it appears to re-send pointerover after the replacement.
- [NIT] render-gold-buttons-4059.js G3b — the disabled arm cannot fail if an engine sends no pointer events
  to a disabled button. --> FIXED (4ababc9): a positive control; the same button, enabled, hosts the light.
- [NIT] render-gold-buttons-4059.js — no assertion on the number of checks run. --> FIXED (4ababc9):
  EXPECTED = 72.
- [NIT] web/index.html window.goldLightState — a test hook ships as a global and hands out a live element.
  --> DEFERRED: it is read-only and does not change the page, the same pattern as the page's other test hooks.
- [NIT] web/index.html webglcontextlost — the light stays off until reload. --> DEFERRED: the fail-safe is
  by design, and the CSS hover still works.
- [NIT] web/index.html goldOf() — one getComputedStyle per pointer move over a .uprime. --> DEFERRED: not
  measured as a cost; it reads one custom property.
- [NIT] web/index.html size() — checkFramebufferStatus reads only the last-bound target. --> DEFERRED: all
  the targets share one format, so support is uniform.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 0
- [NIT] render-gold-buttons-4059.js G2 — contrast is not asserted on the .cpost shapes (#d-send and the
  others). --> DEFERRED: they measure 33px against the fixture's 34px, so the corner floor is the same.
- [NIT] web/index.html frame()/pointerdown — the push-tuning numbers are inline. --> DEFERRED: they are the
  approved study's tuning, carried verbatim.
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html frame() | BRANCH | A repaint drops the light under a still pointer | FIXED | 4ababc9 |
| 2 | 1 | NIT | render-gold-buttons-4059.js G3b | BRANCH | The disabled arm cannot fail | FIXED | 4ababc9 |
| 3 | 1 | NIT | render-gold-buttons-4059.js | BRANCH | No count assertion | FIXED | 4ababc9 |
| 4 | 1 | NIT | web/index.html goldLightState | BRANCH | The test hook is global | DEFERRED | Read-only |
| 5 | 1 | NIT | web/index.html webglcontextlost | BRANCH | Off until reload | DEFERRED | Fail-safe |
| 6 | 1 | NIT | web/index.html goldOf | BRANCH | A style read per move | DEFERRED | Not a measured cost |
| 7 | 1 | NIT | web/index.html size() | BRANCH | One FBO checked | DEFERRED | Uniform format |
| 8 | 2 | NIT | render-gold-buttons-4059.js G2 | BRANCH | .cpost shapes not measured | DEFERRED | 33px vs 34px |
| 9 | 2 | NIT | web/index.html frame() | BRANCH | Inline tuning numbers | DEFERRED | Study tuning |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] goldLightState is global (iteration 1)
- [NIT] webglcontextlost is permanent (iteration 1)
- [NIT] getComputedStyle per move (iteration 1)
- [NIT] checkFramebufferStatus covers one target (iteration 1)
- [NIT] .cpost contrast not asserted (iteration 2)
- [NIT] inline tuning numbers (iteration 2)

### Strengths (across all iterations)
- One shared WebGL canvas, justified against the browser's cap on live WebGL contexts, with the reason given in
  the code and the plan (iterations 1 and 2)
- G4 proves the clip by painting the canvas solid (iteration 1)
- G2 measures contrast from rendered pixels with the label hidden (iteration 1). Its CSS comment arithmetic was
  recomputed independently and matched (iteration 2)
- The gold-edge tests check intent and keep their inverting controls (iterations 1 and 2)
- Surfaces that are not gold opt out through one --gold-light property (iterations 1 and 2)
