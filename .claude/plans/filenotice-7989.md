# kosmos#7989 slice 3: a file-owner notice that reaches the owner itself

Card comment with the design: https://github.com/joshualeestone/kosmos/issues/7989#issuecomment-6649114500

## What
Slice 1 writes an agents-only note in the project room when another agent is about to change a file whose owner
(`first`) is a different agent. The owner sees it only when it reads the room. This slice also queues the same notice
for the owner, and Kosmos's own Claude Code hook hands queued notices to the owner at its next turn as
`additionalContext`, so nothing is typed into its session.

## Pieces
1. engine/filenotices.js: a per-agent queue under the store (`filenotices/<session>.json`, 0600). `queue(owner, {writer,
   projectId, name, at})`, `take(owner)` (returns and clears), capped at MAX_PENDING (oldest dropped, counted). Never throws.
2. engine/filewriters.js ownerNotice: when it posts a per-file notice (not the held-back one), it also queues it. Same
   throttle as the room note, so no new flood.
3. server.js: `POST /api/file-notices/take`, caller resolved like GET /api/inbox (token first, then pane; bare pane refused
   on an enforcing board). In LOOPBACK_AGENT_ROUTES, not REMOTE. Answers `{ ok, notices:[...], dropped }`, or text with
   `as=text`, or the hook JSON with `as=hook` (empty body when there is nothing).
4. install/kosmos and tools/windows/kosmos-cli.js: `kosmos file-notices [--hook]` (parity).
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
- The queue is emptied before the answer is sent, so an answer the hook never reads (1 s cap on a busy board) loses
  those notices. The project room's note keeps each one. Chosen over handing a notice over twice.
- A notice can wait up to 5 minutes plus the owner's next turn. The mark is written before the call, because the hook
  cannot tell a failed call from one with nothing waiting; so a failed call (board restarting) also waits out the 5 minutes.
- Runners with no hook (Codex, Antigravity, Windows until its twin lands) never take theirs; the file stays, capped at
  10 and expired after a day on read.

## Not doing
Typing into the session; a notify.js kind; other runners (they keep the room note).
