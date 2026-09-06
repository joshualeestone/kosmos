# Plan: #8 follow-up - Access box copy renders at its intended compact size

## Goal (what "finished" looks like)
The one-box Access preview's copy (`.s2-say`) renders at the compact dialog size
it was designed for (13px / .8125rem, weight 600), not the 17px / weight 400
first-run body-paragraph size it currently inherits. The box then reads as the
compact macOS prompt #8 intended.

## The defect (measured, headless via pw-runtime)
`#firstrun .fr-body p { font: 400 1.0625rem/1.6 ... }` (specificity 1,1,1) styles
every first-run `<p>`. My `.s2-say` from #8 was a bare class (0,1,0), which loses,
so the dialog copy computed 17px / weight 400 / line-height 27.2 - not the
13px/600 my `.s2-say{font:600 .8125rem/1.4}` rule intends. Pre-existing (the old
3-card fan's `.s2-say` had the same loss), so #8 did not regress it; but #8's
"compact macOS prompt" design is only half-delivered while the copy is oversized.

## Change
- web/index.html: `.s2-say{...}` -> `#firstrun .fr-body p.s2-say{...}` (specificity
  1,2,1, beating the 1,1,1 override). Same pattern the codebase already uses for
  `#firstrun .fr-body p.fc-eyebrow`, `p.tier`, `p.fr-confirm-t`. Declaration
  unchanged (600 / .8125rem / 1.4).
- docs/browser-checks/render-firstrun-access-onebox.js: add a size arm asserting
  the box copy is 12-14px, weight 600 - so a future specificity drop reds.

## Verification
Measured headless: `.s2-say` was 17px/400, now 13px/600. Check 10/10 both engines.
The new size arm is PERTURB-verified: it reds (sayPx 17, weight 400) against the
pre-fix bare-class `.s2-say` on origin/main, passes (13/600) on the fix.

## Scope
Only my `.s2-say` (a `<p>`). The buttons (`.s2-db`) are spans, not hit by the
`#firstrun .fr-body p` rule (measured fine: blue + ring at real values). The
functional `.s2-gate-row` is untouched.

## Rejected alternatives
- Bump to `#fr-pane-2 .s2-say` (1,1,0): rejected, that is LESS than the 1,1,1
  override and would not win. `#firstrun .fr-body p.s2-say` (1,2,1) wins cleanly and
  matches the established sibling pattern.
- Change the copy element from `<p>` to a non-`<p>` to dodge the rule: rejected,
  more invasive and breaks the established markup; a specificity bump is minimal.

## Weakest premise
That 13px/600 is the right target for the box copy. It is my #8 design value
(what the `.s2-say` rule already declares); this change just makes the rule
actually apply. If Josh wants a different size on his headed re-cut, it is a
one-value edit.

## Deferred (honest)
The pixel/aesthetic read (does the now-compact box sit well in the pane) still
belongs to Josh's headed re-cut - I verify size/structure/contrast headless, not
subjective fit. No Playwright MCP in this session for the live overlay.
