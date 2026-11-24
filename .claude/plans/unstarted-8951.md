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

## Challenge loop iteration 3 (opus)
- Fixed (WARNING): a Restart (the stuck-turn advice itself) was reported as "stopped right after a message reached it, the message may be what stops it". `lost` now needs the death within LOST_WINDOW_MS (10 s) of the last write (11-23: 0.6 s each); later, the waiting messages are carried as never started.
- Fixed (WARNING, in part): a cleared unstarted report never produced an end, so its push was emailed as unanswered. deliverystreak.unstartedGone, called by the server's minute sweep before acksDue, takes a session whose card no longer carries one off the open pushes. The plan's earlier claim that the hold makes the push go out "at least once" is withdrawn: tellStalls's own gaps (one stall push per 15 minutes, each agent once a day) still decide that, as for #7368's stuck step; the hold only gives the card one sweep to show it.
- Fixed (NIT): the board log says an unstarted report again when it grows (count and lost in its key).
- Fixed (NIT): the CLI line is counted and says the stopped case apart, as the page does.
- Mutations red: the lost window, the log key, the ack on clear, the CLI wording. The sweep's one call to unstartedGone is not itself tested; the function is.

## Challenge loop iteration 4 (sonnet)
- Fixed (WARNING): a card restarting, stopped or missing for a sweep (the Restart its own advice names) read as "cleared", so unstartedGone acked the push away while the report came back. Now it counts a clear only for a card on the board, reading idle or working, with no turn stall (a stuck step's push is still worth waiting on).
- Fixed (WARNING): `lost` was doing two jobs (wording, and "needs a later write"), and a carried report that was not lost could be ended by the new process's own start. `needsWrite` is now its own flag, set for any report carried from a stopped process; `lost` is wording only.
- Fixed (NIT): a fresh loss added to an old report inherited its expired hold; it now gets a fresh one.
- Fixed (NIT): tests for each, plus a check that the sweep calls unstartedGone before acksDue, a few lines apart.
- Mutations red: needsWrite, the fresh hold, the clear trigger.

## Challenge loop iteration 5 (opus)
- Root cause of three findings: report fields cleared in some places and not others. Now one endReport() resets every field (unstarted, reportAt, wroteAfterReport, needsWrite, reportRan, clearArmedFor).
- Fixed (WARNING): needsWrite was never cleared, so after a carried report ended, a later deadline report on the same process never ended on a late start.
- Fixed (WARNING): a report whose message ran inside the hold was carried by a stop during the hold, telling the person to resend something that ran. `reportRan` marks it the moment the messages are known to have run; stopped() does not carry it, and the deadline does not merge into it.
- Fixed (WARNING): a second report soon after a cleared one lost its only warning (the first push acked, a second blocked for a day). acksDue now waits while any of a push's agents shows an unstarted report, as it does for a streak.
- Fixed (NIT): messages the deadline merges into an old report get a fresh hold.
- Accepted (NIT): the sweep-order test checks the source text only (noted in iteration 3).
- Mutations red: endReport's needsWrite, not carrying a run report, the merge's fresh hold, the ack waiting on a showing report.

## Challenge loop iteration 6 (sonnet, a full state table of the report lifecycle)
- Fixed (WARNING): a write into a BUSY agent (behind a turn nobody wrote) counted as "the later write" at once, so the running turn's next event ended a carried report while the resent message only waited. It now counts when its own turn starts: at the result boundary it is taken at, or when the running turn's open calls all return and it joins that turn.
- Accepted (NIT): a deadline report merged into a carried one keeps needsWrite, so a late start of the merged message does not end it; another write's turn does. Conservative (it keeps saying "not started" a little long), and the carried messages in that report did not run.
- Every other cell of the table was traced and found sound (listed in the reviewer's report).
- Mutation red: counting a busy write at once. The round 3 restart test now ends the new process's own turn before the resend, as a real stream does.
