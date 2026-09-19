# Message thread: avatar baseline alignment + tighten inter-message gaps

Branch: `msg-avatar-baseline` · Repo: joshualeestone/kosmos (agent-workforce) · Owner: Mona Lisa

## Source of truth
Josh, #chaoskosmos-design 2026-09-19 08:43 CDT, with three annotated mockups (Current / Updated / Tighten Up) of the message dialog + projects thread:
1. Move the avatars UP so the avatar's bottom baseline sits on the message bubble's bottom baseline (in Current they hang below the bubble).
2. Once aligned, tighten the vertical space between messages, leaving just enough room for the mouseover emoji-reaction popout.

## Root cause (measured, not guessed)
The `.rxns` reaction row (`margin-top:6px`, rendered below every `.msg-bd` bubble) reserves ~24px of height even with no reactions, because the hover-only `.rxn-quick` bar is `opacity:0` but still `inline-flex` (in normal flow). `.msg` uses `align-items: flex-end`, so the avatar aligned to the BODY bottom = below that reserved strip, i.e. ~31px below the bubble (measured 177 vs 146). That reserved strip is also the "big gap the avatars are creating" Josh named.

## Change (web/index.html, CSS only)
- `.msg-b { position: relative; }` — anchor for the floated quick bar.
- `.rxn-quick { position: absolute; top: -10px; right: 0; z-index: 3; ... }` — the hover emoji bar floats out of flow, above the bubble at the message's top-right (the Discord-style popout in Josh's Tighten Up mockup), instead of reserving a strip below.
- `.rxns:not(:has(.rxn)) { margin-top: 0; }` — an empty reaction row (no `.rxn` pills) adds no height. With pills present the row is in normal flow exactly as before.
- `.thread { gap: 18px -> 14px }` — a modest additional tighten, keeping room for the floating popout.

## Verified (headless render + measurement, chromium)
- Resting (no reactions): avatar bottom == bubble bottom (146==146, 334==334). Matches "Updated".
- Hover: the emoji popout floats above the bubble at the top-right, in the gap. Matches "Tighten Up".
- With reactions: pills render in-flow below the bubble; avatar aligns to the bottom of the pills (173==173). Unchanged legitimate behavior.

## Existing coverage checked
- `render-room-msgbox-2806.js:286` asserts `.msg` computes `align-items: flex-end` — preserved (unchanged). My fix better matches its own comment ("avatar bottom-aligned WITH THE BUBBLE", #3134-followup).
- `render-reactions-2255.js` asserts the quick bar is opacity:0 pre-hover and opacity:1 on `.msg:hover` — both preserved; only its positioning changed, not its reveal.

## Weakest premise
That `:has()` and the absolute-positioned popout behave the same across the served board render as in the isolated harness. Mitigation: the two served browser-checks above exercise the real `#pj-room` thread and reactions; the challenge-loop + CI run them. The exact popout offset (top:-10px / right:0) is a one-number nudge Josh can adjust in-app; for a narrow agent bubble the popout sits toward the column's right rather than the bubble's right edge (anchored to `.msg-b`, not the variable-width bubble) — acceptable for the common wide-bubble case, notable as a possible follow-up.
