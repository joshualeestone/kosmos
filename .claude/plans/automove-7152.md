# kosmos#7152 slice 3: usage auto-balance acts (one move at a time), checks the agent works, keeps a record

Slice 2 (PR #7176) shows the decision in Settings. This slice runs the same decision on a timer, keeps a record of it,
and, when moves are switched on, makes one move at a time through the existing account move, then watches whether
the moved agent works on its new account.

## The call on "on by default" (and why)
The card asks for ON with two or more accounts. This slice ships the sweep and the record ON wherever slice 1's usage
reading is on (it needs those readings: an idle account is unmeasured otherwise), and the MOVES behind their own switch,
AGENT_WORKFORCE_AUTOMOVE=1, off unless set. Without it the sweep records "would move" decisions only.
Review 3, stated plainly: slice 1's reading is itself OFF unless AGENT_WORKFORCE_USAGE_POLL=1 (its review 19), so by
default nothing is recorded either. A day of decisions needs that one switched on; moves need both.
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
  usage call that worked for this login, so it stands for "signed in" (badge 'working'). A fresh 401 or 403 (usage or
  profile call) stands for 'rejected'. Anything else gives no badge: not a target, and not at risk by login.
  Review 2 (the blocker): usagepoll's wider refusal set is NOT a stopped login. A 429 is the usage endpoint's own rate
  limit, held for an hour; an unreadable answer or another login's token says nothing about the agents' own login.
  Reading them as stopped would have moved a working account's agents for an hour, and put false lines in the record.
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
- Review 2: an agent is moved only when it was movable on the previous tick too, and not while its box holds unsent
  words (the card's unsentInput). WEAKEST PREMISE, and the reason moves stay off: an agent sitting at its prompt with
  a background SHELL job (a long validation, a monitor) still reads idle, and a restart kills the job. A background
  agent reads working; a background shell does not. Two ticks narrow it, they do not close it. Before moves go on by
  default, the move must see the agent's own child processes (or Claude's background-task count on its screen).
- The first move only. Idleness is read again just before the move, from a new roster read (slice 2's other stated
  assumption: its roster was a few seconds old).
- A stopped login (a 401 or 403 from the usage endpoint) moves an agent only when that agent's OWN last request was
  refused within the hour (review 3). The endpoint is undocumented, and a second reading proves nothing: while usagepoll
  holds a refusal it sends no request and rewrites the same one.
- A move back owed (below) goes first but never blocks the rest: it waits while its agent is not idle, is dropped
  when the agent is no longer on the account it was moved to (a person moved it, or it was removed), and is given up
  after a day, with a record line. A 409 from the board (a move began meanwhile, or a restart is coming) is not the
  agent's refusal: no hold, no line, and a move back stays owed.
- A target onto which an earlier automatic move did NOT work (the moved agent's first real call was rejected) is not
  used again for 6 hours (FAILED_HOLD_MS). Rejected: "until its usage reading is newer", since the reading comes every
  10 minutes and a working usage call does not prove an agent's turn works there.
- The move is accountmove.start({ dir: to, names: [agent] }) with the same deps the bulk-move route builds (moved into
  one function, so the two cannot drift).

## The works-again check
observed holds each agent's last real-call outcome. From the moment the move starts (review 2: not when it ends, so
a first call made as the restart finishes counts), the first call seen decides a 'works' line: 'yes' (OK) or 'no'
(rejected). Until then nothing is written: an idle agent may take no turn for hours, and that is not a failure. After
24 h with none, a 'not-seen' line. On 'no' the target is held for 6 hours and the agent is moved back where it came
from (review 2), through the same idle re-check, unless that account's own login had stopped.
The holds (a target after 'no', an agent after a refused move) are rebuilt from the record when the board starts, so
an update or restart does not forget them.

## The record and telling the person
- engine/automove.js keeps a JSON-lines file in the board's data folder: one line per CHANGED decision (would-move
  lines are not repeated every tick) and one per move with its outcome and works-again state. Bounded (last 500 lines).
  Account labels and agent names only; no email.
- The moved agent's conversation gets one Kosmos line (keepAgentReply, kosmos: true): which account to which and why.
- GET /api/accounts?agents=1 adds autobalance.recording (the sweep's own gate: live execution, the usage reading on
  and allowed, no brake), autobalance.movesOn (recording and the move switch) and autobalance.recent (the last 10
  entries the page draws, newest first; a decision made with moves on is not one of them);
  Settings shows them in their own box (#ab-recent) under the decision's lines, with one line saying moves are not
  switched on when they are not. Their own box so slice 2's lines, and its browser check's claims about them, are
  unchanged.
- A "partial" move (saved, restart failed) and a "stopped" one (the person stopped it; it is put back) are recorded
  as such, and the agent is not told it moved, since it has not. An entry from another day says the day.
- Shared: the bulk-move route's deps are now accountMoveDeps() in server.js, used by the route and the sweep.

## Not in this slice
Codex (slice 4). Counting a target's room across several at-risk accounts (one move per tick makes it moot: the next
tick reads the target's new figure... only after the next usage reading, stated: two moves in a row can land on one
target before its figure moves).
