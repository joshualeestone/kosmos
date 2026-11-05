# kosmos#7989 slice 3: a file-owner notice that reaches the owner itself

Card comment with the design: https://github.com/joshualeestone/kosmos/issues/7989#issuecomment-6649114500

## What
Slice 1 writes an agents-only note in the project room when another agent is about to change a file whose owner
(`first`) is a different agent. The owner sees it only when it reads the room. This slice also queues the same notice
for the owner, and Kosmos's own Claude Code hook hands queued notices to the owner at its next turn as
`additionalContext`, so nothing is typed into its session.

## Pieces
1. engine/filenotices.js: a per-agent queue under the store (`filenotices/<session>.json`, 0600). `queue(owner, text)`
   keeps the room note's own text (filewriters.ownerNoticeText) with an id and a time, capped at MAX_PENDING (oldest
   dropped, counted). `take(owner)` returns and clears (the verb run by hand). `handOver(owner, {ack})` removes only the
   acknowledged ids and returns everything still waiting (the hook). Never throws.
2. engine/filewriters.js ownerNotice: when it posts a per-file notice (not the held-back one), it also queues it. Same
   throttle as the room note, so no new flood.
3. server.js: `POST /api/file-notices/take`, caller resolved like GET /api/inbox (token first, then pane; bare pane refused
   on an enforcing board). In LOOPBACK_AGENT_ROUTES, not REMOTE. Answers `{ ok, notices:[...], dropped }`, or text with
   `as=text`, or with `as=hook` and `ack=<ids>` a first line `ack:<ids>` then the hook JSON (empty body when there is
   nothing).
4. install/kosmos and tools/windows/kosmos-cli.js: `kosmos file-notices [--hook [--ack-file <path>]]` (parity). The
   ack file holds the ids last handed over; it is rewritten only after a 200, so a lost answer is acknowledged by nobody
   and handed over again.
5. install/kosmos-report-hook.sh: UserPromptSubmit runs `kosmos file-notices --hook` with a 1 s cap and prints what it
   says (only a JSON object starting `{"hookSpecificOutput"`). Silent on any failure. At most once per pane per 5 minutes
   (FILE_NOTICE_EVERY, a mark beside the heartbeat's), because the call holds up the turn.
6. Windows node hook twin: handed to Homer, not edited here.

## Weakest premise
One extra local call on every turn of every Claude agent costs nothing that matters. Measure the added time on this Mac.
Fallback if it is visible: a marker the board writes only when a notice is pending.

Measured 11-04 against a stub board on this Mac: about 200 ms per call as first written (the CLI started node to read
the board token), about 100 ms with an agent token alone. Board down: about 85 ms. Too much for every turn, so the hook
asks at most once per 5 minutes per pane. The marker fallback was rejected: the hook would need the store's data root,
which store.js works out per platform, and a second copy of that in bash is two copies of one fact.

## Known limits
- A notice is removed only once its id comes back, so an answer the hook never read is handed over again (first written
  as take-and-clear; three reviewers in a row found it lost notices on a busy board). The cost: a notice can reach the
  model twice when the hook read it but could not write the ack file.
  The "older notices were not kept" count is kept the same way: an acknowledgement subtracts only the count it was
  handed, so notices dropped after a hand-over are still told.
- The person's own Claude sessions (no agent token, no pane) make no call: the board could not say who is asking.
- The mark and ack file are keyed by a hash of the agent token, so two sessions sharing a pane key (no TMUX_PANE, or one
  %N on two tmux servers) do not overwrite each other's acknowledged ids. Without an agent token they fall back to the
  pane key and can: each would then be handed its own notices again on every call until they expire.
- `kosmos file-notices` run by hand clears every notice, including ones the hook handed over and the model may not
  have read yet.
- The notice quotes a file name another agent chose (cut to 120 characters, made safe by quotedName), and it now reaches
  the owner's model directly. The framing says it is a notice from Kosmos, not a request from the person.
- When a notice already handed over is pushed out by MAX_PENDING newer ones, it is counted as not kept although the
  model may have read it: an overcount, the safe direction.
- Windows sends the board token beside the agent token (every verb there does); reading it there is a file read.
- A notice can wait up to 5 minutes plus the owner's next turn. The mark is written before the call, because the hook
  cannot tell a failed call from one with nothing waiting; so a failed call (board restarting) also waits out the 5 minutes.
- Runners with no hook (Codex, Antigravity, Windows until its twin lands) never take theirs; the file stays, capped at
  10 and expired after a day on read.

## Not doing
Typing into the session; a notify.js kind; other runners (they keep the room note).
