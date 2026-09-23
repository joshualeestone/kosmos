# Plan: rebuild the agent DM/dialog to match the project consolidated-view conversation UI (#3414)

## Source of truth
Josh's verbatim spec on card #3414 + his CURRENT-vs-UPDATED screenshots (design channel msg
1552043644855394354). Owner: Mona Lisa (assigned via Splinter). Fast-follow (0.6.89), not
launch-blocking. Shared web/index.html, so it lands on Mac + Windows.

## Target (from the UPDATED screenshot, dark mode shown)
- Black, edge-to-edge conversation area filling 100% top-to-bottom and all the way right (padding
  keeps content off the literal edge). No rounded card, no border.
- Header top-left: "Direct Message to <agent name>" in the PROJECT-NAME font (big), not the small
  uppercase `.dlab`.
- Search top-right, shrunk to just "Search".
- Bubbles = the room's `.msg` style exactly:
  - Agent (theirs): gray bubble on the LEFT, agent avatar to its left, agent name bold INSIDE the
    bubble at top, white text, timestamp INSIDE the bubble bottom-right.
  - User (mine): blue bubble on the RIGHT, user avatar to its right, white text, timestamp INSIDE
    bottom-right.
- Composer = the room's composer: placeholder "Write something or @name to message someone…",
  emoji button, "Post" label.
- REMOVE the "Just between you and <name>. Nothing here belongs to a project." hint.
- REMOVE the "This stays here after a restart. <name> will not remember it..." line (it IS present
  at the bottom of the current DM, contrary to the initial map; confirmed in the CURRENT screenshot).
- Light mode ships too.

## Approach (measured against the code)
The room (`pjRoomRow`, `.msg/.msg-b/.msg-bd/.msg-nm/.msg-t/.msg-av`, `#pj-room`) and the DM
(`dmRow`, `.dm/.dm-b/.dm-w`, `#d-dmthread`) are DUPLICATED, not shared (only color tokens +
inline helpers are shared). So this is a PORT.

1. **Renderer:** refactor `dmRow(m, name, ctx)` to emit the room's `.msg` markup so the room's
   bubble CSS applies for free:
   - agent (m.from present): `<div class="msg">` + `.msg-av` (agent photo via
     /api/agent/<from>/avatar when the agent has one, else initials disc) + `.msg-b` > `.msg-bd`
     > `<b class="msg-nm">name</b>` + body + `<span class="msg-t">time</span>`.
   - user: `<div class="msg you">` + `.msg-av.mine` (YOU_PIC or neutral disc) + `.msg-b` >
     `.msg-bd` > body + `<span class="msg-t">time</span>` + the DELIVERY VERDICT.
   - KEEP the DM delivery verdict (mine side only). It is DM-specific and load-bearing (a DM
     crosses into a terminal and may not arrive; dmRow's own comments explain the record must not
     lie about the mechanism). It is silent on ordinary success, so on the happy path the bubble
     matches the room; on a real failure it still shows. Rendered inside `.msg-bd`.
   - Keep the stable per-row key (`data-mid`, id||at) so the 5s repaint keeps the reader's anchor.
   - ctx (3rd param) carries the agent avatar info (sessionName/hasAvatar/avatarVer) from
     paintTalkThread; defaulted so the lifted tests (which call dmRow(m,name)) fall back to the
     initials disc rather than a broken img.
2. **Header:** `#d-talk-label` text -> "Direct Message to " + name; restyle from `.dlab` to the
   project-name font (reuse the project-name treatment; the row is `.d-talk-caprow` today).
3. **Hint:** remove `#d-talk-hint` (the "Just between you and..." line; do not set its text).
4. **Search:** `#d-talk-search` placeholder + aria -> "Search".
5. **Composer:** match the room: placeholder "Write something or @name to message someone…",
   button label "Post" (keep #d-send id + sendTalk logic), add the emoji button wired to the same
   picker targeting #d-say IF reusable; else flag and keep parity on the visible box.
6. **Layout/background:** `#d-talk-box` -> black ground, edge-to-edge, no border/radius, fill 100%
   (mirror `.pjmid`/`.pjmid .thread` treatment). Background follows the room's theme tokens: near-
   black in dark (matches "black background"), light in light mode (matches "copy the project
   dialog exactly"). DECISION: theme-appropriate ground via the room's tokens, not a literal black
   forced into light mode; reversible in one rule if Josh wants literal black in light too.
7. **Remove the restart line** (find the #d-... element carrying "stays here after a restart").
8. **Light mode:** the room bubbles already theme via tokens; verify.

## Tests to update (they lift+eval dmRow and assert `.dm`/`.dm-w`)
- web/agent-answers.test.js, web/links-everywhere.test.js, server.test.js -> update assertions to
  the new `.msg`/`.msg you`/`.msg-t` markup. (web.index.html has hidden unit coverage; budget it.)

## Verification
- New browser-check render-agentdm-3414.js: render the DM view with a fleet agent + a thread
  (agent + user messages), assert room-style markup on the DM (`.msg` agent gray-left with avatar +
  name-inside + time-inside; `.msg.you` user blue-right), header text "Direct Message to <name>" in
  the project-name font, search placeholder "Search", the black edge-to-edge fill, the hint +
  restart lines ABSENT. Wire runner + README + surface annotation. Before/after screenshot to Josh.
- Full challenge-loop.

## Weakest premise
That "background should be black" means the room's theme ground (near-black in dark, light in
light), not literal black in light mode. Reversible in one rule; Josh's screenshot is dark mode
only, so light mode is the inference.

Addresses #3414
