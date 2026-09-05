---
pre_challenge: true
method: challenge-loop
branch: worlds-ui-1704
diff_hash: e800618a1c28fbb3bde637a71e6b0e41761abf7280f7a42330d8e4723799e4ef
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T06:13:00Z
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12 (7 pre-rebase; 3 confirming passes across three rebases; 2 more after a
4th rebase onto a fast-moving release-night main)
**Converged:** Yes (the final blind pass returned zero BLOCKER/CONVENTION and only documented,
iteration-independent deferrals + one plan-doc count fix)
**Total findings across the run:** 1 suite failure, 8 WARNINGs, 1 CONVENTION, plus NITs
**Validation:** full `tools/run-tests.sh` PASSED on a clean committed tree, hash e800618a1c28
(matches the shipped diff exactly). One earlier red was proven contention (a foreign
`test-install.sh` harness held the install-gate port; `tools.release-gate.test.js` passes 22/22
alone), not a defect in this change.

A substantial new feature: a header switcher (list) + a create modal + async wiring. The loop
found a genuine defect on nearly every pass; the branch was rebased four times as main moved
under it (the `browser-checks.sh` runner loop is a conflict magnet), and the box was reserved
for the 0.6.31 cut mid-way, so validation waited for the cut rather than contending with it.

### Findings fixed (across iterations)
- Suite failure: the new `#world-add-modal` was not in the modal-Escape table --> registered it.
- [WARNING] menu semantics on inert rows --> read-only `role="list"`/`listitem` + `aria-current`.
- [WARNING] Enter double-submit --> gated on `!go.disabled`, like the click path.
- [WARNING] `aria-haspopup="true"` advertised a menu for a read-only list --> dropped it.
- [CONVENTION] `#world-add-modal` declares `aria-modal` but had no focus trap --> added the trap
  entry, verified by a boundary arm proven to red without it.
- [WARNING] the focus-trap check arm was VACUOUS --> re-aimed at the boundary (Tab off the last
  enabled control must wrap in), proven-red without the trap.
- [WARNING] the POST error handler read `body.error` but the server returns `{ because }` -->
  read `body.because || body.error` + a duplicate-name error-path arm proven-red if reverted.
- [WARNING] (rebase) a `render-firstrun-enter-2186` comment block was duplicated by a rebase
  resolution --> removed the duplicate; each check's comment now appears exactly once.
- [WARNING] (post-4th-rebase blind pass) a successful create closed the modal but left the new
  Kosmos invisible: the menu was closed and the active header name does not change (switch is
  deferred to 2b). This broke the app's create convention (New project / New task both give
  visible feedback and land the item in a visible list). FIXED: added a symmetric `worldswOpen()`
  and call it after the refetch so the menu re-opens with the new Kosmos in the list. The
  browser-check gains a "menu re-opens after create" arm, proven to red without the fix (the row
  arm alone cannot see it -- `querySelectorAll` finds rows in a hidden menu).
- [trivial] plan file said "13/13 PASS"; the check now has 14 arms --> corrected to 14/14.

### Deferred, with reasoning (genuine non-issues, iteration-independent)
- [WARNING] refetch-failure after a successful create (if the post-create GET blips, the new
  world is invisible with no message). DEFERRED: the code matches the app's own established
  create convention exactly (`New task`: close-then-reload), which carries the identical
  theoretical gap and ships fleet-wide. On a loopback same-process server a GET failing
  microseconds after a successful POST requires the server to die between two requests (at which
  point nothing works); even then no data is lost -- the world exists and appears on the next
  refetch/menu-open, and a retry gets a clear "already exists" message. "Fixing" it would make
  this switcher diverge from every other create in the app.
- [WARNING] the disclosure menu does not close on focus-out. DEFERRED: this is standard APG
  disclosure behavior (a disclosure button + `role="list"`, deliberately not a `menu`). Closing
  on focus-out would be non-standard and would fight the slice-2b row focus.
- [NIT] two comments say "opening a menu of the person's Kosmoses" while rows are a `role="list"`.
  DEFERRED: cosmetic; "menu" is defensible for the popover container (it holds the actionable New
  Kosmos button); the ARIA and JS are honest.
- [NIT] single-world install shows the switcher. DEFERRED: deliberate design (promote the name).

### Strengths (confirmed across passes, adversarially)
- No XSS: world names reach the DOM via `textContent`/`createElement` only; no `innerHTML`.
- Double-submit closed on both Enter and click paths; error path re-enables, success path leaves
  disabled and `worldAddOpen()` resets it.
- The create modal has the real focus trap it declares; the trap filters disabled stops and wraps
  in both Tab directions. Two new check arms (trap boundary, duplicate-name error path) are
  proven to red when their code is reverted.
- Event ordering: the create-button handler suspends at `await fetch` before its click finishes
  bubbling, so the outside-click handler no-ops (menu hidden) and the re-open lands a macrotask
  later with no pending click to close it.
- `[hidden] { display:none !important }` beats the switcher's `display:inline-flex`, so it stays
  hidden until `worldsFetch` shows it, and the consolidated-view rule hides it after load.
- Degrades to today's header on a board with no `/api/worlds` route; the deferred switch is honest
  (read-only list, no dead affordance); the browser-check self-boots a throwaway registry so the
  real POST never touches a live one.
