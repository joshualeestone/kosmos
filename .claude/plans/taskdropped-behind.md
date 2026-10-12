# taskdropped-behind: the dropped-task-line pane tell uses the task page's words (kosmos#5805 follow-up)

Started 02:12 CDT 2026-10-12. Promised to Mona Lisa 2026-10-11 22:40, after her #5890 (#5842 slice 2) merged
(it did, 01:25 CDT), because it edits the same function.

## What
engine/messages.js tellTaskLineDropped told the sending agent "Kosmos kept it for a day while <to> was out of usage"
even for a line kept BEHIND earlier messages (entry.behind), where no usage limit applies. The task page and CLI
(engine/taskactphrase.js, web/index.html, #5890) say "Kosmos kept it behind earlier messages" or "while <to> was out
of usage", then "and could not send it within a day". The pane line now says exactly that.

## Decided
- Use the task page's words, not new ones: one sentence, two surfaces that agree. Rejected "gave it up a day after
  the reset" (my note from last night): the page does not say it, and a behind line names no reset.
- The board's stdout record ("dropped a day past its reset") is unchanged: it is the board's own log, not a person's.

## Tests
engine/limittask-5805.test.js: the existing drop test asserts the new sentence; a new test drops a behind line and
asserts "behind earlier messages" and no "out of usage". 18 pass. Mutant (behind arm removed): 17 pass, 1 fail.
Guards: engine.reachable 7/0, windows-coupling-audit-1732 8/0, windows-tests-1777 23/0. No other file asserts the old
words (grep, with a control that finds the new ones).
