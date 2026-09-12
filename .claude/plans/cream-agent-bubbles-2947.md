# Plan: Agent message bubbles - ultra-light cream with subtle per-message variation (#2947)

## Source
Josh, direct design conversation 2026-09-12 (with mockups). "I love the blue bubble for me and the other colors for agents. But they type so much there is so much grey." He mused about subtle per-bubble variation, cream vs grey, and content-relative color, then picked: "Let's roll with the ultra light cream."

## Decisions (from the conversation, mine to make on the mechanism)
- Agent message bubbles become ultra-light **cream**, not the neutral `--k-sunk` gray. Person's own bubble stays blue (`--usermsg-tint`), untouched.
- **Subtle per-message variation** seeded off the message id, so each bubble keeps its shade and never shimmers on a repaint (rejected: re-rolling per poll). 5 shades (data-am 0..4).
- **Content-relative color is parked** (out of scope): once color means something it competes with the status colors (working/idle/needs-you).
- Do NOT touch the shared `--k-sunk` token (code pills and other sunk surfaces use it). Introduce a new `--agent-msg` token.
- Cream applies to light and dark; **navy is out of scope** (`--agent-msg: var(--k-sunk)` there - its bluish inset is that world's own language), matching how #2805 scoped its neutral-gray claim.

## Implementation
- **CSS token** `--agent-msg`, defined beside each `--k-sunk` (light `#f7f4ec`, dark `#221f1a`, navy `var(--k-sunk)`), so it flips per theme.
- **Base rules**: `.dm.theirs .dm-b` and `.msg:not(.you) .msg-bd` background `var(--k-sunk) -> var(--agent-msg)`.
- **Variation**: `[data-am="1..4"]` rules, each a tiny `color-mix(in srgb, var(--agent-msg), #000|#fff X%)` nudge (1.5-4%), so it is theme-aware (mixes the per-theme token) AND `getComputedStyle().backgroundColor`-readable. data-am="0" is the base.
- **JS**: dmRow (DM thread) and pjMsg (room) set a stable `data-am` on the agent bubble, from a hash of the message id. The hash is INLINED (not a shared helper) because dmRow is lifted and eval'd in isolation by web.links-everywhere / web.agent-answers, where an external helper call is an undefined reference (kosmos memory: helper delegation breaks isolation tests).

## Tests
- `render-agent-msg-gray-2805.js` updated: (1) `parse()` now handles the `color(srgb r g b)` form Chromium emits for color-mix (0..1 components scaled to 0..255) - without this the arms passed VACUOUSLY (spread ~0); (2) the "neutral gray" arm rewritten to assert a WARM cream (R>=G>=B with a real red-over-blue margin) - this also gives a real negative control, since the old neutral `--k-sunk` gray is faintly cool (B highest) and now reds; (3) a new variation probe: same data-am -> same shade (stable), different data-am -> different shade (variation), all warm cream. Verified 16/16 arms pass with real values (cream rgb(247,244,236) light / rgb(34,31,26) dark).
- `web.links-everywhere.test.js`: widened `dm-b">` markup pins to `dm-b"[^>]*>` for the new `data-am` attribute (keeps both the positive and the doesNotMatch arms honest).

## Out of scope
- The `.pjm-idle` idle-agent gray (that is #2920, already shipped).
- Navy theme cream.
- Content-relative color.

## Done-condition
Agent message bubbles read as ultra-light cream (light and dark) with a subtle, stable, per-message shade variation; the person's blue is unchanged; the #2805 check guards cream + variation non-vacuously; full suite green; CI green.

## Weakest premise
That a fixed warm-tint token (rather than an overlay) reads well as "cream" in dark mode. Mitigated: `#221f1a` is warm (R>G>B), a touch above the dark surface, and the check asserts it reads against the panel and is warm; Josh will see it live and can ask to warm it up or calm it down.
