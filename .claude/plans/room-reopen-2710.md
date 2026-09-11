# #2710: a room the loop-guard holds must not lose a post, and must be reopenable

**Branch:** `room-reopen-2710` · **Card:** kosmos#2710 (josh-review, from the Mortal
Kombat "Kosmos Inside Out" fleet-diagnostic dogfood, 2026-09-10)

## The card, and what stays vs. changes

The room circuit breaker (the "valve": Kosmos holds a room going back and forth without
landing and asks the operator to step in) is GOOD product judgment and is KEPT unchanged.
Three things to TUNE, in my lane (backend/messaging):

1. **A refused post is silently LOST.** An agent that composed a substantive post directly
   into the room loses it: the valve returns COULD_NOT with a `because`, and the agent's own
   text survives only in its scrollback, so a substantive post is gone the moment the agent
   moves on.
2. **There is no way to reopen a held room.** The valve's window resets when the operator
   POSTs, but there is no explicit release and nothing tells anyone that a post is what
   clears it. The card asks for a reopen path.
3. **Cosmetic:** the refusal an agent sees ends in a doubled period ("...bring you in..").

## The calls I made, and what I rejected

- **Hand the text back (chosen) vs. hold-for-release.** The card offers "hand back OR hold
  for release". I chose hand-back: the CLI echoes the agent's own text on any not-posted
  room result, with framing that it was not sent and can be re-posted. Hold-for-release (a
  persisted queue replayed on reopen) is more magical but adds ordering/dedup/who-delivers
  complexity and risk for little extra value here; rejected as out of proportion to the card.
- **Reopen = an explicit marker row (chosen) vs. reusing an operator post.** `reopenRoom`
  appends a `{kind:'reopen', operator:true}` row that the valve's `lastOperatorAt` reduce
  honors exactly like an operator post, moving the window mark to now WITHOUT adding a
  content post to the room. Rejected: telling the operator to "just post something" (leaves
  room chatter, and is what the card calls out as undiscoverable).
- **Operator-only by construction.** The reopen route is under `/api/` and POST, so the
  server's sensitive-route gate demands the board token, and it is deliberately NOT in the
  agent-exempt route sets. Same posture as the operator room-post and react routes. I did not
  add a per-caller operator/agent check because the codebase has none for these surfaces (the
  threat model is mistakes, not malice) and even an agent-triggered reopen is safe: the valve
  simply re-fires once the budget is spent again.
- **No render change.** The board affordance (a reopen button, and telling the operator on
  the board how to clear a hold) is a render-lane follow-up (Kitty owns the render-check
  sweep this week); I deliberately did not touch the valve `because` string or any
  `docs/browser-checks/*`, to avoid colliding with that lane. The CLI verb + usage is the
  discoverability I add here.

## The change, by layer

- **engine/messages.js:**
  - `rowShaped`: a first-class rule for `kind:'reopen'` (requires `project` and
    `operator:true`), so a malformed or agent-minted reopen is dropped on read.
  - the room valve's `lastOperatorAt` reduce now also honors a `reopen` row.
  - `reopenRoom(project, at)`: validates the id (same charset/bracket rule as a post),
    appends the operator reopen marker, returns `{ok, at}` / `{ok:false, because}`. Exported.
- **server.js:** `POST /api/project/:id/room/reopen` - maps path → project, 404 on unknown,
  calls `messages.reopenRoom`, returns its result. Auth inherited (sensitive-route gate).
- **install/kosmos:** `kosmos room reopen <project-id>` subverb (usage + not-found + reach
  arms, bash-3.2 `|| rc=$?` capture); and in `cmd_post`, the not-posted branch strips a
  trailing period (fixes the doubled "..") and hands the agent's text back.

## Tests (all red-capable, with controls)

- `engine/messages.test.js` (#2710 x3): a held room is cleared by `reopenRoom` so the next
  post lands (with a before/after control and a "reopen touches one room only" control);
  `reopenRoom` refuses an empty/unreadable id and writes nothing; a reopen row survives the
  read while an agent-minted one (no operator flag) is dropped.
- `server.room-reopen-2710.test.js` (x3): the route writes one operator marker + answers ok;
  unknown project → 404 + no write; AUTH - an enforcing board refuses a no-token reopen (403)
  and admits a token reopen (the discriminating control that the route is not auth-exempt).
- `cli.room-reopen-2710.test.js` (x4): a valve-refused post ends in one period and hands the
  text back; `room reopen` confirms; no-project usage exits 2; unknown project reported +
  non-zero.

## Weakest premise (name it so it can be overturned in a sentence)

The reopen resets the arrival BUDGET cleanly, but I did not touch the valve-notice / refused-
row DEDUP (keyed on the raw window, not the reopen mark). So if a room is reopened and then
loops again within the same window, agents are correctly refused again, but a second "stopped
again" valve NOTICE may be suppressed as a duplicate. That dedup is pre-existing and delicate;
widening it was out of scope for this card. If that suppressed re-notice turns out to matter,
the fix is to also reset the dedup baseline at the reopen mark - a follow-up, not this card.
