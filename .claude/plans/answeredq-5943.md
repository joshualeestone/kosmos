# answeredq-5943: an answered question stays the newest DM bubble

Card: kosmos#5943 (Josh, 2026-10-12, two reports). Builder: Angel. Coordinated with Mona Lisa (#5942, age wording).

## Done when
- A reported question shows in the DM at the time it was asked, with its age ("Asked 12 days ago"); later messages,
  including the person's answer, sit BELOW it and never make it look newly posted.
- A person can clear a standing question from the DM itself (no Engineering mode): "Answered, clear this". It clears
  the marker (the existing clear-selfreport route, by:'operator') and deletes no conversation; bubble and badge go on
  the next refresh.
- A person's DM to an agent with a reported question standing carries a one-line [kosmos] note telling the agent to
  decide: clear it (kosmos report clear) if the message answers it, otherwise leave it open and say what it still
  needs, or replace it. Kosmos never decides that the reply answered it.
- Automatic idle/working still cannot erase an unanswered request (#900 guard untouched).
- (Josh 09:18, widened) Fewer questions reach the person: Kosmos's agent instructions (engine/defaults.js) tie
  needs_you to the two-question reversibility test (both yes = decide it, report it as Decided), ask only for what
  fails it or what only the person has, and clear a question answered anywhere; `kosmos report needs_you` prints
  the test back at the moment of asking (no refusal). Decision comment 6126134225 on #5943.

## Design
1. engine/selfreport.js read(): `askedAt`, the `at` of the FIRST line of the trailing run of identical waiting reports
   (same state and same because), so re-reporting the same question does not re-date it; a different question does.
   Null unless the latest state waits on a person.
2. server.js DM GET: the question carries `at` = askedAt when the card's state is self-reported; a pane-only question
   (no report) stays undated and last, as today (it is on the screen now). `clearable` = reported state.
3. engine/chat.js withQuestionRow(): a dated question is placed in time (after the last row at or before it) with that
   `at`; dedup skips it when a real row from the agent with the same text sits at or after the asked time. Undated
   keeps today's behaviour (append, trailing dedup).
4. web/index.html: the question bubble shows "Asked <agoWords>" and an "Answered, clear this" button when clearable;
   the button POSTs clear-selfreport then reloads the thread. The question row is not speech for DM_SPOKE_AT, and gets
   no reaction bar (reactions key on stored rows).
5. server.js DM POST + engine/chat.js dmStandingQuestionNote(): the note rides like the reaction note (after the
   person's words, never on a numbered menu answer, never on the automatic hello).

## Rejected
- Auto-clearing on reply: the card forbids guessing the answer.
- A per-poll clock `at`: the reason the row was undated (#3419); askedAt is stable across polls.
- "Keep it open" by re-reporting with a reason: that would re-date the question; leaving it open does not.

## Weakest premise
That the self-report tail (TAIL_BYTES) still holds the first line of the run for an old question. A run longer than
the tail dates from the oldest line kept, later than the truth but never newer than the latest report.
