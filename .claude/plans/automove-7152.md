# kosmos#7152 slice 3: usage auto-balance on a timer, RECORDING what it would move (nothing moves)

Slice 2 (PR #7176) shows the current decision in Settings when a person opens it. This slice runs the same decision on
a timer and keeps a record of it, so a person (and the PM) can read a day of what Kosmos would have moved, and why,
before anything moves on its own. Moving is slice 3b.

## The call (and why), made at review round 8
This branch first built the moves as well, behind AGENT_WORKFORCE_AUTOMOVE=1, off by default. Eight blind review rounds
followed; every round from 4 to 8 found its warnings in the moving half: a person's own move undone on the next tick,
a Stop undone, partial and unknown moves mis-watched, a target held or retried wrongly, holds that had to survive a
board restart. Each round's fixes added surface for the next. Meanwhile the moves were switched off, and the PM's
standing ask (10-25) is that automatic moves wait until a full day of decisions has been read.
- Call: ship the record now; build the moves as slice 3b, against the record's evidence and the review findings.
- Rejected: shipping the moves switched off. Dead code behind a switch nobody may use yet, with an open list of
  defects, costs every reviewer of every later change and earns nothing before the day of records exists.
- Rejected: an unbounded ninth round. The loop was converging on a target that kept moving.
- Kept, not lost: the full mover is pushed as branch automove-live-7152 (f33e2432c8), and its review ledger (rounds 1 to
  8, with the open items) is the requirements list for 3b.
- Weakest premise: that a day of these records is the evidence the PM wants. If he wants the fleet prototype's file
  instead, the record has the same fields.
- What would change it: the PM or Josh asking for moves before a day of records; then 3b is next, not later.

## Inputs on a timer (no live checks)
GET /api/accounts uses listLive (a live login check per account), which must never run on a timer. The sweep builds
its rows from cheap reads instead (engine/autobalance.js rowsFromReadings):
- accounts.list(): dir, label, email, organization, memoryShared, apiKey, isDefault.
- usagepoll.readUsage(dir): weekly and five-hour figures, fresh only. A fresh record whose state is 'ok' is a real
  usage call that worked for this login, so it stands for "signed in" (badge 'working'). A fresh 401 or 403 (usage or
  profile call) stands for 'rejected'. Anything else gives no badge: not a target, and not at risk by login. A 429 is
  the usage endpoint's own rate limit, not a stopped login; an unreadable answer or another login's token says
  nothing about the agents' own login.
- agentsHere and the roster: claudeAgentsByAccount() (the walk, which leaves the guide out), once per tick.
- movable: movableFor on the walk's roster.
It runs only where slice 1's usage reading runs (it needs those readings: an idle account is unmeasured otherwise),
which is OFF unless AGENT_WORKFORCE_USAGE_POLL=1 (slice 1's review 19). So by default nothing is recorded either.

## Rule changes that reach slice 2's lines too (one rule)
- The guide fails CLOSED: movableFor asks setup-assistant isGuideFolderStrict and guideNameStrict itself; a check that
  throws is "not movable". The walk's own guide test reads a throw as "not the guide".
- A target whose five-hour usage is at or above 90% (a fresh reading) is not a target.
- An agent with words left unsent in its box (the card's unsentInput, which appears once they have sat 3 minutes) is
  not movable.

## The sweep and the record
- engine/autobalance-sweep.js: one tick per usage-poll period, gated (autobalanceSweepRuns): live execution, the usage
  reading on and allowed (never under a test or a dry run), AGENT_WORKFORCE_AUTOBALANCE_SWEEP_OFF not 1, the record
  read at start. The setting off records nothing; fewer than two subscription accounts stops before the agents walk.
- One JSON line per CHANGED decision (moves with labels, reason and kind; held; at risk), in the board's data folder,
  newest 500 kept. The last decision is rebuilt from the record at start, so a restart does not write it again; a line
  stamped in the future is not trusted; odd lines are skipped; a write that fails is tried again next tick. No email.
- A record that cannot be read leaves the sweep off (a log line), never the board.

## Telling the person
GET /api/accounts?agents=1 adds autobalance.recording (the sweep's own gate) and autobalance.recent (the newest 10
decisions with a move, newest first). Settings shows them in their own box (#ab-recent) under the decision's lines:
"Kosmos does not move agents on its own yet. It keeps a record of what it would have moved.", then one line per
would-move with its reason, and another day's entry says the day. Where the sweep does not record, it says so. The
record shows also when the current decision could not be worked out. The hint keeps slice 2's "Nothing is moved".

## What slice 3b must satisfy (from rounds 1 to 8 of the live branch)
One move per tick through the bulk move's own deps; two idle ticks and a fresh roster and projects re-check; usage
only (never a stopped login); no automatic move back; a refused first request holds the target a day and tells the
person in their thread; one unproven agent per target; a person's move or Stop wins for a day (including moves made
through the routes, which today leave no trace the sweep reads: round 8); a moved agent rests a day (partial and
unknown included: round 8); a partial or unknown move takes no sighting as proof until the agent's session has
restarted on the target (round 7, 8); holds and watches rebuilt from the record; a throw before setAccount is a
refusal, after it unknown (round 8); "no longer idle" said only when it is idle-ness that changed (round 8).
The background-shell gap stays the weakest premise for any move: an agent at its prompt with a background shell job
reads idle, and a restart kills the job.
