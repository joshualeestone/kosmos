# Reactions in a Direct Message (kosmos#3650)

Josh, 2026-09-24 12:27, #admin: reactions "in both their conversations and projects".
#3570 (PR #3580) covered project rooms only; a DM had no reactions at all.

## Measured first
- Room reactions are `kind:'reaction'` events in the append-only message log, toggled
  by messages.react() and replayed by reactionsFor().
- A DM is a different store: one JSON thread per agent (chats/direct..<agent>.json),
  rewritten whole under its lock (engine/chat.js). A DM message has no id; the page
  keys rows by `at` (midOf). An agent never reads its DM back: messages are pasted
  into its pane, and there is no `kosmos` verb that prints the thread.
- The DM view had no picker. Its rows already use the room's `.msg` bubble, so the
  room's reaction CSS (`.rxns`, `.msg:hover .rxn-quick`) applies unchanged.

## Calls
- STORE: on the message. `reactions` = the emojis the person has on it now;
  `reactionsTold` = the ones the agent has been told. appendLocked carries old rows
  over whole, so both survive later appends. A stray non-array / non-emoji value is
  skipped, never treated as damage.
- KEY: the message's `at`, and only the AGENT's messages. Two agent rows sharing one
  `at` are refused rather than guessed.
- DELIVERY: not a push. A reaction is feedback, so it must not wake the agent into a
  turn. It rides the person's NEXT message as one `[kosmos]` note after their words
  (the deliver() trailer), naming the emoji and the start of the message. Marked told
  only when that message placed or was typed (unconfirmed); a failed send keeps it
  pending. A reaction taken back before then is never told. Same as the room, where a
  reaction is seen on the agent's next read.
- UI: the room's own pieces. dmRow draws the room's `.rxns` row (rxnsInner) under each
  agent bubble, keyed by `data-at`. A delegated handler on #d-dmthread toggles through
  the new route and repaints the row. The SHARED picker learns a second target:
  opened from a DM row it carries `data-at` (and no `data-post`) and routes the pick
  to the DM route. rxnCloseAllPickers resets openers in both threads.
- DOCTRINE: a new section, `### When someone reacts in a direct conversation`,
  DOCTRINE_VERSION 14 (new heading so `missingFrom` re-offers it to existing agents).
  The note itself also says "it needs no reply", for agents that have not refreshed.
- MAC AND WINDOWS: all of this is server.js + engine + web, which both boards run.

- LIMITS (review pass 1): no note on a numbered menu answer, checked on `chose` AND on
  a bare-digit text (`chose` is dropped when no menu shows, and a digit is what a menu
  takes), so a note can never spill into the next prompt. At most 20 reactions per
  message. The note names at most the five newest messages and counts the rest. The
  quoted start is cut by code point so an emoji is never split. The page closes a
  DM-opened picker before a repaint that rewrites the thread (as the room does), and a
  pick lands only in a DM that is still on screen.

## Rejected
- Pushing each reaction to the pane as it happens: wakes the agent for feedback that
  needs no reply, and contradicts the doctrine it is meant to follow.
- Storing DM reactions as events in the message log: a second store for one fact,
  and the DM thread is the record the page already reads.
- Agents reacting back in a DM: there is no verb for it and the card did not need it;
  the doctrine says so plainly.

## Weakest premise
A reaction the person makes and never follows with a message is never told. That is
the deliberate cost of not waking the agent. What would change it: Josh wanting a
reaction alone to reach the agent, which would need a quiet channel that does not
start a turn.

## Verification
- engine/chat.dm-reactions-3650.test.js (11, incl. the cap, the bounded note and the code-point cut): toggle, only agent rows, ambiguity
  refused, survives appends, told once then silent, taken-back never told, one-line
  note with quoting, stray values skipped. Perturbations: accepting any row, and a
  no-op told-marker, each red their arm.
- server.test.js #3650: the route, pills on the GET, an undelivered send leaving the
  note pending, no note on a menu answer, the note typed after the person's words,
  and not typed again. Perturbations: no note, told-marking regardless of delivery,
  no told-marking, and no digit guard each red it.
- docs/browser-checks/render-dm-reactions-3650.js (9): rows on agent messages only,
  a pressed pill, quick-bar POST + repaint, shared picker routed to the DM route and
  closed. Perturbations: picker DM branch off, and no DM row, each red. The room's
  render-reactions-2255 (46), render-agentdm-3414 and render-talk still pass.
- engine/defaults.test.js: fingerprint 14 pinned.
