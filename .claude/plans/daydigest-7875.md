# daydigest-7875: the feedback request comes with the agent's own day (kosmos#7875, item 1)

## Finished looks like
An agent asked for the daily product-feedback report in a session that remembers nothing of the day can run one
command and see its own day on this computer: what it and the person said to each other today, and which tasks it
changed today. The once-a-day ask (engine/feedbacknudge.js) tells it to run that command first. The command works
the same from the Mac/Linux CLI (install/kosmos) and the Windows CLI (tools/windows/kosmos-cli.js). Nothing new
leaves the computer: the digest is printed locally, and the report the agent writes is scrubbed and sent as before.

## Shape (decided)
- `kosmos feedback day` prints the digest for the agent asking (feedbackday.recordWho), read under the token's own
  spelling (an older token with no spelling: its key), never under a key that differs from it: the key may be another
  agent's (a pane "mara", an older unnamed token), and wrong-empty is the safe failure, wrong-agent is not. Cost, chosen:
  a paneless token agent whose spelling is not its key ("Mara") reads empty, since the board keeps its records under
  the key. A token shared by two names is refused. No token: its window's agent name, exactly. A name that is not
  its own key ("Angel", "my.bot") has no thread at all (the board cannot file one), and its key form may be another
  agent's thread, so it is never read there: the digest says no conversation is kept under this name. A row from any
  other agent is neither "you" nor "them", so it is left out. No agent identified: it says so and exits 1, rather than printing someone else's day. Extra words: usage, 2.
- `engine/feedbackday.js`, pure where it can be: `digest({ name, date, readThread, listTaskFiles, readTask })` returns lines;
  the CLIs only print. Readers injected so tests use inline fixtures, not the live store.
- Conversation: the direct thread (chat.readThread(chat.DIRECT, name)), messages whose `at` falls on `date` in the
  person's local day (feedback.dateKey, the same day the report is filed under). Counts both ways, then each
  message as time, who (you / the person) and its first line cut to 160 characters, newest last, at most 40.
  Kosmos's own lines in the agent's name (`kosmos: true`) are not messages, so skipped; a menu answer (`wire`) is the
  person's own message and is kept; a resend recorded as a copy (`delivery.duplicateOf`) is not counted twice.
  The setup guide's conversation is never read or printed: what the person pasted to it (keys) is never shown back
  (server.js guideMaskedRows), and a guide check that cannot tell counts as the guide.
- The window identity is TMUX_PANE with no token, as outbox.resolveKeepSender accepts. `kosmos inbox` refuses that on a
  board that enforces auth; this reads the local store directly, which any process of this user can already read, so
  the difference is deliberate.
  A name Kosmos keeps no conversation under (chat.threadFile refuses it) says exactly that, not "could not read".
  The digest's header asks the agent not to copy names, project names, task numbers or the person's words.
- Tasks: tasks whose history today (taskchat.read) has a row naming this agent as its author: a task it created
  through the CLI (`addedBy`, with `addedVia: 'process'`, as tasks.js AGENT_ROW does), and a mark, run, reopen or move it
  made (`by`). Most rows name nobody (said, closed, holds),
  so those cannot count. Number, project id and the kinds of change, no titles. An absent task folder is "none"; an
  unreadable folder, or a transcript in it that cannot be inspected or opened, says so. The report's own rules forbid task titles and
  contents, so the digest does not hand them over; the agent can look a task up itself.
- The nudge line gains one sentence: run `kosmos feedback day` first, since this session may be new. The Project
  Manager's own instructions (engine/roles.js), which carry the same four questions, say so too.

## Rejected
- Typing the digest into the nudge itself: it would be long, it would land in the pane as typed text, and the
  person's words would be retyped into a terminal. A command the agent runs keeps the nudge short and the content
  where the agent reads it.
- Errors in the first version: no per-agent record of today's errors exists to read (delivery failures are kept per
  message, not per day). Named on the card as the next piece, not invented here.
- Project room posts: the card asks for "its messages"; the direct thread is where the person and the agent talk.
  Room posts can follow if the first reports still come out thin.

## Known limits
- A thread that rolled over today (chat.js keeps 1000 rows, then continues a new file) is read from the current file
  only, so a very busy day's counts can understate. Rare; left for the reports to show whether it matters.
- The Mac/Linux CLI arm's own script is run in the test with nobody identified (the refusal path); its printing path
  is the same digest the Windows handler test runs. The test file is in tools/windows-tests.js ALSO, so it runs on a
  Windows host too.

## Weakest premise
That "its day" is mostly in the direct thread and the task history. An agent that worked only in project rooms gets
a nearly empty digest. If that is common, room posts are the next source to add.
