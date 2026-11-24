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

## Challenge loop iteration 7 (opus, state table)
- Fixed (WARNING, the premise): the fix assumed each 11-23 death came before any turn opened. That order is not established: Homer's transcript has no user entry or reply, but a turn's init goes to the stream, not the transcript, and a turn opens ~50 ms after a write while each death came at ~0.6 s. Now a turn still open when the process ends within LOST_WINDOW_MS of the last write carries the message it opened on (turnMsg, kept until that turn's result) as lost, with any written behind it. Either order is reported. A turn that reached its result, or a death long after the write (a Restart mid-turn), is not counted.
- Fixed (WARNING): a deadline merge left the busy-write marker (queuedAfterReport) armed, so a wake-up turn's returning calls could end a merged report none of whose messages ran. The merge and a result with nothing taken now clear it.
- Mutations red: carrying the open turn, the merge clearing the marker, the result ending the turn.

## Challenge loop iteration 8 (sonnet, state table)
- Fixed (WARNING): a wake-up turn with a message written behind it set turnMsg (count clamped to 1), so one message was counted twice. turnMsg is set only when more is in flight than waits behind (a written message opened the turn), with no clamp.
- Fixed (WARNING): turnMsg was counted when the stop came soon after the LAST write, so a long-run turn plus one write just before a Restart read as lost. turnMsg now carries its own open time, and only a stop within LOST_WINDOW_MS of the turn opening counts it.
- Accepted: a Restart within 10 s of a write still words the waiting message as "stopped right after it reached it". A stop that soon cannot be told apart from a crash by timing, and the message did not run either way.
- Mutations red: the opener rule, the turn's own clock.

## Challenge loop iteration 9 (opus, the whole diff plus a state table)
- Fixed (WARNING): a message taken into a running turn when its calls returned dropped out of tracking when a written message had opened that turn. It is now kept as `takenMsg` on its own clock (when it joined) until the turn's result, and is no longer in flight, so it is counted once.
- Fixed (WARNING): `lost` still keyed on the last write, so a message counted because its turn opened within seconds of the stop was worded "never started". Any counted open turn (turnMsg or takenMsg within the window) is now `lost`.
- Every other cell, and the other files' agreement with the record, traced sound by the reviewer.
- Mutations red: counting the taken message, wording an open turn as lost, not double counting at the boundary.

## Challenge loop iteration 10 (sonnet), and a redesign
- Finding (WARNING): two messages joining a turn a minute apart shared one clock, so a stop just after the second also counted the first, which had run. Iterations 6 to 10 had each found a narrower timing case in the same counters (inFlight, turnMsg, takenMsg, queuedAfterReport): the shape was wrong, not one line.
- Redesign: one record per message, `msgs: [{ since, ready, startedAt, afterReport }]`, replacing all four counters.
  - wrote: pushes a record; `ready` when written into an idle agent; `afterReport` when a report was showing.
  - a turn opening with no message under way starts every ready message (Claude Code may take several into one turn; marking one would later call the rest "never started"). A wake-up starts none.
  - the main agent's calls all returning starts every waiting message (they join the turn).
  - a result removes the messages that ran and marks the rest ready (their own turn is next, by the deadline).
  - the deadline takes the messages not started into the report and drops them from the list.
  - a stop carries messages started within LOST_WINDOW_MS of it (`lost`) and messages not started.
  - a carried report ends only when a message with `afterReport` starts.
  - capped at MSGS_MAX (500) records.
- All 30 earlier tests pass unchanged on the new model; a new test covers the two joins a minute apart.
- Mutations red: the per-message window, the ready gate, joining starts them, a result removes what ran, afterReport.

## Challenge loop iteration 11 (opus)
- Fixed (WARNING): iteration 10's "start every ready message when a turn opens" contradicted this module's own measurement (each message is its own turn, never batched), so a second waiting message was marked started and dropped at the next result, and could be lost in silence. A turn now opens on the oldest ready message only; the comment says so. My weakest premise in iteration 10 was exactly that guess, and the measured header settled it.
- Fixed (NIT): a message written after a carried report that joins a turn when its calls return set the flag after that event's reportRan had run, so a stop before the next event carried the report again. reportRan now runs again after the join.
- Mutations red: oldest only, the join ending the report.

## Challenge loop iteration 12 (sonnet)
- Fixed (WARNING): a subagent's event (parent_tool_use_id) counted as a turn opening, so a background subagent's event after a result could disarm a waiting message's deadline and mark it started. Only the main agent's events open a turn now, as the join path already filtered.
- Mutation red: the subagent filter.

## Challenge loop iteration 13 (opus, the whole diff and the whole test file)
- Fixed (WARNING): whether a message waits behind a turn was read from the busy state, which a background subagent's event sets with no main turn open, so a message that ran was reported as never started (and the person told to send it again). It is now `mainTurnOpen` (the first main-agent event opens a turn, its result ends it). A write whose callback comes within OPEN_RACE_MS (1 s) of a main turn that opened on no message is that turn's opener (the bytes reached the agent before the callback). One deadline per run of unstarted writes.
- Fixed (WARNING): the deadline dropped reported messages from the list, so a late start of one was credited to a newer message, which could then be lost in silence. Reported messages stay, marked `reported`, are matched to their own late start, and are never counted at a stop. A deadline report ends once its reported messages have started (not on any turn). When a report ends, its messages that never started leave the list.
- Decided, with its cost: a turn that opens after reported messages is credited to them as a late start. A wake-up cannot be told from a late start in the stream. The cost of crediting is that a truly dropped message is taken to have run; the other way silences a newer one. Two earlier tests (reviews 2 and 7) built exactly that indistinguishable turn and now expect the credit; the guard that a wake-up with NOTHING reported cannot end a carried report still holds.
- Fixed (NIT): MSGS_MAX now has a test that can fail.
- Removed after mutation testing: two clauses no reachable state distinguishes (a reported message is always ready; finished records are always the oldest), with the reason in the comments.
- Mutations red: main turn not busy, the race opener, reported messages kept, the cap.
- My regression, caught by the neighbour run: the race-opener rule also skipped #7368's `queued` count, which broke three #7368 seam tests (their recorded streams open a turn on no message, on a fixed clock). `queued` is #7368's display and is counted as before; the opener rule changes only this module's records. I pushed b5dde867c7 before running the neighbours that round; the fix is the next commit.

## Challenge loop iteration 14 (sonnet)
- Fixed (WARNING): a reported message that started late stayed in the report's count, so the card (and a restart's carried report) still said it had not started. Its start now takes it out of the count.
- Mutation red: the decrement. Neighbours run BEFORE this push: 961 pass, 0 fail.

## Challenge loop iteration 15 (opus, the whole diff and the whole test file)
- Fixed (WARNING): since iteration 14 a reported message that started late left the count, and a stop then skipped it (reported ones were taken to be in the carried report), so one that died within seconds of its late start was counted nowhere: the 11-23 silence again. A stop now counts every message that started within LOST_WINDOW_MS, reported or not; it cannot double count, since a started one has left the report's count.
- Fixed (WARNING), and a correction to iteration 13's decided cost: crediting a turn to the oldest ready message gave a resend's own turn to the reported message it replaced, so the resend (the card's own advice) was then falsely reported, and every resend after it. A turn now opens on the oldest ready message NOT yet reported, and a reported one is credited only when none other is ready. Iteration 13 recorded only one cost of crediting; this was the second, and the worse one.
- Fixed (NIT): after a reported message starts, `since` names the oldest one still waiting.
- Fixed (NIT): the board log says an unstarted report again only when it grows or turns into a stop, not when it shrinks.
- Fixed (NIT): the PigeonPete test asserted a truthy record that could not fail once the count reaches 0; it now asserts the count.
- Mutations red: resend first, the reported late start counted, the shrink not said. Neighbours before push: 964 pass, 0 fail.

## Challenge loop iteration 16 (sonnet)
- Fixed (WARNING): iteration 15's board-log rule kept the last report said after the report cleared, so a second loss no larger than the first was never logged. A card that reads clear (idle or working, no turn stall, the same clear rule unstartedGone uses) now forgets it; a restarting card does not, so a report is not said twice across a Restart.
- Mutation red: forgetting on clear. Neighbours before push: 965 pass, 0 fail.

## Challenge loop iteration 17 (opus, full)
- Fixed (WARNING): the join started every waiting message, so a resend's tool call returning marked the reported message it replaced as started, and the report cleared though it never ran. A reported message now joins only a turn credited to a reported one (`turnOnReported`).
- Fixed (WARNING): a carried report with a deadline report merged into it ended on a later message's turn and dropped the merged message unsaid (iteration 6's accepted cost became a silent loss after iteration 15). When the carried part is over, the report becomes this process's own for the reported messages it has not started.
- Fixed (WARNING): the unstarted report outranked #7368's stuck step on the card, so a step stuck for an hour with messages behind it said "send it again". The stuck step comes first again; with no stuck step the report shows.
- Fixed (NIT): the push test now asserts the turn kind in the id.
- Mutations red: whose turn decides the join, the carried report handing on, the stuck step first. Neighbours before push: 969 pass, 0 fail.

## Decided cost, stated once for the reviewers
- The stream carries no message id, so which waiting message a turn belongs to is inferred from order and timing. Where two orders are equally possible, the rules prefer the one that can only over-report (a message said not started that did run, which costs the person one resend of a message they can see) over the one that can under-report (a lost message never said). Over-reports of that kind in rare interleavings are accepted, not bugs.

## Challenge loop iteration 18 (sonnet)
- Fixed (WARNING, an under-report): the join started every waiting message, so of two messages written back to back before a turn opened, the second was marked started when the first turn's call returned and dropped at its result, though its own turn was next (measured: back-to-back writes run as two turns). Only messages written behind an open turn (not ready) join it now; a reported one joins only a turn that is a reported one's.
- Removed (was an under-report, a NIT): iteration 13's guess that a write landing within 1 s of a turn opened on no message is that turn's opener. It could lose a message queued behind a wake-up. Without it, the rare race (a turn's init before the write's callback) can only over-report, which the stated cost accepts; its test now pins that.
- Mutation red: the join taking only messages behind the turn. Neighbours before push: as below.
