---
pre_challenge: true
method: challenge-loop
branch: consolidated-white-bg-3264
diff_hash: 48468547d0626cf205c15c659a089f8ae530c5a0a8741ef5ef4786f7be65a80a
validation: passed
subdir_audit: passed
timestamp: 2026-09-18T14:50:10Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

kosmos#3264 (Josh, brand-owner, 2026-09-18): the CONSOLIDATED view's message ground must be
WHITE (`--k-surface`), matching the tab view. Verbatim: "the background is supposed to be white
just like it is on the tab view." This reverses the #980 iter-5 cream (`--k-bg`) tuning for the
consolidated layout only.

The change is three lockstep CSS flips in `web/index.html`, all scoped to the consolidated
layout so the tab view is untouched:
1. `html[data-layout="consolidated"] body.consolidated .pj3 > .pjmid` ground: `--k-bg` -> `--k-surface`.
2. `html[data-layout="consolidated"] body.consolidated .pjmid .composer` (the sticky composer #980
   repainted to `--k-bg` to hide the band): `--k-bg` -> `--k-surface`, kept as an explicit lockstep
   pin against future drift.
3. A new consolidated-scoped wing-carve override
   `html[data-layout="consolidated"] body.consolidated .pj3 > .pjmid .msg:not(.you) .msg-bd::after`:
   `--k-surface`, so no cream tail sliver shows on the white ground. The global
   `.msg:not(.you) .msg-bd::after` carve (used by the tab view) stays `--k-bg`, untouched.

**Iterations:** 2 (validation + 1 blind reviewer pass)
**Converged:** Yes (the blind pass found zero BLOCKER/WARNING/CONVENTION; 2 NITs + strengths)
**Total findings:** 0 actionable; 2 NITs; strengths noted
**Fixed:** 1 (NIT #2, selector scoping) | **Deferred:** 1 (NIT #1, kept as deliberate pin) | **Asked:** 0

### Validation

- New browser-check `docs/browser-checks/render-consolidated-white-3264.js` passes 6/6 in each of
  light and dark (12/12 total): the computed background of the consolidated `.pjmid` ground, its
  sticky `.composer`, and the wing-carve `::after` all resolve to `--k-surface` and are DISTINCT
  from `--k-bg`; a no-leak control confirms the NON-consolidated (tab) carve stays `--k-bg`. It
  pins the TOKEN, not an exact rgb, so a Josh retune of `--k-surface` stays green while a
  regression of any of the three back to `--k-bg` reds it.
- `browser-checks-indexed.test.js` passes: the new check is named in `docs/browser-checks/README.md`.
- `web.consolidated-867.test.js` passes (8 tests incl. the #2711 "tab-view dialog is white" pin,
  confirming no tab-view regression). Full node run: tests 8, pass 8, fail 0.

### Per-Iteration Breakdown

#### Iteration 1 (validation)
**Reviewer model:** n/a
The browser-check + index test + consolidated slice tests all PASSED on the tree (diff hash
48468547). The token-pinned assertions agree headed and headless.

#### Iteration 2 (blind review)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKER / 0 WARNING / 0 CONVENTION; 2 NITs; strengths
**Self-generated:** 0
**Converged.** The blind reviewer independently ran the browser-check (12/12 verified),
confirmed the tab-view-is-white premise from source (the tab `.pjcol` ground is `--k-surface`),
confirmed the assertions are non-vacuous (the two tokens are distinct in both themes), and
verified the override does not leak to the tab view. Zero actionable findings.

The two NITs and their disposition:
- **NIT (web/index.html composer override):** after this flip the consolidated `.pjmid .composer`
  override equals the base composer rule (`--k-surface`), so it is functionally redundant.
  DEFERRED: kept deliberately as an explicit lockstep pin. Mona's spec called to flip it, and an
  explicit `--k-surface` here keeps the composer pinned to the ground if a future change re-diverges
  the base. Reversible; keeping it is the conservative, spec-faithful choice.
- **NIT (web/index.html carve override):** the wing-carve override was scoped only via the
  html/body layout selectors, not via `.pj3 > .pjmid` like the other two flips; harmless today
  (`.msg-bd` only mounts under `.pjmid` in the consolidated layout) but "does not leak" was true by
  current-markup coincidence rather than by construction. FIXED: tightened to
  `.pj3 > .pjmid .msg:not(.you) .msg-bd::after`, matching the scoping of the ground and composer
  flips. Browser-check re-run green 12/12 after the tightening (both the consolidated carve = surface
  and the tab control = bg still hold).

**Strengths:** token-pinned (retune-safe) assertions; explicit no-leak control; light+dark coverage;
consolidated-only scoping keeps the tab view untouched; the load-bearing three-way coupling
(ground + composer + carve) is asserted together so a partial regression cannot pass.

### Convergence

Iteration 2 (the blind pass) returned zero BLOCKER/WARNING/CONVENTION findings. Per the
challenge-loop convergence rule, one iteration with zero actionable NEW findings after
deduplication and no unresolved ASKED findings = CONVERGED. The two NITs do not block (one fixed,
one deferred as a deliberate pin). No user decision was required; the loop finished on its own
authority.
