# finalword-6066: a task's holder is told how to finish it when it posts its word (#6066)

Card: joshualeestone/kosmos#6066 (from feedback): "a review dependency can still show as open after the reviewer has
already posted a final decision". Reading and call recorded on the card first (comment 6150658217).

## Reading
Kosmos has no review-dependency object; the only reviewer is a repeating task's. The same report's other ask was
#5956 (a parent ready when its children pass), so the review is most likely a subtask or part given to a reviewer
agent. Its verdict goes in with `kosmos task message`, which records words and changes no state, so the review task
stays open and the parent never shows ready. `kosmos task built` already finishes it; nothing points the reviewer there.

## The call
`taskFinalWordHint` (server.js): when an identified agent that holds an open, unbuilt, non-repeating task posts in it,
the route's `summary` (printed by the Mac and Windows CLIs) ends with: "If that is your final word on it, kosmos task
built <project> <n> '<note>' marks it done, so nothing waits on it." Single quotes and no backslash, because the Mac
CLI reads `summary` with sed up to the first double quote; the project id is stripped of quotes and controls.

## Rejected
- Marking built when a message looks final: a guess from free text, and a wrong guess is a silent wrong state, which is
  the defect reported.
- A `--final` flag on task message: a second way to finish a task that an agent must already know about.

## Proven
- server.task-final-word-6066.test.js: the holder of a review subtask is told, with this project and task number; the
  named command really marks it built (it was not built before); no line for a non-holder, an unidentified sender, or
  (pure) a repeating, built or closed task; a project id cannot put a quote or backslash in.
- Mutations: the route not appending the line reds the 3 route tests; dropping the holder check reds the 2 non-holder
  tests.
- server.agent-token-gate-4491.test.js pinned the whole summary for a sender alone on its own task, which is exactly
  the case that now gets the line: it now checks the delivery sentence still leads and the line follows.
- The sibling task-message, summary, valve, token, guide-mask, limit, swarm, repeat and Windows CLI tests pass
  (217, 1 fail fixed as above).

## Weakest premise
The reading. If the reporter's review is recorded somewhere other than the task's own conversation (a room, a PR),
this does not reach it. And the reviewer still takes one step (built); "without a manual step" holds for everyone else.
