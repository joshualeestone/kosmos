---
pre_challenge: true
method: challenge-loop
branch: goldbtn-4059
diff_hash: 51dca182ca52747ff86e9fc88d544d7146a2bea2559978f7c144c1618017fc92
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T11:52:33Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 blind reviewer passes (opus, sonnet, opus, sonnet, opus, sonnet), after the 6.0 pass
**Converged:** Yes, at iteration 6 (no new BLOCKER, WARNING or CONVENTION)
**Total findings:** 35 (0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 30 NITs), plus three CI reds and several validation reds
**Fixed:** 13 | **Deferred:** 22 NITs | **Asked (awaiting user):** 0

Iteration 2 converged first (on a1309be) and the PR was opened. CI's browser-checks then found three real reds.
The fixes changed code, so the loop continued (iterations 3 to 6) until it converged again on 5332e45.

### Validation runs (6.0 and 6g) and CI

- 6.0 at b4068c9: FAILED on 3 unit tests. Two gold-edge pins were pinned to the old flat-gold text; they now
  check the intent, with controls. The third, "the pre-rail grid rows are auto", was a real regression: the new
  script was a 39th direct child of the body and the layout has 38 rows. The script moved to the head (f2882e3).
- 6g #1 (f39930f): unit fail 0; FAILED on the surface-annotation lint (two CSS-variable tokens, which the gate
  can never fire on). Fixed in 4ababc9.
- 6g #2 (4ababc9): unit fail 0; FAILED on the surface gate #2518 (a comment said "grid"). Reworded in a1309be.
- 6g #3 (a1309be): PASSED. Proof written, PR #4311 opened.
- CI browser-checks on c09de03: FAILED on 3 real reds (below). Earlier I read an empty runnerName in the API as
  "no runner"; the job had run.
- 6g #4 (723640d): HUNG at 55 min in server.doorflight-1618.test.js under load 15-19; killed. That file alone
  gives 4/4. Killing it orphaned a real `vercel whoami`, which the test starts because it does not stub
  AGENT_WORKFORCE_VERCEL_BIN; filed by Splinter as #4326.
- 6g #5 (d4646a5): stopped. I edited the tree under it.
- 6g #6 (b15f7cc): FAILED, 32 of 10926 tests, all timeouts (15-44s) in 20 server/engine files at load 10-15.
  Each file rerun ALONE: 1172 pass, 0 fail. CI's full test job on b15f7cc passed. None of them is a page test.
- 6g #7 (5332e45, this diff): PASSED, 10926 pass, 0 fail (hash 51dca182ca52). It ran with
  AGENT_WORKFORCE_VERCEL_BIN=/usr/bin/false so the doorflight test could not start a real vercel (#4326).
- CI on 723640d and on b15f7cc: browser-checks, test and windows all PASS.

### CI reds after the PR opened (c09de03)

- contrast: dark "Post"/"Send"/"Save" measured 1.03:1. The checker reads background-color, which the gradient
  left transparent. FIXED f120ffb: each gradient ends in a solid gold layer that is never seen.
- render-agent-nav #4051: the tile outline is compared with the Post button's background-color. FIXED by the
  same change.
- render-dm-reply-4256 R13/R6c (the check I wrote for #4256, already on main): a "Sending…" row leaked in
  TALK_PENDING, about one run in three. FIXED 723640d: each scenario starts with nothing in flight. Control:
  with the second send's reply slowed to 1.5s, the old check fails exactly as CI did, every time, and the fixed
  one passes. This is its own commit and is noted in the plan and on #4256.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html frame() — a repaint of the lit button (the empty board's Create, every poll) drops
  the light under a still pointer --> FIXED (4ababc9, rehost(), G11). Control: red in WebKit without it.
- [NIT] render-gold-buttons-4059.js G3b — the disabled arm could not fail --> FIXED (4ababc9, enabled control)
- [NIT] render-gold-buttons-4059.js — no count assertion --> FIXED (4ababc9, EXPECTED)
- [NIT] web/index.html goldLightState — a global test hook --> DEFERRED: read-only, the page's hook pattern
- [NIT] web/index.html webglcontextlost — the light stays off until reload --> DEFERRED: a fail-safe; the CSS hover remains
- [NIT] web/index.html goldOf() — a style read per move --> DEFERRED: not a measured cost
- [NIT] web/index.html size() — one framebuffer checked --> DEFERRED: the targets share one format

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [NIT] render-gold-buttons-4059.js G2 — .cpost shapes not measured --> DEFERRED: 33px vs 34px
- [NIT] web/index.html frame() — inline tuning numbers --> DEFERRED: the study's tuning, carried verbatim
**Converged** on a1309be. The PR was opened, and CI reds reopened the work (above).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 7 NITs
**Self-generated:** 1 of the above (the rehost old-host restore, in 4ababc9's own code)
- [NIT] web/index.html rehost() — an old host still on the page is not restored --> FIXED (d4646a5, G11b). Control: red without it.
- [NIT] web/index.html .added — the Added state inherited the 999px pill; the plan says it keeps its own shape --> FIXED (d4646a5, --radius-control, G1c). Control: red (999px).
- [NIT] README row omits G11 --> FIXED (d4646a5)
- [NIT] diff-guarded innerHTML containers would repaint while a gold button hosts --> DEFERRED: latent; 0 sites wrap a gold button
- [NIT] G7/G8 "darkens" asserts a change, not the direction --> DEFERRED: G2 guards the floor
- [NIT] goto default 30s under load --> DEFERRED, then FIXED in b15f7cc (90s) after it bit
- [NIT] the dm-reply-4256 fix is out of scope --> KEPT: CI needs it; its own commit, recorded in the plan

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT
**Self-generated:** 0 of the above
- [WARNING] render-gold-buttons-4059.js G2 — contrast never measured with the light showing --> FIXED (b15f7cc, G2d:
  4.74 Chromium, 4.76 WebKit). Control: normal blend alone does NOT fail it (the canvas ground is transparent);
  a black light fails it at 1.16 and 1.34, so the arm reads lit pixels.
- [CONVENTION] .claude/plans/goldbtn-4059.md — does not mention the dm-reply-4256 rider --> FIXED (b15f7cc)
- [NIT] webglcontextlost is permanent --> DEFERRED (a duplicate of iteration 1)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 of the above (the README count, from d4646a5/b15f7cc)
- [WARNING] docs/browser-checks/README.md — the row said 76 and omitted G2d --> FIXED (5332e45)
- [NIT] the plan's done-means claimed more than is measured --> FIXED (5332e45)
- [NIT] the dm-reply README row --> FIXED (5332e45)
- [NIT] diff-guarded containers --> DEFERRED (a duplicate of iteration 3)
- [NIT] 0.5px transparent border shows a subpixel rim highlight --> DEFERRED: visual only, subpixel at 1x
- [NIT] .btn.uprime:focus-visible outranks .uchip's --> DEFERRED: the two ring colours are close in both themes
- [NIT] G2d does not assert dye is visible --> DEFERRED: the black-light control shows it reads lit pixels

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs (4 more were duplicates)
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved or deferred):** 4
- [NIT] FEEL has no rationale comment --> DEFERRED: the study's values
- [NIT] attach() detaches before its <4px bail-out --> DEFERRED: not a state the page produces
- [NIT] no CLAUDE.md "Where to Find Things" row --> DEFERRED: the convention does not trigger
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html frame() | BRANCH | A repaint drops the light | FIXED | 4ababc9 |
| 2 | 1 | NIT | render-gold-buttons G3b | BRANCH | The disabled arm could not fail | FIXED | 4ababc9 |
| 3 | 1 | NIT | render-gold-buttons | BRANCH | No count assertion | FIXED | 4ababc9 |
| 4 | 3 | NIT | web/index.html rehost() | SELF | Old host not restored | FIXED | d4646a5 |
| 5 | 3 | NIT | web/index.html .added | BRANCH | The Added state became a pill | FIXED | d4646a5 |
| 6 | 3 | NIT | README | SELF | Row omits G11 | FIXED | d4646a5 |
| 7 | 3 | NIT | render-gold-buttons goto | BRANCH | 30s load timeout | FIXED | b15f7cc |
| 8 | 4 | WARNING | render-gold-buttons G2 | BRANCH | No lit-state contrast | FIXED | b15f7cc |
| 9 | 4 | CONVENTION | plan | BRANCH | The rider was undocumented | FIXED | b15f7cc |
| 10 | 5 | WARNING | README | SELF | Count 76, no G2d | FIXED | 5332e45 |
| 11 | 5 | NIT | plan | BRANCH | The done-means overclaimed | FIXED | 5332e45 |
| 12 | 5 | NIT | README dm-reply row | SELF | No TALK_PENDING note | FIXED | 5332e45 |
| 13 | CI | WARNING | web/index.html tokens | BRANCH | background-color transparent (contrast, #4051) | FIXED | f120ffb |
| 14-35 | 1-6 | NIT | various | BRANCH | See the per-iteration notes | DEFERRED | reasons above |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- goldLightState global (1, 6); webglcontextlost permanent (1, 4); getComputedStyle per move (1, 6)
- checkFramebufferStatus on one target (1, 6); .cpost shapes not measured (2); inline tuning numbers (2, 6)
- diff-guarded containers (3, 5); the darkens direction (3); subpixel rim (5); uchip focus ring (5)
- G2d does not assert visible dye (5); FEEL comment (6); attach before its size bail-out (6); CLAUDE.md row (6)

### Strengths (across all iterations)
- One shared WebGL canvas under the browser's context cap, justified in the code and the plan (all iterations)
- G4 proves the clip by painting the canvas solid; G2 and G2d measure rendered pixels with the label hidden
- The loop stops on hide, removal, reduced motion and fade, each pinned with a control (G6, G7, G8)
- The gold-edge tests check intent and keep their inverting controls
- Surfaces that are not gold opt out through one --gold-light property
