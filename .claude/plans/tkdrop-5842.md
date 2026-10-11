# tkdrop-5842: a kept task message's outcome is recorded on its task

Card #5842, slice 2 of 2. Slice 1 (#5873) says, at send time, who a task message did not reach; this slice records what
happens later to a message kept for an agent out of usage (#5805, #5848).

## Done when
- A task message kept for an agent out of usage carries its task (project id and number) in the keep queue, passed by
  the task route at the keepTaskLine call (Baron: entries kept before this lack it, and they last a day at most).
- When the minute sweep types it after the reset, the task's conversation records `kept-sent` (to, from, delivery
  state). When it is dropped a day past its reset, it records `kept-dropped` (to, from), whoever sent it.
- The task page's activity reads, never naming a reset time (the queue can count its day from arrival when the printed
  reset is unreadable, so a reset may not have been seen; reviews 1, 3, 4):
  sent: "Your message to Mona, kept while Mona was out of usage, was sent once Mona was back";
  unconfirmed: "Kosmos tried to send your message to Mona once Mona was back, but could not confirm Mona got it";
  dropped: "Your message to Mona was never sent: Kosmos kept it while Mona was out of usage and could not send it within
  a day" (not "because": a menu, a quota hold or a paused swarm can also block it; review 5). Kept behind earlier
  messages (`behind`): "kept behind earlier messages ... once the messages ahead of it had gone" / "kept it behind
  earlier messages and could not send it within a day". From an agent: "A message from Leo to Mona".
- An entry kept with no task records nothing and is typed or dropped as before.
- Tests fail without the change: every new engine and route test except the no-task CONTROL (which passes on main by
  design) fails on main's code, each recognised path was also broken in place and seen to fail; the page phrase tests
  fail on main's page.

## Calls
- The record goes in the task's own conversation (taskchat), the one place the person reads about a task, not in the
  message log (a task line has no row there) and not in a pane (the person has none).
- Whose message (review 7): "Your" only when the route marks it the person's (`person`, set only for a send from the
  screen), "A message from Leo" for a named agent, and "A message" for an empty `from` without `person`, which is an
  agent the route could not name, never the person. No possessive, so a name ending in s reads cleanly and is never
  re-cased. Names resolve through tkMemberName like every other activity row.
- Recorded through messages.recordTaskLineOutcome, called from limitqueue's onDelivered for task lines and from
  tellTaskLineDropped, so both outcomes go through one function. taskchat is required lazily there, as messages.js
  already does for progressTimes.
- Unconfirmed is said as such ("tried to send ... could not confirm"), never as sent.
- A line kept behind earlier messages (`behind`, no usage limit of its own) is recorded with `behind`, and the page says
  "sent once the messages ahead of it had gone" / "kept it behind earlier messages and could not send it within a day", never a reset that did
  not happen (review 3).
- "Quietest first" (tasks.lastActivityOf): a dropped note is not activity, like a missed run; a sent one is, since an
  agent got the work (review 1).
- Rejected: telling the person in a direct message (a second place to look); recording only drops (the person also
  wants to know a kept message did go, which was Baron's third ask).

## Not in this slice
- Reading a task's conversation from the command line. No `kosmos task` command reads it today, so an agent cannot see
  these records either. That needs a new command on both the Mac and Windows CLIs; filed as #5874.
- tellTaskLineDropped still tells an agent sender in its pane, unchanged.

## Deferred
- Review 4: a task or project deleted during the day a message was kept still gets its record written, making one small
  orphan file under task-chats. Recording is best-effort by design, and checking the task exists would add a store read on
  every sweep for a file nobody reads.

- Review 6: a kept line whose removal from the queue file failed is remembered only in memory, so after a restart it
  is typed or dropped again and recorded a second time. That is the queue's existing window (the line itself is typed
  twice then), and a second row says what happened.
- Review 6: "sent" for a line placed in the agent's input, as the app says "sent" for a placed direct message. The
  unconfirmed state is the only one worded differently.

## Weakest premise
- An entry typed or dropped by a board older than this change records nothing, which is honest, but the person then
  sees no outcome for that one message. Entries last a day, so this window closes within a day of the update.

## Browser check
The activity row is plain text built by tkActPhrase, rendered by the existing paintTaskActivity; covered by
web.task-activity-768.test.js through the real render path. Trailer used.
