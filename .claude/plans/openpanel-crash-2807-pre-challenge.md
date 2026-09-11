---
pre_challenge: true
method: challenge-loop
branch: openpanel-crash-2807
diff_hash: 3d93a9c4cc0fb037529c93fbf6db6cf7ccac9e9f736f6be2c3c2fc2292f6a9fd
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T17:15:06Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (blind reviewer passes; 6.0 initial validation passed clean)
**Converged:** Yes (iteration 3 found zero NEW BLOCKER/WARNING/CONVENTION)
**Total findings:** 12 (1 BLOCKER, 4 WARNINGs, 1 CONVENTION, 6 NITs)
**Fixed:** 9 | **Deferred:** 3 | **Asked (awaiting user):** 0

Priority prod crash (#2807), high scrutiny. Reviewer model varied across iterations
(kosmos#2032): opus -> sonnet -> opus. All findings classified Origin BRANCH: the
loop's own fix commits (dbdddf7b, c6ba6723, 59b56877) introduced nothing a later
pass flagged as actionable, so zero self-generation (kosmos#120).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 (ITER_COMMITS empty on the first review; 6.0 passed clean)
- [WARNING] native-app/main.swift -- `host.attachedSheet == nil` is not the COMPLETE
  predicate for a non-dropped beginSheetModal (a miniaturized host, or a
  mid-dismissal-animation window, could still drop it and re-crash). --> FIXED
  (dbdddf7b): close the whole abort class instead of the one instance -- present
  with the app-modal `panel.begin` UNCONDITIONALLY (no window dependency; always
  presents + answers). Removes the host/attachedSheet branching.
- [WARNING] tools/build-kosmos-bundle.sh -- the selftest's stdout is block-buffered
  through the gate's `$(...)` pipe, so a regression that ABORTS loses its arms and
  the gate misattributes the failure to itself ("product NOT implicated"). --> FIXED
  (dbdddf7b): `setvbuf(stdout, nil, _IONBF, 0)` at the hatch start so each arm
  survives an abort; added `press:with-a-sheet-up` to the gate `_fp_want` + the gate
  test's GOOD fixture.
- [CONVENTION] .claude/plans/openpanel-crash-2807.md -- two em dashes. --> FIXED
  (dbdddf7b).
- [NIT] native-app/main.swift -- a future off-main openPanelPresenter would race the
  call-once flag. --> DEFERRED: product-safe (presenter is nil in prod; test-only
  seam), left to avoid a thread-safety caveat on a non-shipping path.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 NIT
**Self-generated:** 0 (cited lines blame to pre-loop commits, not to dbdddf7b)
- [BLOCKER] tools/build-kosmos-bundle.sh -- the #2807 selftest arm's setup control
  printed "press:with-a-sheet-up<tab>SETUP-FAILED..." when the host sheet had not
  attached within a fixed 0.5s wait (plausible on a busy build box). That line
  contains "press:", so the gate's product arm matched it and BLAMED THE PRODUCT for
  a flaky HARNESS setup -- the exact false-accusation the gate guards against for
  TIMED OUT. --> FIXED (c6ba6723): POLL for the sheet (30 x 0.1s) instead of a fixed
  wait; emit a distinct "filepanel selftest SETUP INCONCLUSIVE" token (not starting
  with "press:") if it never attaches; add a gate case (before the product arm)
  reporting it as harness/inconclusive; add a gate test guarding it.
- [WARNING] plan vs code -- the plan still described the conditional attachedSheet
  guard, but iteration 1 shipped unconditional `panel.begin`. --> FIXED (c6ba6723):
  rewrote the plan to match + documented the setvbuf hardening; fixed the stale field
  name.
- [WARNING] native-app/main.swift -- the re-entrant guard's comment justified itself
  via `beginSheetModal`, which the code no longer calls. --> FIXED (c6ba6723):
  reworded to state what the guard actually does (serialise one open panel at a time,
  refuse a second with a single nil answer), historical beginSheetModal noted as
  history; fixed the adjacent "sheet completions" phrase.
- [NIT] plan -- stale printed-field name. --> FIXED (c6ba6723).

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
**Converged** -- no new actionable findings. (STRENGTHs confirmed: exactly-once
invariant on every path; unconditional-begin class-closure; setvbuf correctness; the
poll-based selftest arm terminates + exits exactly once with cleanup on all paths and
is red-capable.)
- [NIT] native-app/main.swift -- the #2807 comment's "see the host guard further down"
  was stale (the host guard was removed for unconditional begin). --> FIXED (59b56877):
  reworded to point at the panel.begin presentation.
- [NIT] native-app/main.swift -- the whenReady budget comment said "the whole run is
  about 7s"; the new arm makes it ~11-12s. --> FIXED (59b56877): updated the figure.
- [NIT] native-app/main.swift -- the panel-presented sub-check could in principle match
  a residual panel from the real-presenter arm. --> DEFERRED: can only ever false-yes,
  never mask an abort (reaching the print at all is the no-abort proof), and ~7s + a
  cancel elapse first; optional hardening.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | native-app/main.swift | BRANCH | attachedSheet not the complete drop predicate | FIXED | dbdddf7b (unconditional begin) |
| 2 | 1 | WARNING | tools/build-kosmos-bundle.sh | BRANCH | selftest stdout buffered -> abort misattribution | FIXED | dbdddf7b (setvbuf + _fp_want) |
| 3 | 1 | CONVENTION | .claude/plans/openpanel-crash-2807.md | BRANCH | em dashes | FIXED | dbdddf7b |
| 4 | 1 | NIT | native-app/main.swift | BRANCH | off-main presenter race note | DEFERRED | test-only seam, product-safe |
| 5 | 2 | BLOCKER | tools/build-kosmos-bundle.sh | BRANCH | SETUP-FAILED (press:) false-accuses the product | FIXED | c6ba6723 (poll + inconclusive token + gate case + test) |
| 6 | 2 | WARNING | .claude/plans/openpanel-crash-2807.md | BRANCH | plan misdescribes unconditional begin | FIXED | c6ba6723 |
| 7 | 2 | WARNING | native-app/main.swift | BRANCH | re-entrant comment stale re beginSheetModal | FIXED | c6ba6723 |
| 8 | 2 | NIT | .claude/plans/openpanel-crash-2807.md | BRANCH | stale printed-field name | FIXED | c6ba6723 |
| 9 | 3 | NIT | native-app/main.swift | BRANCH | stale "see the host guard" cross-ref | FIXED | 59b56877 |
| 10 | 3 | NIT | native-app/main.swift | BRANCH | stale "whole run ~7s" figure | FIXED | 59b56877 |
| 11 | 3 | NIT | native-app/main.swift | BRANCH | panel-presented sub-check could match a residual panel | DEFERRED | false-yes only, never masks an abort |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- off-main presenter race note (iter1) -- deferred (test-only seam)
- stale plan field name (iter2) -- fixed
- stale "host guard" cross-ref (iter3) -- fixed
- stale "~7s" figure (iter3) -- fixed
- panel-presented residual-panel match (iter3) -- deferred (false-yes only)

### Strengths (across all iterations)
- The call-once `respond` wrapper closes both directions of WebKit's exactly-once
  invariant (blocks a double-call; every branch routes to exactly one completion),
  independent of `self`'s lifetime (completionHandler captured strong) -- verified no
  zero-call or double-call path on any production route (iterations 1, 3).
- Unconditional `panel.begin` closes the ENTIRE abort class rather than the one
  attached-sheet instance (iterations 1, 3).
- `setvbuf` is a subtle, correct fix so an aborting regression's arms survive the
  gate's pipe capture and are attributed correctly (iterations 1, 3).
- The `press:with-a-sheet-up` selftest arm exercises the REAL panel path, has a
  genuine setup control, terminates and exits exactly once with cleanup on every path
  (incl INCONCLUSIVE), is ordered before the gate's product arm, and is red-capable
  (proven by perturbation: reverting the begin presentation makes it report
  no-abort-and-panel-presented:no) (iterations 2, 3).
