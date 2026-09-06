# Plan: #2146 render half -- working indicator coexists with needs_you/blocked

## Problem (Josh's #admin screenshot, via Morpheus/Ben, forwarded)
The board reads "0 Working" while agents are visibly working. Root cause is state
PRECEDENCE, not a render break: an agent marked `needs_you` (sticky/manual) is
counted "Needs you" and the working animation is off for it, so an agent that is
actively working AND has a pending needs_you shows no working signal.

## Design: coexistence, not precedence (PigeonPete's, from the card)
A precedence flip (fresh working hides a sticky needs_you) would REINTRODUCE the
false-calm the sticky needs_you exists to prevent -- this fleet's own doctrine
("a blocker parks the card, not the agent -- take the next card while blocked")
means an agent with a real, still-pending needs_you is EXPECTED to be working the
next card at the same time. So the fix must be additive:

- ENGINE (#2169, PigeonPete, already merged): an additive boolean
  `activeWhileWaiting` on each card payload = true when a needs_you/blocked agent
  ALSO has a fresh post-ask work signal that reconcileReport suppresses. State
  and counts are unchanged.
- WEB (this branch, Angel's half): render that flag as a working affordance
  alongside the pending state, WITHOUT changing the state, the pill, its label,
  the ground treatment, or the Needs-you count.

## What this branch does
- `web/index.html` `card()` (grid): a `.alsowork` element BELOW the state pill --
  the reused `.act` working dots (the board's one working glyph, aria-hidden
  decorative) + a "Working now" text label (meaning for AT), rendered when
  `a.activeWhileWaiting`. Placed as a sibling of the pill so it does not dilute
  the "Answer" call-to-action Josh made the pill's loudest thing.
- `web/index.html` `lrow()` (list): the same affordance INSIDE the `.lstate`
  cell (the sanctioned second-line shape; an eighth grid child is forbidden).
  THE LIST IS HALF THE BOARD -- a card-only fix is the recurring one-renderer
  debt this file names, so both board renderers carry it.
- CSS: base `.alsowork` (inline-flex, gap, .8125rem, weight 400, `--k-ink-2`) +
  `.acard .alsowork` (below the pill) + `.lstate .alsowork` (inline). The label
  reuses the exact `--k-ink-2` token and the same grounds the shipped
  `.atask`/`.amodel`/`.ltask`/`.lmodel` lines already sit on, so contrast is at
  parity with accepted text (WCAG AA). `.act` is already reduced-motion-safe.
- `docs/browser-checks/render-workindicator-2146.js`: hermetic (file://) render
  check calling the real `card()` and `lrow()`; asserts the badge on
  needs_you/blocked with the flag (3 `.act` dots + "Working now", correct
  placement per surface) with controls that each return the dangerous answer
  (flag-off on the same needs_you agent shows no badge and an IDENTICAL
  pill/label/ground; a plain working agent is not double-marked). Reds on the
  pre-#2146 page. Wired into `tools/browser-checks.sh` + README + reason-grep
  counts (55/32).

## Decisions & scope
- **Keyed off the engine field, not any client-derived working state**, so it
  renders past the #1150 recently-spoken client suppression (which affects state
  derivation, not this additive field). PigeonPete's "fold in the #1150 half" is
  satisfied structurally: the flag is authoritative, so no client filter drops it.
- **Count unchanged is deliberate.** The "0 Working" tile counts `state==working`;
  this fix does NOT move a needs_you agent into that count (that would be the
  precedence flip / false-calm). The person now sees "3 Needs you" cards that
  ALSO show they are working -- coexistence -- rather than a changed tally.
- **Scope = the two BOARD surfaces (grid card + list row).** The DETAIL panel
  (opening one agent) is a separate, richer surface where the "0 Working"
  scanning problem does not live; carrying the coexistence signal there is a
  reasonable follow-up, deliberately not in this render half.
- **Weakest premise (PigeonPete's, inherited):** that a fresh working
  self-report under a standing needs_you is reliably available. If the report
  path is suppressed upstream, the engine's freshness source may need pane
  activity (the #1930 primitive) -- an engine concern, not this render's.

## Verification
- Unit suite green (4894/4894 at branch open).
- Render check OK on this branch; perturb-verified red on origin/main (no
  `.alsowork`); controls discriminate.
- reason-grep tripwire green at 55/32.
- Screenshots (headless, both themes) attached to the PR / channel.
