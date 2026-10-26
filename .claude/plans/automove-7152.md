# kosmos#7152 slice 3: usage auto-balance acts (one move at a time), checks the agent works, keeps a record

Slice 2 (PR #7176) shows the decision in Settings. This slice runs the same decision on a timer, keeps a record of it,
and, when moves are switched on, makes one move at a time through the existing account move, then watches whether
the moved agent works on its new account.

## The call on "on by default" (and why)
The card asks for ON with two or more accounts. This slice ships the sweep and the record ON wherever slice 1's usage
reading is on (it needs those readings: an idle account is unmeasured otherwise), and the MOVES behind their own switch,
AGENT_WORKFORCE_AUTOMOVE=1, off unless set. Without it the sweep records "would move" decisions only.
- Why: Kosmos on the fleet's own Mac manages the fleet's agents, and Splinter's standing ask (10-25) is that automatic
  moves stay a dry run until he has seen a full day of decisions. This slice is what produces that day of decisions,
  through the product rather than the prototype.
- Rejected: moves on by default now (the card's end state). It is one line to flip once a day's record has been read,
  and a wrong automatic restart of a working fleet costs more than a day's wait.
- Rejected: a second switch in Settings for moves. A person sees one switch (slice 2); the env is the operator's,
  until the default flips, when it goes.
- Weakest premise: that a day of "would move" lines is the evidence Splinter wants. If he wants the prototype's file
  instead, this record has the same fields.
- What would change it: Splinter or Josh saying moves may run; then the default flips and the env becomes the brake.

## Inputs on a timer (no live checks)
GET /api/accounts uses listLive (a live login check per account), which must never run on a timer. The sweep builds
its rows from the cheap reads instead:
- accounts.list(): dir, label, email, organization, memoryShared, apiKey, isDefault.
- usagepoll.readUsage(dir): weekly and five-hour figures, fresh only. A fresh record whose state is 'ok' is a real
  usage call that worked for this login, so it stands for "signed in" (badge 'working'). A fresh record whose state is
  a refusal (usagepoll's isRefusal) stands for 'rejected'. Anything else gives no badge: not a target, and not at risk
  by login.
- agentsHere: claudeAgentsByAccount() (the walk; it already leaves the guide out).
- movable: movableFor on the walk's roster.

## The rule changes, both from slice 2's round 11
- The guide fails CLOSED: movableFor asks setup-assistant isGuideFolder itself, and a check that throws is "not
  movable". The walk's own guide test treats a throw as "not the guide", which is fine for a display line and wrong
  for a move.
- A target whose five-hour usage is at or above 90% (a fresh reading) is not a target: agents sent there would stall
  for hours. Slice 2's lines change the same way, since it is one rule.

## One move per tick
- Gated: live execution allowed, usagepoll enabled and liveAllowed, the setting on, at least two eligible accounts, no
  account move running (accountmove.busy), the board not about to restart, AGENT_WORKFORCE_AUTOMOVE_OFF not 1.
- Fresh decision every tick, so the target is picked again before each move (slice 2's stated assumption).
- The first move only. Idleness is read again just before the move, from a new roster read (slice 2's other stated
  assumption: its roster was a few seconds old).
- A target onto which an earlier automatic move did NOT work (the moved agent's first real call was rejected) is not
  used again for 6 hours (FAILED_HOLD_MS). Rejected: "until its usage reading is newer", since the reading comes every
  10 minutes and a working usage call does not prove an agent's turn works there.
- The move is accountmove.start({ dir: to, names: [agent] }) with the same deps the bulk-move route builds (moved into
  one function, so the two cannot drift).

## The works-again check
observed holds each agent's last real-call outcome. After the move finishes restarting the agent, the record's
`works` is: 'yes' when a call has been seen OK since the move, 'no' when one was rejected, 'not-yet' otherwise. An
idle agent may take no turn for hours, so 'not-yet' is a real, honest state, not a failure. Checked on every tick.
The record stops being checked after 24 h ('not seen' stays).

## The record and telling the person
- engine/automove.js keeps a JSON-lines file in the board's data folder: one line per CHANGED decision (would-move
  lines are not repeated every tick) and one per move with its outcome and works-again state. Bounded (last 500 lines).
  Account labels and agent names only; no email.
- The moved agent's conversation gets one Kosmos line (keepAgentReply, kosmos: true): which account to which and why.
- GET /api/accounts?agents=1 adds autobalance.movesOn and autobalance.recent (the last 10 entries, newest first);
  Settings shows them in their own box (#ab-recent) under the decision's lines, with one line saying moves are not
  switched on when they are not. Their own box so slice 2's lines, and its browser check's claims about them, are
  unchanged.
- A "partial" move (saved, restart failed) is recorded and the agent is not told it moved, since it has not.
- Shared: the bulk-move route's deps are now accountMoveDeps() in server.js, used by the route and the sweep.

## Not in this slice
Codex (slice 4). Counting a target's room across several at-risk accounts (one move per tick makes it moot: the next
tick reads the target's new figure... only after the next usage reading, stated: two moves in a row can land on one
target before its figure moves).
