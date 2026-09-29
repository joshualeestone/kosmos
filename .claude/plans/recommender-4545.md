# #4545: style up the Recommender block (Settings > Automation)

## Finished looks like
- With the Recommender on, its three guards are one left-aligned list under "Never let a
  recommendation:": every checkbox at the same x, the list starting at the legend's left edge.
- Each checkbox sits on the centre of its label's first line, whatever the label's length.
- Each guard is a full-width row inside one hairline group (rule between rows, rounded group), and a
  click anywhere on the row ticks it.
- Clear spacing between the switch row, the guards and the footnote; the checkbox in the switch's
  green. Light and dark, desktop and phone, no sideways scroll.
- The default is unchanged (off), the guard copy is unchanged, and the switch's description drops its
  spaced hyphen for a comma ("carries it out, within the guards below.").

## Cause
The fieldset carried `.frow`, whose `align-items: center` centres a flex COLUMN's children
horizontally, so three labels of different widths sat centred and staggered (checkbox x measured
671 / 662 / 659 at 1400px). The 13px checkbox was top-aligned against a 23px line (5px high).

## How
- Markup: `fieldset.rec-guards` > `legend` + `div.rec-guard-list` > three `label.rec-guard[for]`
  wrapping their checkbox (the explicit `for` and direct-child input are pinned by
  web.settings-nav.test.js and the 44px phone-label check), then the footnote. Inline styles removed.
- CSS beside `.setrow`: tokens only (`--k-rule`, `--k-sunk`, `--k-ink`, `--k-ink-2`), so both themes
  follow; the box's top margin is `calc((.9375rem * 1.4 - 16px) / 2)`, the label's font-size and
  line-height written again as literals (not `em`, which resolves against the input's font). If
  either changes, the check's first-line-centre arm goes red.

## Decided (weakest premise named)
- A bordered group with hairlines between rows, rather than a bare list: it reads as one set of
  guards and gives each row a visible full-width target. Weakest: that Josh wants a frame here; one
  rule (`.rec-guard-list` border) takes it off.
- Checkbox accent in the switch's green (#2f7d5a), not the gold the task list uses: the guards are
  part of the switch's control. Weakest: app-wide checkbox consistency.

## Rejected
- Keeping `.frow` and overriding `align-items`: the class brought nothing else this block uses.

## Verification
- `docs/browser-checks/render-recommender-guards-4545.js` (light/dark x 1400/390, 36 checks, floor
  36), gated.txt + README. Negative control: against origin/main's page it fails (22/36) on one x,
  first-line centring, row span and (desktop) the far-end click.
- Review shots: `mobile-shots.js` gains a `settings-recommender` screen (the /design-shots set:
  `--sizes desktop,iphone15 --themes light,dark --engines chromium --screens settings-recommender`).
- Unit: web.settings-nav, recommender-save-3595, browser-checks-wired, mobile-shots tests.
