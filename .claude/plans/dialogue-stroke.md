# Kill the stroke around the agent dialogue box

## Ask
Josh, 2026-09-11 (~20:32 CDT, #chaoskosmos-design, @-addressed to me; the PM is carding it):
"lets kill the stroke around the dialogue box on the agent dialogue." Screenshot shows the
view-agent (agent detail) screen; the stroke is the outline around the "Talk to <agent>" panel
that wraps the conversation and the message box.

## What finished looks like
On the view-agent screen, the "Talk to <agent>" panel has no outline/border; it reads as a clean
filled panel on the page (the surface fill still distinguishes it from the page ground). No other
card changes.

## Approach
The panel is `<section class="dbox" id="d-talk-box">`. The stroke comes from the shared `.dbox`
rule (`border: 1px solid var(--k-rule)`), which is used by ~10 other cards (Settings sections,
terminal/window boxes, create steps, #d-fresh). So the removal is SCOPED by id, not applied to the
class: add `#d-talk-box { border: 0; }`. This leaves every other `.dbox` outline intact.

## Decisions / weakest premises
- Read "the dialogue box on the agent dialogue" as the whole Talk-to-agent panel (#d-talk-box), the
  card with the visible outline in the screenshot. Confirmed my read to Josh in-channel and invited
  correction if he meant the message-input box or the message bubbles instead. WEAKEST PREMISE: he
  meant a different box; if so it is a one-line re-target.
- Kept the surface background (only the border goes), so the panel stays a distinct filled area
  rather than becoming invisible against the page.

## Verification
- Full unit suite via the challenge-loop. The only test referencing #d-talk-box (web.agent-nav.test.js)
  maps it to its nav section and is unaffected by a border change.
- The detail view cannot be rendered from this bot session; Josh reviews live.
