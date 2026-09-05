---
pre_challenge: true
method: challenge-loop
branch: fix-2187-connect-box
diff_hash: f5df1fc49bb7a8722057f5228583e7423583f8688edbe7a57d57c7849bc737e1
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T07:10:00Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (pre-rebase: 6.0 baseline + 3 blind reviews; post-rebase re-run: 6.0 baseline + 1 blind review, re-converged)
**Converged:** Yes
**Total findings:** 6 (1 BLOCKER, 1 WARNING, 1 CONVENTION, 3 NITs)
**Fixed:** 4 | **Deferred:** 3 (1 CONVENTION + 2 NITs) | **Asked:** 0

**Note on the re-run.** The branch was rebased onto origin/main (which had advanced) to resolve a conflict on `tools/browser-checks.sh` - the recurring `for n in` check-list line, union-resolved to keep both `render-worlds-switcher-1704` (origin/main) and `render-firstrun-connect-box-2187` (this branch). The rebase changed the merge-base, invalidating the prior proof's diff_hash, so the loop was re-run. My 4-file feature diff is byte-unchanged from the pre-rebase converged state; the post-rebase blind review found zero NEW findings (only the already-deferred plan-file CONVENTION and the two already-deferred NITs), and validation passed clean (hash c6c23851a796). The hermetic browser-check passes 10/10 on the rebased tree and is proven RED (8/10 box arms) against the pre-fix page.

### Per-Iteration Breakdown

#### Iteration 1 (pre-rebase, 6.0 initial validation)
Clean baseline. One `test-cut-guard.sh` failure under contention (0.6.31 release had just wound down; live board + load 3.27); reran it alone → 0 failures; my diff touches nothing near the cut guard. Not a defect.

#### Iteration 2 (pre-rebase, blind review 1)
**New findings:** 1 CONVENTION, 3 NITs
- [CONVENTION] .claude/plans/ - No plan file --> DEFERRED (single-CSS-rule night-shift build; documented on card + commit + check docblock)
- [NIT] check comment: isGold tolerance rationale inaccurate --> FIXED (7bc19c53)
- [NIT] check header: overclaimed forced-light coverage --> FIXED (7bc19c53)
- [NIT] web/index.html: gold literal could drift from .fr-confirm --> DEFERRED (by design, cross-referenced in comment)

#### Iteration 3 (pre-rebase, blind review 2)
**New findings:** 1 BLOCKER, 1 WARNING, 1 NIT (+ dup CONVENTION)
- [BLOCKER] render-firstrun-connect-box-2187.js - check expected an external board (http://127.0.0.1:4399) the `for n in` loop never starts; would have gone RED in the gate, only passed against a hand-started board --> FIXED (cc2b1247): converted to hermetic file:// load (drives client-side painters only, reads computed style, no /api). Verified 10/10 hermetic + RED (8/10) against pre-fix.
- [WARNING] browser-checks.sh + README.md - wiring prose described the self-booting shape the check did not have --> FIXED (cc2b1247)
- [NIT] web/index.html - box wraps every connect phase incl. `stuck`/error --> DEFERRED (intentional/consistent; gold IS the pack's attention treatment; error rows keep their own red glyph)

#### Iteration 4 (pre-rebase, blind review 3)
**New findings:** 0. Converged - 5 STRENGTHs.

#### Iteration 5 (post-rebase re-run: 6.0 baseline + blind review)
6.0 validation passed clean (hash c6c23851a796). Blind review found **0 NEW findings** - only the already-deferred plan-file CONVENTION and the two already-deferred NITs (box-every-phase, hardcoded-literal drift). Confirmed the browser-checks.sh rebase union is intact (both checks present exactly once) and the hermetic-wiring BLOCKER stays resolved. Re-converged.

#### Iteration 6 (plan-file backfill + blind review)
The pre-challenge-gate hook requires a plan file (not just this proof); a night-shift direct build had none, so `fix-2187-connect-box-20260905T0146.md` was backfilled documenting the design. Blind review found ONE new CONVENTION: this proof file itself contained literal em dashes (my prose, not the code) - stripped with perl. The two NITs re-raised were already-deferred dups. The plan file changed the diff_hash to f5df1fc4 (it is INCLUDED in the hash; the proof is not).

#### Iteration 7 (final blind review)
**New findings:** 0. Converged. No BLOCKER/WARNING/CONVENTION; two non-blocking NITs, both already-deferred (box-every-phase; isGold tolerance width, where the comment already names the r>g>b hue ordering as the real discriminator). Confirmed NO em dashes in any changed file (all five spellings checked) and the wiring is complete.

### Validation basis for the final tree
The last full-suite validation ran CLEAN on the code at hash c6c23851a796 (iteration 5). The only change since is the docs plan file `.claude/plans/fix-2187-connect-box-20260905T0146.md`. The one test that reads `.claude/plans/` (`no-brand-refs-1881.test.js`) explicitly EXCLUDES that prefix (EXCLUDED_PREFIXES) and was re-run directly here (4/4 pass), so the plan file is invisible to the suite - the four code files are byte-unchanged from the c6c238 clean run. A fresh full-suite re-run was not possible at finalize time (the 0.6.32 release cut held the machine claim, and forcing past it risks corrupting that release); CI provides the authoritative server-side re-validation on the exact tree. `subdir_audit` passed clean (no changed subdir CLAUDE.md files).

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 2 | CONVENTION | .claude/plans/ | No plan file for this branch | DEFERRED | Single-CSS-rule night-shift build; documented on card + commit + check docblock |
| 2 | 2 | NIT | render-firstrun-connect-box-2187.js | isGold tolerance rationale inaccurate | FIXED | 7bc19c53 |
| 3 | 2 | NIT | render-firstrun-connect-box-2187.js | header overclaimed forced-light coverage | FIXED | 7bc19c53 |
| 4 | 2 | NIT | web/index.html | gold literal could drift from .fr-confirm | DEFERRED | By design; matches sibling, cross-referenced in comment |
| 5 | 3 | BLOCKER | render-firstrun-connect-box-2187.js | check expected an external board the loop never starts | FIXED | cc2b1247 (file:// hermetic) |
| 6 | 3 | WARNING | browser-checks.sh / README.md | wiring prose described a shape the check did not have | FIXED | cc2b1247 |
| 7 | 3 | NIT | web/index.html | box wraps every connect phase incl. error state | DEFERRED | Intentional, consistent, documented |

### NITs (non-blocking, across all iterations)
- Gold literal drift risk vs .fr-confirm (iter 2) - deferred, matches sibling by design
- Box wraps every connect phase incl. `stuck` (iter 3) - deferred, intentional/consistent

### Strengths (across all iterations)
- CSS minimal and cascade-safe: `:not(:empty)`/`:empty` mutually exclusive at `(0,2,1)`, no competing `#fr-sub` rule; `#fr-sub-msg` error sibling untouched; action buttons in the sticky footer
- The `:empty` guard matches behavior (every not-connected repaint sets innerHTML=''), and the empty control is a genuine discriminator
- Browser check non-vacuous: checkrow real-size asserted before any style arm; drives the page's own painters; nulls FR_CONN_LAST so the setup arm repaints
- Hermetic after the BLOCKER fix: loads file://, boots no server, correctly placed in the no-URL loop; runs chromium + webkit
- Rebase union intact: both render-worlds-switcher-1704 and render-firstrun-connect-box-2187 present exactly once
- Conventions clean: no em dashes; accurate theme reasoning; README indexed
