# unstarted-8951: a message taken in but never started on is reported, not left at busy (kosmos#8951)

Finished when: a Windows Claude agent that is written a message while idle and shows no sign of a turn (system/init, assistant, user or result) within START_DEADLINE_MS stops reading busy, its card says it took in the message but did not start on it (with how to recover), and the person gets the needs-you notice the other stalls send; a turn that does start clears it. The live Windows check (an idle agent after a long quiet stretch runs the message as a turn) is a device step, parked if no Windows box is free.

## Mac
Not the same path. Mac agents are interactive sessions in tmux: the board types into the pane, and a line left unsent is already caught (unsent-input, delivery streaks). No Mac agent runs Claude with stream-json input (grep: only engine/win32*, chat.js one-shot runs). So the enqueue-then-dequeue-with-no-turn shape cannot arise on a Mac through this path.

## Why the existing stuck-turn check (#7368) missed it
turnStuckOf needs BUSY for over an hour AND at least one message queued behind it. Each of the three messages may have been written while the record read idle (queued stays 0), or the clock was reset; either way nothing fired for 4 hours. Which one it was needs the win32-state file and supervisor log from the box (asked of Homer); the fix below covers both.

## Build
- engine/win32streamstate.js publisher: wrote() into an idle agent arms a start deadline (START_DEADLINE_MS, 5 min; measured start is ~50 ms). Any turn-start sign (init, assistant, user, result) disarms it and clears an earlier `unstarted`. When it fires with no sign: state IDLE (not busy), `unstarted: { since, count }` recorded on the file (count = this message plus any written behind it, added to an earlier one), and the supervisor's task log gets a line through opts.onUnstarted.
- unstartedFor(name): the file's `unstarted`, only for a live pid.
- engine/deliverystreak.js unstartedOf: a 'turn' stall with `unstarted: true`, its own words and next; turnLine words it on the board log.
- engine/status.js deliveryStallOf: for a Windows Claude pane reading idle or working, unstartedOf first.
- web/index.html: the card sentence for an unstarted turn stall. engine/clilists.js: no oneStepSince for it.
- engine/win32supervisor.js: onUnstarted says a line on the task log.

## Rejected
- Re-sending the message automatically: if the turn starts late it runs twice.
- A new status state: every coupling site would need it; the turn stall already means "arrived, waiting, not a sign-out".

## Homer's data (card comment 7119727791) changes the diagnosis
- Each of the three deliveries was followed ~0.6 s later by `homer died` (no exit reason) and `homer resumed` 0.4 s after. The resumed process never had the message: a crash on delivery that loses it.
- The state file was IDLE, not busy, through the 4 hours: the 01:55Z write set stepSince to its own time with no queued count, which a write does only into an idle agent. The card's "showed busy" was a reading of the file during the later live turn.
- So the main fix: a message written and not yet run (inFlight) when the process stops is carried to the next process's record as `unstarted` (lostOnStop), reported on the card, to the person and on the task log ("and it ended before running it"), until a turn starts. The no-turn deadline stays as the second guard (the enqueue-then-dequeue-with-no-turn shape without a crash).
- Rejected: re-delivering after the restart. All three messages killed the process, so the content may be the trigger; an automatic resend could crash-loop.
- Not done here, a separate question: why claude.exe dies on these messages. The died line carried no stderr, so there is nothing yet to work from.

## Challenge loop iteration 1 (opus)
- Fixed (BLOCKER): a resume with nothing to resume answers with one error `result` and no turn, which erased the carried report before any sweep saw it. A `result` now counts as a turn only after this process opened one (init, assistant or user); the report rides through that child and the fresh start.
- Fixed (WARNING): a message written behind a turn was dropped from tracking at the result. It stays in flight at the boundary and must open its own turn by the deadline.
- Fixed (WARNING): any turn cleared the report within a second, before the minute sweep showed or pushed it. It now ends only on a turn a LATER write opened, and not before REPORT_HOLD_MS (2 min).
- Fixed (WARNING): the page said "about 5 minutes ago" for a crash seconds old; the floor is a minute.
- Fixed (WARNING): the crash case is worded apart (`lost`): "stopped right after a message reached it ... the message itself may be what stops it, so try a shorter one". The deadline case keeps "took in ... never started on".
- Fixed (NIT): the stall's words are singular for one message.
- Accepted (NIT): idle Windows Claude cards now read their state file once more per poll (unstartedFor); stateFor already reads it, and the write retries once on a failed rename.
- Mutations red: the result gate, the kept-behind message, the hold, the later-write rule (after a test fix: the wake-up now comes past the hold, so only that rule keeps the report), the lost flag, not re-saying a carried report.

## Challenge loop iteration 2 (sonnet) and PigeonPete's read (card #8951)
- Fixed (WARNING, iteration 2): a write the deadline merged into an existing report still counted as "a later write", so a turn nobody wrote could end it while neither message had run. The merge now resets it.
- Fixed (NIT, iteration 2): the log line for a merged report keeps `lost` when the stopped process lost some of them.
- Fixed (PigeonPete, should-fix): a report the deadline made on the same process stayed on the card after the message started late and finished. Now a deadline report ends on any turn the same process opens (after the hold); a report carried from a stopped process (`lost`) still needs a turn opened by a later write. The round 1 test now uses a carried report; a new test covers the late start.
- Fixed (PigeonPete, nit): the #8951 block in deliveryStallOf sat between #7368's comment and its code.
- Mutations red: the merge reset, the late-start rule, the lost rule.
