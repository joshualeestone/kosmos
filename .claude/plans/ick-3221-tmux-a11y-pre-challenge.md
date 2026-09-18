---
pre_challenge: true
method: challenge-loop
branch: ick-3221-tmux-a11y
diff_hash: 6e955d21145f93b3fe82ffdb05a6fa6c3b9362017acdd7788c4c454e99a34685
validation: passed
subdir_audit: passed
timestamp: 2026-09-18T23:40:46Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 found no BLOCKER/WARNING/CONVENTION)
**Total findings:** 13 (1 BLOCKER, 5 WARNINGs, 1 CONVENTION, 6 NITs)
**Fixed:** 11 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 3 WARNINGs, 1 CONVENTION
**Self-generated:** 0 of the above (ITER_COMMITS empty on the first review)
- [BLOCKER] web/index.html frFireTmuxA11yRegister -- register-at-S3-entry reintroduces #3113's
  documented-rejected approach (entry-fire orphaned Playwright -> render-gated-next networkidle
  hang) --> FIXED (ca01e3d7): re-measured, does NOT reproduce (render-gated-next 3/3 +
  render-permission-slider 1/1 green with the entry-fire; served endpoint answers fast);
  additionally MOCK /api/tmux-a11y-prompt in both S3-gate checks so it can never orphan; stale
  server.js endpoint comment + fix-3113 plan corrected with a SUPERSEDED breadcrumb.
- [WARNING] server.js:8556,8564 -- stale "Turn On fires /api/tmux-a11y-prompt" comments --> FIXED (ca01e3d7)
- [WARNING] web/index.html:45112 -- frPollGates comment claims Turn On fires the register --> FIXED (ca01e3d7)
- [WARNING] web/index.html -- fast-click/slow-register empty-pane window not closed --> DEFERRED:
  register-up-front strictly REDUCES the window vs any Turn-On-fire design; the deep-link always
  opens the pane (never a dead button); closing it fully needs a Turn-On spinner Josh explicitly
  did not want (#3113's whole point). Old design had the same-or-worse race.
- [CONVENTION] .claude/plans/ick-3221-tmux-a11y.md -- 5 em dashes (house rule) --> FIXED (ca01e3d7)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 1 WARNING, 1 NIT
**Self-generated:** 0 of the above (both on pre-existing/adjacent lines, BRANCH)
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] server.js:8578-8593 -- a contiguous continuation of the tmux-a11y-status comment block
  still asserted "Turn On grants/registers tmux" (iteration 1 fixed the adjacent lines but left
  this stale, so the block contradicted itself) --> FIXED (1485de6a)
- [NIT] click-first-run.js:418,658 -- pre-existing S3 sections fire the entry register unmocked
  (harmless, but inconsistent with the render-* checks) --> FIXED (1485de6a): mock it there too.

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 2 NITs
**Self-generated:** 1 of the above (the cosmetic-wrap NIT sat on a line iteration 1 had rewrapped
  -> blame SELF; a reflow, not a false prose claim, so fixed by tidying the wrap)
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] engine/promptrequest.js:51-53 -- a THIRD copy of the stale "fired by Turn On, not entry"
  claim, in the tmux-a11y REQUEST_FILE doc comment (missed by the whole-file pass on server.js /
  web.html) --> FIXED (98d510ea)
- [WARNING] click-first-run.js / web.firstrun-a11y-1214.test.js -- the unlatch-on-failure retry path
  was untested (no test mocked {ok:false} then confirmed a later S3 entry retries) --> FIXED
  (98d510ea): added a browser-check section (failed register -> unlatch -> retry on re-entry via
  frGo(1)->frGo(3)) with a SUCCESS control so it cannot pass vacuously. Verified on a booted board.
- [NIT] web/index.html:45110-45116 -- the edited comment wrapped awkwardly mid-sentence --> FIXED (98d510ea)
- [NIT] native-app/main.swift -- same stale claim, but OUT OF SCOPE (native = Angel's #3274) -->
  DEFERRED: flagged for the joint #3274 merge; not a defect of this client-half PR.

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** -- no new actionable findings. 5 STRENGTHs recorded (latch race-free, fire-and-forget
  rejection-safe, unlatch tests non-vacuous with a success control, comprehensive stale-comment
  cleanup verified by full-file grep, test assertions pinned to the shipped code).
- [NIT] .claude/plans/ick-3221-tmux-a11y.md -- Tests section said "4 arms" (now 7 + controls) -->
  FIXED (eaca115f, plan-doc only)
- [NIT] web/index.html:45407 -- the register fire is deliberately status-independent; worth an
  explicit design-note line --> FIXED (eaca115f, added the note; no code change)

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html frFireTmuxA11yRegister | BRANCH | entry-fire reintroduces #3113-rejected approach | FIXED | ca01e3d7 (re-measured + mock + docs) |
| 2 | 1 | WARNING | server.js:8556,8564 | BRANCH | stale Turn-On-fires-register comments | FIXED | ca01e3d7 |
| 3 | 1 | WARNING | web/index.html:45112 | BRANCH | frPollGates stale comment | FIXED | ca01e3d7 |
| 4 | 1 | WARNING | web/index.html | BRANCH | fast-click/slow-register empty-pane window | DEFERRED | strictly better than old; deep-link always opens pane; spinner unwanted |
| 5 | 1 | CONVENTION | .claude/plans/ick-3221-tmux-a11y.md | BRANCH | 5 em dashes | FIXED | ca01e3d7 |
| 6 | 2 | WARNING | server.js:8578-8593 | BRANCH | stale continuation of the comment block | FIXED | 1485de6a |
| 7 | 2 | NIT | click-first-run.js:418,658 | BRANCH | mock the entry register for hermeticity | FIXED | 1485de6a |
| 8 | 3 | WARNING | engine/promptrequest.js:51-53 | BRANCH | 3rd stale copy of the claim | FIXED | 98d510ea |
| 9 | 3 | WARNING | click-first-run.js / web.firstrun-a11y-1214.test.js | BRANCH | unlatch-on-failure retry untested | FIXED | 98d510ea (test added + verified) |
| 10 | 3 | NIT | web/index.html:45110 | SELF | awkward comment wrap (reflow) | FIXED | 98d510ea |
| 11 | 3 | NIT | native-app/main.swift | BRANCH | same stale claim, out of scope | DEFERRED | flagged for the joint #3274 merge |
| 12 | 4 | NIT | .claude/plans/ick-3221-tmux-a11y.md | BRANCH | Tests section drift ("4 arms") | FIXED | eaca115f |
| 13 | 4 | NIT | web/index.html:45407 | BRANCH | status-independent fire needs a design note | FIXED | eaca115f |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- click-first-run.js pre-existing S3 sections unmocked (iteration 2) -- fixed.
- web/index.html:45110 awkward comment wrap (iteration 3) -- fixed.
- native-app/main.swift stale claim (iteration 3) -- out of scope, flagged to Angel for #3274.
- plan Tests-section drift + status-independent design note (iteration 4) -- fixed.

### Strengths (across all iterations)
- The shared `s3PermissionTargets` map stays the single source of truth for both the `.s3-on` Turn
  On and the `.s3-sw-open` mock-switch overlay, so trigger:null cannot regress one path while
  fixing the other (iters 1, 3, 4).
- The once-per-session latch is set synchronously before the await (race-free double-fire guard)
  and unlatches on failure so a transient failure retries rather than stranding tmux (iters 2, 3, 4).
- The new click-first-run sections are non-vacuous (real request counters, before/after a real
  click, plus a success control for the unlatch test) (iters 1, 2, 3, 4).
- The #3113 "entry-fire rejected" note was re-measured rather than assumed, and the fix does not
  rest on "does not repro" -- the two S3-gate checks were given a mock as belt-and-suspenders (iters 3, 4).
