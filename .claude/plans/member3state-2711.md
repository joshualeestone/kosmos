# Plan: #2711 item 16 - member 3-state colour washes (project view)

Card: joshualeestone/kosmos#2711, item 16 ("member 3-state colours"). Branch:
`member3state-2711`. Repo: joshualeestone/kosmos.

## The conflict I found, and how I scoped around it
Item 16 as listed says three things: (a) 3 background states like the agent
homepage - light green (working), light red (needs you), very light gray (idle);
(b) remove the stroke around member boxes; (c) remove the member status lines.

But **#2699 (Josh, 2026-09-10, same-day) deliberately ADDED the needs-you red
triangle over the member icon + the status text in red** on this exact surface,
because needs-you "just says 'needs you' in text and doesn't show" and was
blending in. So item 16's (c) "remove status lines" would REVERT Josh's fresh
#2699 work, and (b) interacts with the meaningful `.unseen` dashed border.

Decision (reversible, documented, not parked on Josh's opinion - this is a
concrete conflict between two of his own rulings):
- **SHIP (a): the 3 background washes.** This is additive and REINFORCES #2699 -
  a red wash under the needs-you triangle+text makes it stand out more, which is
  exactly #2699's goal. It reverts nothing.
- **DEFER (b) remove stroke and (c) remove status lines.** Both are declutter
  asks that (c) directly conflicts with the same-day #2699 needs-you text, and
  (b) would also erase the `.unseen` dashed "can't see this agent" border unless
  restored pixel-perfectly. Both want Josh's pixel review since they touch his
  fresh #2699 surface, and I ship blind (no running-app view from this session).
  Recommendation on the card: keep the needs-you text (per #2699), let the washes
  carry working/idle, and restore the .unseen dashed border explicitly if the
  resting stroke goes.

## What finished looks like
- On the project members list (`#pj-one-agents`), a **working** member shows a
  light green ground, a **needs-you** member a light red ground, an **idle**
  member a very light gray ground; every other state (paused/stopped/unknown/
  restarting/unseen) keeps the neutral surface, mirroring the agent homepage's
  "red covers ONE state, everything else stays neutral" rule (plus idle=gray,
  which is item 16's one deviation from the homepage where idle is white).
- The wash survives hover (hover darkens the same hue rather than replacing it
  with the flat gray).
- Unseen members keep their dashed "can't see" border and get no wash.
- Full validation green.

## Changes
1. `web/index.html` pjMember(): add a state class (`pjm-working` / `pjm-attn` /
   `pjm-idle`) derived from `cardStOf(m).st`, gated on the member being present
   (an unseen member gets no wash). cardStOf + CARD_ST are already read here
   (#2699), so no new dependency.
2. `web/index.html` CSS, scoped to `#pj-one-agents .pj-member`: 3 wash rules
   (green/red/gray, `linear-gradient(rgba,rgba), var(--k-surface)` exactly like
   `.acard.working`/`.acard.attn`, so light/dark both work off one token) + 3
   state-aware `[data-agent]:hover` rules (higher specificity than the flat
   `var(--k-sunk)` hover, so the state hue is preserved on hover).

## Test coverage
- server.test.js lifts pjMember with cardStOf/CARD_ST in the prelude (#2699);
  adding a class from the same call is safe. The `.includes('pj-member')` / other
  assertions are unaffected by an extra class token. Will add coverage asserting
  the wash class is applied for working/attn/idle and absent for a neutral state.

## Gates
- #1720 browser-check gate: web/ change - will add a docs/browser-checks/ update
  or a Browser-check: trailer.
- #2518 surface gate: check whether pjm-* / pj-member is a mapped surface token.
