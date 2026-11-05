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
5. install/kosmos-report-hook.sh: UserPromptSubmit runs `kosmos file-notices --hook` with a 2 s cap and prints what it
   says (only a JSON object starting `{"hookSpecificOutput"`). Silent on any failure.
6. Windows node hook twin: handed to Homer, not edited here.

## Weakest premise
One extra local call on every turn of every Claude agent costs nothing that matters. Measure the added time on this Mac.
Fallback if it is visible: a marker the board writes only when a notice is pending.

## Not doing
Typing into the session; a notify.js kind; other runners (they keep the room note).
