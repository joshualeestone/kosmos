# museunsent-4612: when a Muse agent answers only in its own window, the DM says so and shows the answer

Card: joshualeestone/kosmos#4612 (split from #4569). Stacked on museqcard-4569 (#4611), which added the report
fields this reuses.

## Finished looks like
The person DMs a Muse agent; the agent's turn finishes with an answer but the agent never runs `kosmos reply`.
Instead of "Nothing back yet" (after two minutes), the DM shows at once: "It finished without replying here. What it
said in its own window:" and the answer, in a bounded, line-preserving block. It stays while the agent runs other
(room) turns; it goes once the agent replies here or a newer DM arrives. It reaches the board as soon as the DM's
turn ends: on the working reports of the turns queued behind it, or on the idle report when nothing is queued.

## Decisions
- Carried like #4611's count: musefront sends the turn's answer, dated by when its DM arrived, with its reports
  (`kosmosFinal` -> bridge -> `final` on POST /api/report -> selfreport keeps it on an idle or working report, cleaned and
  capped at 4000 characters). selfreport.read carries the run's latest answer across later reports. The thread route
  attaches it as `owes.unsent` only when the thread owes a reply and the answer's turn began at or after the owed
  message arrived.
- Shown at once, without the two-minute grace: the turn is over, so there is nothing left to wait for.
- The answer is shown, not only "it did not reply": it is what the person asked for, and what the Muse front already
  prints in the agent's window. Escaped, never HTML.
- Muse only for now (the Muse front is the only reporter of `final`). Claude's Stop hook could do the same later.
- Wording is first-cut, for Mona to change.

- Review round 1 (BLOCKER fixed): the answer carried is the one to the person's latest DIRECT message (the
  "to answer, run: kosmos reply" envelope, alone or inside a stop note), kept across the room turns that run after it
  until the next idle report. Before, it was the last turn's answer, usually a room post the DM went ahead of, which
  could put a colleague's room text under the person's DM.

- Review round 3: selfreport.read carries the run's latest answer across the reports after it, and the route no
  longer requires the latest report to be idle (a room turn running next made the DM say "Nothing back yet", falsely).
  A started or stopped report forgets it; the Muse front sends neither, so a restarted Muse agent keeps it, and the
  route still shows it only under a DM its turn began after. The answer is cut by characters, not UTF-16 units.

- Known limits (review round 4): an automatic idle report is not recorded while the agent has a standing blocked or
  needs_you (#900), so that turn's answer is not carried and the DM keeps "Nothing back yet"; and the answer lasts
  only within the last TAIL_BYTES (64 KB) of the report log. Both fall back to today's line, never a wrong answer.

## Weakest premise
That the DM envelope marks the turn that answered the person. The board keeps an older answer when a newer DM's turn
fails or has no words; what keeps it off the newer DM is the route alone (the answer's turn must begin after the
message), asserted by server.dm-owes-4340.test.js with the newer DM's own empty turn.

## Tests
engine/musefront.test.js (answer on idle, control failed turn; reporter payload; bridge Stop only, agy unchanged),
engine/selfreport.waiting-4569.test.js (kept on idle or working, cleaned, capped; needs_you / blank / bad time / none not kept),
server.dm-owes-4340.test.js (shown only for a later turn; still shown while a room turn runs and after it ends; not for a newer DM; not once replied; control no report),
web.dm-unsent-4612.test.js (line and escaped text at once; control: the old line and grace unchanged),
server.report-readback-2709.test.js (the route's pass-through; an idle or working report's answer is kept, a needs_you one's is not), and the
review-round tests in engine/musefront.test.js (a DM's answer across a room turn; stop note; failed or wordless DM
turns; every operatorDirect form) and engine/selfreport.waiting-4569.test.js (carried across reports; new run).

## Review (fresh loop after the rebase onto museqcard, 2026-09-30)
- The answer no longer waits for the queue to drain: it rides on the working reports of the turns queued behind the DM (bridge, selfreport and the throttle key accept it there). An idle report between turns was tried first and rejected: it breaks #4569's rule that idle comes only once nothing is waiting, and it blanks the queue line.
- The route's check is the only guard against an older answer under a newer DM; a server test now covers the newer DM's own empty turn.
- The answer is dated by when its DM reached the front, not by its turn's start: a DM queued behind a newer one would otherwise pass as that one's answer (a stop note, which has no receipt time there, keeps its turn's start).
- Each queued copy of a DM keeps its own arrival time (the same words can be sent twice), and a stop's note is dated by that stop's arrival. The answer rides on one working report, not every beat, so it does not fill the report tail selfreport reads.
- Known limits, both failing back to the old "Nothing back yet" line, never to a wrong answer: (1) while a deliberate needs_you or blocked wait stands, selfreport refuses the automatic working and idle reports (#900), so an answer riding on one is not recorded; the wait is the more important thing for the person to see. (2) One answer can be up to 4000 characters, about a quarter of the 64 KB report tail selfreport reads, so a long run of reports after it can push it out of the window.
- The DM envelope counts only at the start of the prompt (or after a stop note's own first line), so a room post quoting it further down is not taken for the person's DM. Escape drops the waiting DMs' arrival times with them.
