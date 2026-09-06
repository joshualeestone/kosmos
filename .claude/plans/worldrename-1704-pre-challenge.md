---
pre_challenge: true
method: challenge-loop
branch: worldrename-1704
diff_hash: d54317322468c0a83ec0a2fe757ae6f0cac76fd43612b1d1c870320b36501915
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T09:50:00Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (converged: the blind review found 0 BLOCKER/WARNING/CONVENTION, 1 cosmetic NIT, 6 STRENGTHs)
**Converged:** Yes
**Total findings:** 1 NIT (+ 1 baseline synthetic) | 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Fixed:** baseline + 1 NIT | **Deferred:** 0 | **Asked:** 0

### Baseline (6.0)
- Synthetic: adding `#world-rename-modal` tripped `web.modal-way-out-1316` (a new modal must be
  swept + registered with an Escape way-out) --> FIXED (80ed8b35): bumped the count ceiling 14->15
  and registered world-rename-modal in ESCAPES_VIA (its Escape is the first branch of the switcher
  keydown listener -> worldRenameClose; plus Cancel + backdrop). The guard did its job.

### Iteration 1
**New:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 1 NIT (+ 6 STRENGTH) --> CONVERGED
- [NIT] render-worldrename-1704.js: comments / the captured-call variable / the success log said
  "PUT" but the route + matcher correctly use POST --> FIXED (feff73e3): cosmetic, POST throughout.

### Final Ledger
| # | Iter | Cat | Item | Status |
|---|------|-----|------|--------|
| 0 | 6.0 | synthetic | new modal not registered in modal-way-out sweep | FIXED 80ed8b35 |
| 1 | 1 | NIT | render check said PUT, route uses POST | FIXED feff73e3 |

### Outstanding questions (ASKED)
None.

### Strengths (blind review, iteration 1)
- The core safety claim holds under scrutiny: renameWorld mutates only `world.name`; id/base are
  never recomputed and the name is never fed into a path join, so id/base/data are provably immutable
  across a rename (worldBaseDir resolves strictly by the immutable id). A new name whose safeKey would
  collide with another world's id is harmless. The engine test proves the same data dir after rename.
- Default-not-renamable is double-guarded (renameWorld refuses ERESERVED; readRegistry independently
  re-forces DEFAULT_NAME; the UI omits the cog on the default row).
- Route classification faithfully mirrors POST /api/worlds/active (typed-code dispatch; missing-id 400;
  worldBase() failure 500 without leaking internals; parse failure 400; lock rides withRegistryLock).
- UI structurally correct: the cog is a true sibling of the row (no nested buttons), stopPropagation on
  the cog, XSS-safe (textContent + aria-label, never innerHTML), Escape ordering puts the rename modal
  topmost, disabled-button/Enter/backdrop/WORLD_RENAME_ID lifecycle mirror the create flow, a11y present.
- The entry-wrapper does not regress render-worlds-switcher-1704 or render-worldswitch-2238 (both still
  pass; they use class/descendant selectors, preserving #2238/#2154 active-div-vs-button semantics).
- Verification thorough + honest: engine test (5, incl. a control), server route test, hermetic render
  check (red-capable, SKIPs without playwright, quotable emit), reason-grep counts bumped 52->53/30->31.

### Visual-fidelity limit (honest)
The UI wiring is verified structurally (computed DOM + a driven click/submit), not pixel layout. A
headed pass should confirm the cog reads right on the row (placement, the gear glyph rendering) and the
modal looks right -- same limit as #2282/#2326, though this feature is far more mechanical (a standard
modal + a per-row button) than #2282's layout restructure. Not launch-blocking; a future cut.
