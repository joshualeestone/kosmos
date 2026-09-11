# Plan: remove the 1px stroke on the washed member states (#2804)

## Card
#2804 - "Agent cards: remove the 1px stroke - convey the 3 states by color fill only
(gray/green/red), no border." Josh, testing 0.6.56, 2026-09-11.

Josh's exact words: "I do not want to have the 1px stroke around these agents, whether
they're active, inactive, or need help. It should only be the color: the light gray,
the green, or the red."

Follow-up to #2711 item 16, which added the three member state washes
(`#pj-one-agents .pj-member.pjm-working|attn|idle`). That item deferred the stroke
removal; this card completes it.

## Surface (verified against Josh's saved images)
The MEMBERS panel in the project (tab) view: `#pj-one-agents .pj-member`. Josh's two
reference images show idle members (gray fill + thin stroke) and working members
(green fill + green stroke). The three washes already exist at
web/index.html:4942-4950; the base `.pj-member` stroke is
`border: 0.5px solid var(--separator)` at 4926 (unscoped, shared by settings and the
add-agent picker too).

## The change (CSS only)
Remove the stroke ONLY on the three washed states, where a colour already stands in
for it:

```
#pj-one-agents .pj-member.pjm-working { border-color: transparent; }
#pj-one-agents .pj-member.pjm-attn { border-color: transparent; }
#pj-one-agents .pj-member.pjm-idle { border-color: transparent; }
```

`border-color: transparent` (not `border: 0`) keeps the box geometry; with the default
`background-clip: border-box` the wash fills edge to edge with no gap where the stroke
was.

## What is deliberately NOT touched (the call, and what I rejected)
- **Scope to the three wash classes**, not all `#pj-one-agents .pj-member`. Josh
  enumerated the three states ("active, inactive, or need help" = working/idle/needs).
  A present-but-neutral member (rate_limited/restarting/unknown) carries no wash colour,
  so it KEEPS its outline, removing its stroke would leave a fill-less, stroke-less
  row. Rejected the broader `#pj-one-agents .pj-member { border-color: transparent }`
  for that reason.
- **Preserve `.pj-member.unseen { border-style: dashed }`.** An unseen member ("we
  cannot see this agent", web/index.html #33408) is a presence signal on a different
  axis from the three states, and gets NO wash, its dashed border is its only visual.
  The wash classes and `unseen` are mutually exclusive in the builder (pjm-* is gated
  on `present`), so the scoped rule never touches unseen.
- **Leave the settings (`#pjs-members`) and add-agent picker (`#pj-add-agents`)
  strokes alone**, no washes there, so the base stroke still delineates the box.

## Weakest premise
That Josh considers "unseen" outside "the three states." If he wants the dashed
presence border gone too, that is a one-line follow-up. Preserving a meaningful signal
on the safe/reversible reading, and flagging it, beats silently dropping it.

## Tests
- New server.test.js test (#2804): asserts the three washed states set
  `border-color: transparent`; CONTROL that the base `.pj-member` solid stroke survives
  (settings/picker keep their outline); CONTROL that `.pj-member.unseen` keeps its
  dashed border.
- Existing #2711 item-16 tests unchanged (class logic + wash rules).

## Gates
- #1720 coarse browser-check: `Browser-check:` trailer (CSS-only, unit-covered, blind
  ship, Playwright follow-up recommended).
- #2518 surface gate: `pj-one-agents` is mapped to render-member-modal.js, which
  asserts the add-member MODAL, not the box border, per-check
  `Browser-check-surface: render-member-modal.js` override. Same pattern #2711 item 16
  used.
