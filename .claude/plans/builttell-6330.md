# builttell-6330: an agent's built mark tells the people the work goes to (#6330 slice 1)

#6330 (daily feedback, 2026-10-16): a handoff between agents still needs the next agent to poll to learn the earlier
step finished. Read with #6065 and #5679 (deliverable fingerprints), the card's "second request" condition is met; the
call is reversible, so it is an agent's to make (Josh's standing rule). Slice 2 (a sha256 fingerprint on the mark) is
not in this change.

## What a person sees
Nothing on the screen. An agent that marks a task built (`kosmos task built`) now has a one-line note typed to:
- the task's other assignees (its parts' holders), and
- the parent task's assignees, or, if nobody is on the parent directly, whoever holds it through its own parents
  (`tasks.ownerIn`, the task list's own derivation),
saying "<agent> marked task N built: "<note>"" with how to reply in the task, and for a parent holder "(it is under
your task P)". The marker is never told. The answer gains `delivered`, one outcome per agent, as a task message's has.

## Rules
- Only an agent's NEW mark: not a clear, not the same mark again (`changed: false`), not the person's mark from the
  screen (the person knows they did it).
- The same filters as a task message (#768): a swarm switched off in this project is not told, an assignee who left
  the project is not told, and both are said in `delivered`.
- A closed parent hands nothing on (nobody's work now, as ownerIn reads it).
- How often: the built-mark valve the route already applies (builtMarkRefusal) limits how many marks an agent makes;
  one mark sends one line to each recipient.
- An agent out of usage is not typed into: its line is kept and typed after its reset (messages.keepTaskLine, #5805),
  as a task message's is; every other line goes through chat.deliverAsync, as a task message's does.
- A delivery problem never fails the mark: it is recorded before anyone is told, and a throw answers 200 with nobody
  told.
- Review 1: a note is at most 300 characters (tasks BUILT_NOTE_MAX) and one line holds 9923 (messages.spillLimit), so the
  first version's "cut a long note to 140" could never run, and it was removed rather than tested.

## Decided
- **Through chat.deliver, like a task message.** Rejected: a new notification channel or a dependency field ("after
  task X"). The first needs a design; the second is a bigger change (Angel's 10-16 recommendation) and can come later.
- **Parent holders included.** The card's "next agent" is usually whoever is coordinating the parent; without a
  dependency field the parent is the only handoff the data records.

## Weakest premise
That agents want this line. A busy parent holder with many subtasks gets one line per subtask built. The valve bounds
the rate, and every line is one the parent holder would otherwise poll for, but if it proves noisy the parent arm is
one branch to drop.

## Tests
`server.builttell-6330.test.js` (route level, real sandboxed board): other assignees told and the marker not; the parent
holder told, once even when also on the task; a closed parent tells nobody; nothing for the same mark again, a clear or
the screen (each with the first mark as control); a departed assignee not told and said (a member on the same task as
control); alone with no parent, an empty list; and the typed lines themselves (placed, the wording, exactly two lines).
