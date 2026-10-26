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
- usagepoll.readUsage(dir): weekly and five-hour figures, fresh only, kept whatever the latest read's state (review 9:
  slice 1 keeps the last good figures through a failed read on purpose, and readUsage ages them out), and ignored when
  the record names another login than the account's. A fresh record whose state is 'ok' is a real
  usage call that worked for this login, so it stands for "signed in" (badge 'working'). A fresh 401 or 403 (usage or
  profile call) stands for 'rejected'. A blip after a fresh measurement (a 429, a server error, no answer, an expired
  access token) keeps it signed in (review 12, 14); anything else gives no badge: not a target, and not at risk by login. A 429 is
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
- A record that cannot be read leaves the sweep off (a log line), never the board, and is never written over: only a
  record that does not exist yet is an empty one (review 9). A tick cannot throw out of its timer.
- Recorded but not drawn (review 9): a decision with an account at risk and nothing that could move. The record, and
  Settings, are of what Kosmos would have moved.

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

## Review 10
- The end of a risk is written too (an empty decision), so a restart rebuilds "nothing at risk" and a risk that
  returns is recorded again; only a first tick with nothing at risk writes nothing.
- A write that starts failing is said once in the board's log and reported to Settings as not recording (the sweep's
  own tick still tries again each period).
- The login check is the board's own rule (usagepoll.sameLogin with the account's organization, as Settings' figures
  use), so one email signed in to two organizations is not mixed up.
- The guide's seeded name is read once per decision, so a guide record that cannot be read makes the decision
  unreadable ("could not work out"), not every agent "not idle".
- Where the sweep does not record, Settings says only that ("Kosmos is not keeping a record of what it would move on
  this computer"), not a reason it cannot know.
- Stated, so nobody reads the record as Settings' twin: it runs the same decide() on the cheap inputs 3b would use (no
  status-line readings, badges from the usage record rather than listLive), so at one moment the record and Settings
  can differ (Settings names a move while the record says held). The record is the 3b evidence, by design.
- Second weakest premise: slice 1 never measures an idle account whose access token has expired (token-expired), so
  overnight an idle spare account mostly reads unmeasured, and the record shows "held" more than a mover would see.

## Review 12
- A target stays signed in through one blip: the latest read worked, or a fresh measurement stands and the latest read
  was not a refused login (a 429, an unreachable endpoint, an expired access token). Otherwise every blip wrote the
  same would-move twice.
- A move off a stopped login stays in the file (evidence of the login problem) but is not drawn as a would-move in
  Settings, since slice 3b moves for usage only.
- Stated, not changed: the "not recording under a test" assert is satisfied by several gate arms at once (each arm is
  tested where it lives, in usagepoll); and a time the sweep was not watching (setting off, poll off) writes nothing,
  so a gap reads as "no change". A reader of a day's record should know the setting and the poll were on that day.

## Review 14
- Only those blip states keep a target signed in through a failed read. A signed-out account, another login's
  credential, or an answer that could not be read is not signed in, whatever figures survive from before it.
- An account that was at risk and now cannot be read is a gap in measuring, not the end of the risk (made exact in
  review 16, below).

## Review 15 (two warnings, both decided and stated rather than changed)
- The agents walk runs every tick once the setting is on with two accounts and the poll on, even when nothing is at
  risk. Kept: it is the same walk the Settings read already does on every read, once per 10 minutes, and building the
  rows lazily would split one rule into two paths. What would change it: a board where that walk is measured slow.
- A decision's key includes the agents' names, so agents going idle and busy on an at-risk account write new lines.
  Kept on purpose: which agents were free to move, and when, is exactly the evidence slice 3b needs (its two-tick idle
  rule is tuned from it). Bounded: at most one line a tick, 144 a day, so the 500-line record holds about three days.
  What would change it: the PM finding the record too noisy to read; then key on accounts only, or require a key to
  hold for two ticks before it is written.

## Review 16
- "Cannot be read" is exact now: a row is measured when a figure is still fresh, or its login was refused. Slice 1 rewrites a record's time on every poll, a failed one included, while its figures age out after 30
  minutes, so "a record exists" (review 14's test) was the wrong test: an at-risk account whose token expired, or that
  met one 429, read as measured with no risk, and its risk "ended" in the record.
- (Superseded by review 18: carrying an unmeasured account's entries, and reading "no credential" as signed out.)
- Something other than a file where the guide marker belongs is "cannot tell": not movable.
- The failed-write flag clears only when a write succeeds; the tick asks the gate without it, so the write is retried.
- AGENT_WORKFORCE_AUTOBALANCE_SWEEP_MS is an operator's setting (no test can tick), floored at a minute.

## Review 17
- A decision's key sorts each of its lists, so entries arriving in another order (an account carried through a gap is
  appended) never make one decision read as two.
- A failed-write flag clears when the decision matches the one the record already holds (nothing is left unsaid), not
  only after a later write.
- A tick that cannot work out the decision logs why, once per reason, so a code defect does not read as a quiet record.

## Review 18: when it cannot measure, it writes nothing
- A tick is a gap, and writes nothing, when an account that was at risk at the last recorded decision cannot be read
  now, or when an account at risk now has an agent list that may be short (decide's `short`: the walk failed or is
  incomplete). Reviews 16 and 17 tried carrying the unmeasured account's last entries instead; that kept old reasons
  alive past their reset and redrew them in Settings as new would-moves. Rejected for that reason.
- The cost, decided: a real change on another account during a gap is recorded only once the gap ends. In a record
  meant as evidence, a missed line is better than a false one, and the gap ends with the next good reading.
- "No credential" from slice 1 is not a signed-out login: slice 1 says it for any Keychain failure (a timeout, a locked
  keychain) as well, so one hiccup would have marked every account a stopped login. It gives no badge and is
  unmeasured. Settings' own live check is unchanged.
- Not taken: showing the recent lines while a write is failing (the page says it is not recording, which is true), and
  collapsing repeated moves in "Lately" (review 15's call stands).
