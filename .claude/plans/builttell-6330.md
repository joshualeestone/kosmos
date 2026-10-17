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
your task P)". A marker that identified itself (token or pane) is never told; an unidentified caller cannot be excluded. The answer gains `delivered`, one outcome per agent, as a task message's has.

## Rules
- Only an agent's NEW mark: not a clear, not the same mark again (`changed: false`), not the person's mark from the
  screen (the person knows they did it).
- The task's own assignees come from tasks.whoOf, as a task message's do (#768), so one whose own part is already
  closed is still told: the task they worked on is now built. Above the task only OPEN holders count, because a
  closed part there is not the work this task hands to.
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
  could not work out who to tell", never "nobody else is assigned". Review 11 (raised in 5, 8 and 11, so fixed rather than
  deferred again): the typing of each line holds the answer at most BUILT_TELL_WAIT_MS (10 s, under the Mac CLI's 15 s; the quick checks before it are not timed); a line
  still being typed then is said as unconfirmed ("may have been told") and is still typed after the answer.
- Review 7: the lines go through the task-message valve (taskMessageRefusal / taskMessageValveRecord), so the
  operator's AGENT_WORKFORCE_TASK_MSG_CAP governs them at any value, not only at 0: refused, the mark stands and the
  answer says nobody was told and why; told, the mark counts once against that valve, spent the moment it is admitted.
- Decided (reviews 14 and 15 pulled opposite ways): ONE valve unit per mark, not one per line. #768 spends one unit per
  task message whatever its audience, so the cap counts messages, and a built mark is one message to its audience.
  Rejected: one per line (review 14), which made a built mark cost N where the same task message costs 1 and could lock
  real task messages out. Spending it at admission, not after the lines, keeps concurrent marks from slipping past the
  cap for the 10 s a line may wait. A line that then fails still spent it, as a task message does.
- Decided (review 15): a line kept for an agent out of usage goes through messages.keepTaskLine and so reads, when typed
  or dropped, in task-message words ("a message from mona ... was sent", "send it again"). The line itself is correct;
  only the later notice's wording is a task message's. Kept as is: a follow-up card for keepTaskLine to take a kind,
  rather than a second copy of #5805's queue here. This
  replaces review 5's cap-0-only switch.
- Decided (review 7): the lines go through chat.deliverAsync, not the automatic sender's gate
  (deliverAutomaticAsync). A built line carries the marker's own note, sent on its behalf, exactly as a task message
  carries an agent's words, and task messages are exempt from that gate by decision; the assignment notice (heardBy)
  is not gated either. If the gate should cover agent-originated lines, that is one change for task messages and
  built lines together, not this slice.
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
- **Through chat.deliverAsync, like a task message.** Rejected: a new notification channel or a dependency field ("after
  task X"). The first needs a design; the second is a bigger change (Angel's 10-16 recommendation) and can come later.
- **Parent holders included.** The card's "next agent" is usually whoever is coordinating the parent; without a
  dependency field the parent is the only handoff the data records.

## Weakest premise
That agents want this line. A busy parent holder with many subtasks gets one line per subtask built. The valve bounds
the rate, and every line is one the parent holder would otherwise poll for, but if it proves noisy the parent arm is
one branch to drop.
It is also a security trade-off, not only noise (review 10): a member agent's note (at most 300 characters, quotes and
newlines stripped) now reaches the holders of the nearest held ancestor, who have no part in the task, where a task
message reaches only that task's assignees. Bounded by the task-message valve and the same trust as a task message (any
member agent can already mark any task and message any task's assignees); if it proves a channel for abuse, the parent
arm is the branch to drop. An unidentified caller (no token, no pane that resolves) has the same reach, named "An
agent", and cannot be excluded from its own lines; that caller can already mark any task and send any task message,
so it is the same trust, and closing it is a change to how the route identifies callers, not to this slice.
A line still being typed when the answer goes keeps no record of how it ended beyond a stderr line on failure.

## Tests
`server.builttell-6330.test.js` (22 cases, route level on a real sandboxed board, plus the real Mac CLI): who is told
(other assignees; the nearest held ancestor; once when on both; a held sibling never; holders who left skipped; a closed
parent tells nobody); when (not for the same mark again, a clear or the screen, each with a first-mark control); the
typed lines themselves (wording, quoting, exactly the expected count); swarm-off, departed and out-of-usage recipients
(each with a member control); the task-message valve at cap 0 and past a low cap (the mark stands); a solo mark (no
summary, not refused at cap 0); a pane still typing after the wait (unconfirmed, with a control); failures (a throw, an unreadable project list, one recipient's own step) never fail
the mark or claim nobody was told wrongly. `tools.windows-kosmos-cli-570.test.js`: the Windows CLI prints the summary,
and nothing from an older board. Review 9: the valve is asked only when a line would be attempted (not for a list of
only switched-off or departed recipients), and a valve count is spent only then; concurrent marks can overrun the cap by
the number in flight, as task messages can.
