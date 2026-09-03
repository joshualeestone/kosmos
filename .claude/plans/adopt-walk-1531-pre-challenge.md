---
pre_challenge: true
method: challenge-loop
branch: adopt-walk-1531
diff_hash: beabd2ae70d28475e704264cdaaee028da67c7dbf9ebd5b505d8373d40a267f4
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T11:45:48Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 produced zero NEW actionable findings; its sole
finding deduplicated to the NIT accepted in iteration 1)
**Total findings:** 1 WARNING, 2 NITs
**Fixed:** 1 WARNING + 1 NIT | **Accepted/documented residual:** 1 NIT

The change (kosmos#1531, the remaining step the card names): a committed HEADLESS
browser check, `docs/browser-checks/render-adopt-1531.js`, that drives the real
`.fr-adopt` adopt-prompt handlers against mocked HTTP routes and asserts the
card's close criterion (a folder with no instruction file is adopted under a
TYPED name and registers) plus Mona Lisa's load-bearing copy points. Wired into
`tools/browser-checks.sh` on the first-run board `render-found-undo` already
boots (no new board), indexed in the README, reason-grep site count 30->31.
Both iterations verified LIVE: 12/12 green against a sandboxed board, and the
register arm reds under a forced-refusal (`/api/connect-agent` -> 400)
perturbation while the posted-body arm still passes -- proving the control is
real and that "posted the right request" and "actually registered" are separated.

### Per-Iteration Breakdown

#### Iteration 1 -- 1 WARNING, 2 NITs
- [WARNING] tools/browser-checks.sh (boot-failure else-list) -- the else-list in
  the B8 block was missing checks that are `run_one` in the same block
  (render-scan-board, and after the first commit, still render-first-run and
  render-boot-no-flash). --> FIXED: the else-list now mirrors every run_one in the
  block member-for-member, so a $P8 boot failure reports each as failed. Bounded
  severity (the else already reds the gate); this is reporting completeness, and
  it is the "fix the class, not the instance" miss on the exact line being edited.
- [NIT] render-adopt-1531.js (reachability probe) -- page.evaluate does not
  auto-scroll the way page.click does, so elementFromPoint could false-FAIL (never
  false-pass) if a layout change pushed the adopt row below the viewport. --> FIXED
  with scrollIntoViewIfNeeded before the probe.
- [NIT] render-adopt-1531.js (broad "no console errors" arm) -- collects all
  non-avatar console errors, matching sibling render-found-undo. --> ACCEPTED and
  documented: it cannot false-PASS (only false-FAIL), the clean run is green, the
  transient /api/status 500s appeared only under perturbation (not the gate path),
  and narrowing it would risk masking a real page error. run_one's retry-once
  mitigates flake.

#### Iteration 2 -- CONVERGED (zero new actionable)
An independent, blind reviewer booted a sandboxed board, ran the check live
(12/12), and ran the forced-400 perturbation (register arm redded, posted-body
arm held). It confirmed: no assertion can false-pass (every `.catch(()=>null)`
feeds an assertion that rejects null; the two waitFor `.catch(()=>{})` are each
followed by a fresh DOM read that fails on the un-transitioned state); the
empty-name arm proves NO network call via a real counter; typed-vs-registered are
correctly decomposed; decline proves the right folder on both body and DOM with
no cross-row contamination; route globs do not collide; selectors match the real
markup; the else-list now mirrors the block member-for-member; 18/18 guard
assertions pass; no em dashes in any of the five spellings.
- [NIT] the same broad console-errors arm -- deduplicates to the iteration-1
  accepted residual. No new action.

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | WARNING | tools/browser-checks.sh | else-list missed run_one members of its block | FIXED (mirrors member-for-member) |
| 2 | 1 | NIT | render-adopt-1531.js | elementFromPoint viewport-dependent (fails safe) | FIXED (scrollIntoViewIfNeeded) |
| 3 | 1 | NIT | render-adopt-1531.js | broad "no console errors" arm | ACCEPTED (matches sibling; clean run green) |
| 4 | 2 | NIT | render-adopt-1531.js | broad console-errors arm (re-raised) | DEDUP of #3 |

### Strengths (verified live, both iterations)
- The register arm is non-vacuous: it reds under a forced `/api/connect-agent` 400
  while the posted-body arm still passes, so a build that posts correctly but fails
  to register is caught.
- The empty-name arm proves a refusal happens BEFORE the network, via a real
  per-route call counter, not a message check.
- The mock returns 200 only for `dir === ADOPT_DIR && name.length > 0`, so a
  misaddressed or nameless write cannot pass either the body arm or the DOM arm.
- Wired so a genuine failure reds the gate (run_one -> FAILED -> exit 1) AND is
  reported by name with a quotable reason.

### Validation
- `node --test browser-checks-indexed.test.js browser-checks-selectors.test.js
  browser-checks-reason-grep.test.js tools.browser-checks-wired.test.js` -> 18/18 pass.
- `bash -n tools/browser-checks.sh` -> clean.
- Live: 12/12 green headless against a sandboxed board; register arm reds under
  perturbation; temp perturbation file removed, tree clean.
- No web/ change, so the #1720 browser-check CI gate needs no trailer.
