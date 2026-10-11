# tkdrop-5842: a kept task message's outcome is recorded on its task

Card #5842, slice 2 of 2. Slice 1 (#5873) says, at send time, who a task message did not reach; this slice records what
happens later to a message kept for an agent out of usage (#5805, #5848).

## Done when
- A task message kept for an agent out of usage carries its task (project id and number) in the keep queue, passed by
  the task route at the keepTaskLine call (Baron: entries kept before this lack it, and they last a day at most).
- When the minute sweep types it after the reset, the task's conversation records `kept-sent` (to, from, delivery
  state). When it is dropped a day past its reset, it records `kept-dropped` (to, from), whoever sent it.
- The task page's activity reads: "Your message to Mona was sent after Mona's usage reset"; unconfirmed: "Kosmos tried
  to send your message to Mona after Mona's usage reset, but could not confirm Mona got it" (never "sent", review 1);
  dropped: "Your message to Mona was never sent: Kosmos kept it until a day after Mona's usage reset and could not send
  it in that time" (not "while out of usage": in that day a menu, a quota hold or a stopped agent can also block it,
  review 1). From an agent: "Leo's message to Mona ...".
- An entry kept with no task records nothing and is typed or dropped as before.
- Tests fail without the change (engine: 4 of 4 new fail on main's engine; page: the new phrase test fails on main's page).

## Calls
- The record goes in the task's own conversation (taskchat), the one place the person reads about a task, not in the
  message log (a task line has no row there) and not in a pane (the person has none).
- `from` empty means the person; the phrase says "Your". An agent's name is resolved through tkMemberName like every
  other activity row.
- Recorded through messages.recordTaskLineOutcome, called from limitqueue's onDelivered for task lines and from
  tellTaskLineDropped, so both outcomes go through one function. taskchat is required lazily there, as messages.js
  already does for progressTimes.
- Unconfirmed is said as such ("tried to send ... could not confirm"), never as sent.
- A line kept behind earlier messages (`behind`, no usage limit of its own) is recorded with `behind`, and the page says
  "sent once the messages ahead of it had gone" / "kept it for a day behind earlier messages", never a reset that did
  not happen (review 3).
- "Quietest first" (tasks.lastActivityOf): a dropped note is not activity, like a missed run; a sent one is, since an
  agent got the work (review 1).
- Rejected: telling the person in a direct message (a second place to look); recording only drops (the person also
  wants to know a kept message did go, which was Baron's third ask).

## Not in this slice
- Reading a task's conversation from the command line. No `kosmos task` command reads it today, so an agent cannot see
  these records either. That needs a new command on both the Mac and Windows CLIs; filed as #5874.
- tellTaskLineDropped still tells an agent sender in its pane, unchanged.

## Weakest premise
- An entry typed or dropped by a board older than this change records nothing, which is honest, but the person then
  sees no outcome for that one message. Entries last a day, so this window closes within a day of the update.

## Browser check
The activity row is plain text built by tkActPhrase, rendered by the existing paintTaskActivity; covered by
web.task-activity-768.test.js through the real render path. Trailer used.
