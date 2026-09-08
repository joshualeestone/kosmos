---
pre_challenge: true
method: challenge-loop
branch: provider-logo-combobox-1040
diff_hash: 49164c3034447b14f58b20bc1c0f2f3938c0d34a84e4d28af54669734a4d0124
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T19:13:40Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (converged at iteration 7)
**Converged:** Yes
**Total actionable findings:** 15 (4 BLOCKERs, 9 WARNINGs, 0 CONVENTIONs) + 1 synthetic 6g validation-fix, all FIXED
**Fixed:** 15 + 1 | **Deferred:** the NITs below | **Asked (awaiting user):** 0
**Reviewer models:** rotated opus / sonnet across iterations (1 opus, 2 sonnet, 3 opus, 4 sonnet, 5 opus, 6 sonnet, 7 opus), so convergence is witnessed by both models (kosmos#2032).
**Rebased** onto origin/main after convergence (Mona's #2492 + #2456 landed); clean rebase, full 6g + browser-check re-run green on the rebased HEAD.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 (first reviewer pass, ITER_COMMITS empty)
- [WARNING] web/index.html trigger — aria-label="Provider" REPLACED the button text, dropping the selected value from the accessible name (WCAG 4.1.2) --> FIXED: visually-hidden .vh label + aria-labelledby "<label> <trigger>"
- [WARNING] web/index.html gate/handler — trigger did not mirror select.disabled; the #d-provider change gate lacked the `e.target.disabled` clause its sibling has --> FIXED: wrap the disabled setter to sync the trigger + add the gate clause
- [WARNING] render-provider-combobox-1040.js:120 — the no-dispatch re-render assertion set the already-shown value (vacuous) --> FIXED: assign a value the trigger is NOT showing and assert it flips
- (6g validation-fix) web.runs-on-990.test.js pinned the gate expression verbatim and false-red'd on the strengthened gate --> FIXED: extract-the-gate + assert the three no-op conditions

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 2 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 (B1 was iteration 1's own added assertion)
- [BLOCKER] render-provider-combobox-1040.js — the "disabled control does not open" assertion used .click() on a disabled button (a spec no-op, could never fail) --> FIXED: test observable close-on-disable with a positive control
- [BLOCKER] render-provider-combobox-1040.js:70 — "closed shows selected label" reassigned the default anthropic (vacuous) --> FIXED: flip to a non-default value and back
- [WARNING] web/index.html providerMarkNode — cloned marks kept role=img/aria-label next to the visible name, doubling the accessible name --> FIXED: aria-hidden the decorative marks/chip
- [WARNING] web/index.html syncDisabled — disabling while open left a stale aria-expanded=true --> FIXED: close the popup on disable
- [WARNING] web/index.html renderTrigger — `|| opts[0]` fallback showed anthropic when select.value matched nothing (source-of-truth divergence) --> FIXED: render blank, mirror the native selectedIndex -1

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
- [BLOCKER] web/index.html — the native #d-provider select was only visually clipped, so it stayed keyboard-focusable (phantom tab stop) and in the a11y tree (duplicate "Provider" combobox) --> FIXED: tabindex=-1 + aria-hidden on the source select (verified nothing focuses it) + a browser-check assertion
- [NIT] dead `else if (nameFrom)` aria-label fallback on the listbox --> FIXED (removed)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 1 (Wi4-1 was iteration 1/2's own value-setter wrap)
- [WARNING] web/index.html — value change while the popup was OPEN left the trigger + aria-selected stale (the `!isOpen()` guard), e.g. a paintProviderPicker repaint --> FIXED: render unconditionally + a browser-check assertion
- [WARNING] web/index.html enhanceProviderSelect — field label derived only from aria-label; the next rollout target uses `<label for>` --> FIXED: fall back to an associated `<label for>`

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [NIT] the cloned OpenAI mark rendered ~half-size (the #firstrun scale(1.5) is #firstrun-scoped) --> FIXED (role-mandated visual): mirror the scale with a .pcombo-scoped rule; verified by screenshot
- (3 NITs deferred: inert clone class carry-over; document-listener teardown; Home/End/type-ahead open-from-closed)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [BLOCKER] web/index.html .pcombo-list — popup width was pinned to the trigger, truncating every coming-soon row to an unreadable fragment on the real page --> FIXED: autosize (min-width:100%, width:max-content, max-width:min(360px,90vw)); negative-control verified (old CSS truncated 6, fix truncates 0)
- [WARNING] render-provider-combobox-1040.js — the check read only .textContent (blind to truncation) and screenshotted the closed state --> FIXED: rendered-geometry (scrollWidth) assertion + leave the list open for the screenshot
- (3 NITs deferred: comment scope; listener teardown; .pcombo-src vs .vh duplication)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** - no actionable findings. Both NITs are about the DEFERRED rollout to the other two selects (right-edge flip; listener teardown) and, per the reviewer, not reachable for the shipping #d-provider in its centered modal.

### Final Ledger (actionable, all FIXED; Origin per 6c-bis)

| # | Iter | Category | Area | Origin | Status |
|---|------|----------|------|--------|--------|
| 1 | 1 | WARNING | trigger aria-label vs value | BRANCH | FIXED |
| 2 | 1 | WARNING | disabled not mirrored + gate | BRANCH | FIXED |
| 3 | 1 | WARNING | vacuous no-dispatch assertion | BRANCH | FIXED |
| 4 | 1 | (6g) | 990 gate verbatim pin | BRANCH | FIXED |
| 5 | 2 | BLOCKER | vacuous .click() disabled-open | SELF | FIXED |
| 6 | 2 | BLOCKER | vacuous closed-label default | BRANCH | FIXED |
| 7 | 2 | WARNING | doubled accessible name | BRANCH | FIXED |
| 8 | 2 | WARNING | stale aria-expanded on disable | BRANCH | FIXED |
| 9 | 2 | WARNING | opts[0] source-of-truth divergence | BRANCH | FIXED |
| 10 | 3 | BLOCKER | native select focusable/in a11y tree | BRANCH | FIXED |
| 11 | 4 | WARNING | stale trigger while open | SELF | FIXED |
| 12 | 4 | WARNING | label <label for> fallback | BRANCH | FIXED |
| 13 | 6 | BLOCKER | popup truncation | BRANCH | FIXED |
| 14 | 6 | WARNING | test blind to truncation + closed shot | BRANCH | FIXED |

### Deferred NITs (non-blocking; documented on the commits)
- Inert `llm-m`/`data-pmark` carry-over on the clone (harmless; data-pmark is load-bearing for the OpenAI scale rule).
- The per-enhance document `mousedown` (click-outside) listener has no teardown - fine for the static single #d-provider; a caveat for the re-createable-select rollout.
- Home/End/type-ahead act only while open (ArrowUp/Down already open from the closed trigger, so not a WCAG gap).
- `.pcombo-list` right-edge extension for a trigger near the viewport edge - not reachable for #d-provider in its centered modal; flag for the rollout.
- `.pcombo-src` duplicates `.vh`'s clip pattern (both correct).
- The trigger mark is not dimmed if select.value is ever set to a coming-soon value - normal flows never select a disabled option.

### Strengths (across iterations, independently verified by the reviewers)
- Native select kept as source of truth, hidden three ways (clip + tabindex=-1 + aria-hidden); selection drives it via value= + dispatch.
- value AND disabled property-setter wraps are non-recursive (delegate to the prototype descriptor) and cover paintProviderPicker's value-then-disabled paint order.
- APG select-only combobox: aria-labelledby names label + value, decorative marks, disabled options unselectable, Grok chip never a lookalike, Esc refocus, aria-activedescendant.
- The browser-check is non-vacuous by construction (no .click()-on-disabled, no already-set-value, rendered-geometry truncation check, positive controls); runs both themes with a screenshot; the #1720 count bumps are correct and pass.
- Full node suite (2400+ tests) green; no eval-slice breakage from the new top-level symbols.

### Human follow-up (flagged in the PR)
- A real screen-reader pass on the widget (the hermetic browser-check is the CI mechanism; NVDA/VoiceOver confirmation is the human step Splinter confirmed).
