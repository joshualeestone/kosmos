# builttell-6330: an agent's built mark tells the people the work goes to (#6330 slice 1)

#6330 (daily feedback, 2026-10-16): a handoff between agents still needs the next agent to poll to learn the earlier
step finished. Read with #6065 and #5679 (deliverable fingerprints), the card's "second request" condition is met; the
call is reversible, so it is an agent's to make (Josh's standing rule). Slice 2 (a sha256 fingerprint on the mark) is
not in this change.

## What a person sees
Nothing on the screen. An agent that marks a task built (`kosmos task built`) now has a one-line note typed to:
- the task's other assignees (its parts' holders), and
- the open holders, still on the project, of the nearest task above it that has any: its parent, else that task's
  parent, and so on, up the parent chain only (a closed task ends the walk),
saying "<agent> marked task N built: "<note>"" with how to reply in the task, and for a parent holder "(it is under
your task P)". The marker is never told. The answer gains `delivered`, one outcome per agent, as a task message's has.

## Rules
- Only an agent's NEW mark: not a clear, not the same mark again (`changed: false`), not the person's mark from the
  screen (the person knows they did it).
- The same filters as a task message (#768): a swarm switched off in this project is not told, an assignee who left
  the project is not told, and both are said in `delivered`.
- A closed parent hands nothing on (that branch's work is finished).
- Review 2: the first version fell back to `tasks.ownerIn`, which, when no ancestor is held, picks the lowest-numbered
  held task anywhere in the tree (a sibling), whose holder would be told "it is under your task" falsely; and parent
  holders who had left were dropped with no fallback. The walk up the chain replaces both.
- How often: the built-mark valve the route already applies (builtMarkRefusal) limits how many marks an agent makes;
  one mark sends one line to each recipient. A mark counts as new when its note or its marker changes, so re-marking
  with a different note, or a mark, clear, mark cycle, tells everyone again, up to that valve. Accepted: each is a
  real change to the task.
- The walk stops at the first held task above. If that holder's swarm is switched off it is reported, not skipped
  (it still owns the work); if the only holder there is the marker itself, nobody above is told (the marker is
  already the coordinator). Both deliberate.
- Review 5: `AGENT_WORKFORCE_TASK_MSG_CAP=0` (agent task messages switched off on this computer) switches these lines
  off too, and the answer says so. A project list that cannot be read while working out who to tell answers "Kosmos
  could not work out who to tell", never "nobody else is assigned". Deferred from review 5: the answer still waits
  for the slowest line, so one pane with a backlog can hold it past the Mac CLI's 15 s (the CLI then says it may
  still have happened, and a retry is a no-op). A task message has exactly the same exposure through the same CLI.
- Review 3: lines go to every recipient at once (different panes), so the mark's answer waits for the slowest line, not
  the sum (the Mac CLI waits 15 s); a failure for one recipient is that recipient's could_not and never hides the
  others. The answer also carries `summary` (taskMessageSummary, as a task message), and both CLIs print it.
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
