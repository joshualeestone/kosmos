---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: project-settings-762
diff_hash: ea3915918e21bc811491ae360578894dec57dbc09001b4499f515cbc18f2bcdd
timestamp: 2026-08-25T06:49:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

Method note: two independent `/code-review medium` passes (not the
literal `/challenge-loop` skill), run in the same fix-then-reverify
shape that skill uses -- round 1 found real issues, they were fixed,
round 2 confirmed clean. Recorded as pre-challenge with explicit
override rather than mislabeled as challenge-loop.

**Iterations:** 2
**Converged:** Yes (round 2 found nothing new after round 1's findings were fixed)
**Total findings:** 7 (0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs, 1 stale-selector test breakage)
**Fixed:** 6 | **Deferred:** 1 (documented, see below)

### Round 1 (medium effort, 6 finder angles)

- [WARNING] `web/index.html` `.pj-minus` — 20x20px, below the 24x24 WCAG
  2.2 SC 2.5.8 floor the retired settings `.drop` button was
  specifically built to guarantee for "the only destructive control on
  the row." The settings screen was less accessible than before this
  PR on the exact control the deleted comment called out. --> FIXED
  (bumped to 24x24, both the base rule and the consolidated-view
  override).
- [WARNING] `web/index.html` `dropMember`'s target-selection ternary
  (`pj-settings-view.hidden ? pj-one-msg : msg`) only redirected one
  direction of a mid-flight navigation race; making `pjs-members-msg`
  reachable as the captured `msg` exposed the unhandled
  tab-to-settings direction (navigate INTO settings while a DELETE
  from the tab view is in flight; the verdict would land on the now-
  hidden `pj-one-msg`). --> FIXED (factored into `dropMemberTarget()`,
  resolved fresh by current visibility on every read, not carried from
  whichever element was passed at click time).
- [WARNING] `web/index.html` comment inside `pjMember()` ("Only the
  project page asks for it") was now factually wrong: the settings
  rows call it too. --> FIXED (comment updated to name both call
  sites).
- [NIT] The new settings "Add an agent" reveal-picker flow
  (`pjs-add-agent`/`pjs-add-row`/`pjs-add-pick-cancel`) duplicates the
  reveal/cancel/refocus shape New project's own door already has.
  DEFERRED: the two flows differ in what happens on selection (New
  project stages into `PJ_ADD_AGENTS`; settings POSTs immediately
  through the already-factored `addMemberToProject`), so a shared
  helper would cover only the reveal/cancel half. Real but lower
  priority than the WARNING-level correctness and accessibility
  findings above; left for a follow-up rather than widening this PR.
- [WARNING] `docs/browser-checks/render-projects.js` still measured
  the retired `#pj-settings-view .pj-member .drop` selector for
  contrast, which fails twice in the real harness ("the check cannot
  pass on a selector it never found") since the element no longer
  exists. --> FIXED (repointed at `#pj-settings-view .pj-member
  .pj-minus`; confirmed against the actual harness run, not just the
  source).
- [NIT] `paintFreeAgentPicker` now runs twice per poll tick while
  Project Settings is open (once via the unconditional
  `paintOneProject`, for the hidden tab-view select; once via
  `paintSettingsMembers`, for the visible one). DEFERRED: consistent
  with `paintOneProject`'s existing character (it already repaints the
  member list itself unconditionally every poll regardless of which
  sub-view is showing); singling out this one new call for a
  visibility gate would be an inconsistent partial fix, not a full
  one, and the actual cost is a small filter + string join, not an
  expensive operation.

### Round 2

Re-reviewed the round-1 fixes plus the render-projects.js selector
change. No new findings. Verified independently: unit suite 230/230,
full `tools/browser-checks.sh` page-gate green (including
`render-projects` and `render-pjsettings`, both of which exercise the
exact surfaces round 1 touched).
