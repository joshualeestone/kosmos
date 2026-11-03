# daydigest-7875: the feedback request comes with the agent's own day (kosmos#7875, item 1)

## Finished looks like
An agent asked for the daily product-feedback report in a session that remembers nothing of the day can run one
command and see its own day on this computer: what it and the person said to each other today, and which tasks it
changed today. The once-a-day ask (engine/feedbacknudge.js) tells it to run that command first. The command works
the same from the Mac/Linux CLI (install/kosmos) and the Windows CLI (tools/windows/kosmos-cli.js). Nothing new
leaves the computer: the digest is printed locally, and the report the agent writes is scrubbed and sent as before.

## Shape (decided)
- `kosmos feedback day` prints the digest for the agent the CLI already identifies as the writer
  (feedback.writer(env): its launch token, else its tmux window, never a guess). No agent identified: it says so and
  exits 1, rather than printing someone else's day.
- `engine/feedbackday.js`, pure where it can be: `digest({ name, date, readThread, readTasks })` returns lines;
  the CLIs only print. Readers injected so tests use fixtures (test-support/fleet), not the live store.
- Conversation: the direct thread (chat.readThread(chat.DIRECT, name)), messages whose `at` falls on `date` in the
  person's local day (feedback.dateKey, the same day the report is filed under). Counts both ways, then each
  message as time, who (you / the person) and its first line cut to 160 characters, newest last, at most 40.
- Tasks: tasks whose history today (taskchat.read) has a row this agent wrote (`by` its name): number, project id,
  and the kinds of change (created, built, assigned, ...), no titles. The report's own rules forbid task titles and
  contents, so the digest does not hand them over; the agent can look a task up itself.
- The nudge line gains one sentence: run `kosmos feedback day` first, since this session may be new.

## Rejected
- Typing the digest into the nudge itself: it would be long, it would land in the pane as typed text, and the
  person's words would be retyped into a terminal. A command the agent runs keeps the nudge short and the content
  where the agent reads it.
- Errors in the first version: no per-agent record of today's errors exists to read (delivery failures are kept per
  message, not per day). Named on the card as the next piece, not invented here.
- Project room posts: the card asks for "its messages"; the direct thread is where the person and the agent talk.
  Room posts can follow if the first reports still come out thin.

## Weakest premise
That "its day" is mostly in the direct thread and the task history. An agent that worked only in project rooms gets
a nearly empty digest. If that is common, room posts are the next source to add.
