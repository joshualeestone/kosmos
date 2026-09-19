# Message thread: avatar baseline alignment + tighten inter-message gaps

Branch: `msg-avatar-baseline` · Repo: joshualeestone/kosmos (agent-workforce) · Owner: Mona Lisa

## Source of truth
Josh, #chaoskosmos-design 2026-09-19 08:43 CDT, with three annotated mockups (Current / Updated / Tighten Up) of the message dialog + projects thread:
1. Move the avatars UP so the avatar's bottom baseline sits on the message bubble's bottom baseline (in Current they hang below the bubble).
2. Once aligned, tighten the vertical space between messages, leaving just enough room for the mouseover emoji-reaction popout.

## Root cause (measured, not guessed)
The `.rxns` reaction row (`margin-top:6px`, rendered below every `.msg-bd` bubble) reserves ~24px of height even with no reactions, because the hover-only `.rxn-quick` bar is `opacity:0` but still `inline-flex` (in normal flow). `.msg` uses `align-items: flex-end`, so the avatar aligned to the BODY bottom = below that reserved strip, i.e. ~31px below the bubble (measured 177 vs 146). That reserved strip is also the "big gap the avatars are creating" Josh named.

## Change (web/index.html, CSS only)
- `.msg-b { position: relative; }`, anchor for the floated quick bar.
- `.rxn-quick { position: absolute; top: -10px; right: 0; z-index: 3; ... }`, the hover emoji bar floats out of flow, above the bubble at the message's top-right (the Discord-style popout in Josh's Tighten Up mockup), instead of reserving a strip below.
- `.rxns:not(:has(.rxn)) { margin-top: 0; }`, an empty reaction row (no `.rxn` pills) adds no height. With pills present the row is in normal flow exactly as before.
- `.thread { gap: 18px -> 14px }`, a modest additional tighten, keeping room for the floating popout.
- `.msg:not(.you) .msg-b { flex: 0 1 auto; }`, the agent body shrink-wraps to its bubble so the popout's `right:0` lands on the bubble's right edge, not the full column width. Without this the popout floated in blank space to the right of a left-aligned agent bubble in a wide column (the default agent case). The operator's own row (`.msg.you`) already right-aligns its bubble to the column edge, so `right:0` is correct there without this.
- `.msg-b { isolation: isolate; }`, scopes the popout's `z-index` to its own message so it cannot compete in the ambient stacking context.

## Verified (headless render + measurement, chromium)
- Resting (no reactions): avatar bottom == bubble bottom (146==146, 334==334). Matches "Updated".
- Hover: the emoji popout floats above the bubble at the top-right, in the gap. Matches "Tighten Up".
- With reactions: pills render in-flow below the bubble; avatar aligns to the bottom of the pills (173==173). Unchanged legitimate behavior.

## Existing coverage checked
- `render-room-msgbox-2806.js:286` asserts `.msg` computes `align-items: flex-end`, preserved (unchanged). My fix better matches its own comment ("avatar bottom-aligned WITH THE BUBBLE", #3134-followup).
- `render-reactions-2255.js` asserts the quick bar is opacity:0 pre-hover and opacity:1 on `.msg:hover`, both preserved; only its positioning changed, not its reveal.

## Popout horizontal anchor (was a real defect, now fixed)
A blind review caught that anchoring the popout `right:0` to `.msg-b` floated it in blank space to the right of an agent bubble, and that this is the DEFAULT agent case, not a narrow-bubble edge case. Fixed by shrink-wrapping the agent `.msg-b` to its bubble (`flex: 0 1 auto`), so `right:0` now coincides with the bubble's right edge. Re-verified by render+measurement: popout.right == bubble.right (deltaRight=0) for a WIDE agent bubble, a NARROW agent bubble ("Yes."), and a user bubble; avatars stay aligned in all three.

## Weakest premise
That the isolated-harness render matches the served board render for `:has()`, the shrink-wrapped `.msg-b`, and the absolutely-positioned popout. Mitigation: the two served browser-checks (`render-room-msgbox-2806`, `render-reactions-2255`) exercise the real `#pj-room` thread and reactions, and a new guard added here asserts `.rxn-quick.right` tracks `.msg-bd.right` on an agent row so the anchor cannot silently regress. Residual cosmetic: for a very narrow agent bubble the popout (four icons wide) is wider than the bubble, so it extends left over the name row; the popout's right edge is still correct and this is a one-number nudge Josh can adjust in-app.
