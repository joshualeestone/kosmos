# Plan: room message background colors (#2806 asks 1 + 2)

Branch: dialog-emoji-2806. Addresses kosmos#2806 (asks 1 and 2 only; ask 3 is a
separate follow-up, see Scope below).

## The card

Josh, testing 0.6.56, filed #2806 with three asks. His screenshot
(/Users/agent1/.claude/card-images/josh-0.6.56-dialog-emoji/11.03.52-dialog-box.png)
is the PROJECT ROOM ("Kosmos Inside Out"), where every message renders on plain
white -- his own and the agents' alike.

1. His own messages should have a light BLUE background.
2. Agent messages should have a light GRAY box.
3. Emoji reactions: remove the always-visible "+" buttons; Discord-style hover UI
   with default quick reactions (thumbs up / heart / fire) + a grey smiley that
   opens the full picker.

## Liveness measured (not assumed)

- The DM view already colors messages: `.dm.mine .dm-b` = royal-blue
  `--usermsg-tint` (#2660), `.dm.theirs .dm-b` = `--k-sunk` gray (#2805).
- The PROJECT ROOM uses a DIFFERENT class, `.msg-b`, which has NO background rule
  (web/index.html:4266 is just `flex:1; min-width:0`). #2805 (commit bdb26d73)
  touched ONLY `.dm.theirs .dm-b`; it never reached the room. Verified with
  `git show bdb26d73 -- web/index.html`.
- So in the room, asks 1 AND 2 are both genuinely unbuilt. The card notes ask 2 =
  #2805 "so it's not duplicated", but #2805 covered the DM surface, not the room
  Josh is looking at. Adding the room gray is completing the same visual in the
  room, not re-doing #2805's DM work. This is documented on the card.

## Scope of THIS PR

Asks 1 + 2 only: give the room message BODY a colored box (blue for the operator's
own post, gray for an agent's). Ask 3 (reaction hover redesign) is larger and
independent; it is a separate branch/PR so this low-risk visual fix ships without
waiting on the interaction work. Documented on the card.

## The change

The room row (the pjMsg builder, web/index.html ~37466-37477) is:
`<div class="msg[ you]">` + avatar + `<div class="msg-b">` + `.msg-h` (name/role/
time) + pjRoomBody + preview + attachments + pjReactions + receipt.

The operator's own row already carries `.you` (isOp), so the mine/theirs
distinction exists. The DM boxes just the text (`.dm-b`), so to mirror it the room
should box the message BODY, not the whole `.msg-b` (which would tint the name and
the reaction row).

1. Paint (pjMsg): build the body content once
   `const bd = pjRoomBody(m,p) + pjPreviewCard(m.preview) + pjAttachmentCards(m);`
   and wrap it only when non-empty: `bd ? '<div class="msg-bd">'+bd+'</div>' : ''`.
   Leaves `.msg-h` above and pjReactions + receipt below the box, unwrapped. An
   empty body (e.g. a row with no words and no cards) emits no box.
2. CSS: add
   - `.msg-bd { padding: 8px 12px; border-radius: 12px; }` sized to the DM bubble.
   - `.msg.you .msg-bd { background: var(--usermsg-tint); }` (blue, ask 1).
   - `.msg:not(.you) .msg-bd { background: var(--k-sunk); }` (gray, ask 2).
   Reuses the exact tokens the DM already uses (`--usermsg-tint`, `--k-sunk`), both
   theme-defined, so no per-theme rule is needed and the two surfaces cannot drift
   on the color.
   - Confirm `.msg.you p` (the muted own-text color at :4299) still reads on the
     blue tint; adjust only if a browser check shows a contrast problem.

## Verification

- Node suite for the room/pjMsg renderers (whatever web.*/room tests exist).
- Browser render check via pw-runtime (~/work/pw-runtime, no MCP): seed a room with
  one operator post and one agent post, confirm the operator body box is blue and
  the agent body box is gray, in both light and dark, and that a bodyless row draws
  no empty box.
- Browser-check gate: web/ change -> add or update a docs/browser-checks assertion
  or a Browser-check: trailer.

## Weakest premise

That Josh wants the box around the message BODY (name/time outside), not the whole
message block. His word was "box"; the DM precedent boxes the text. If a browser
check makes the body-only box look wrong next to the DM, the fallback is to box the
whole `.msg-b` (pure CSS, no wrapper). Shipping the body-box; he can refine.
