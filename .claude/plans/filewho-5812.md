# kosmos#5812: show which agent last changed a project file

From feedback (2026-10-10, split from #5800): in a shared project one agent found its edit already made by another,
and neither knew. Ask: show who changed a project file last, and when.

## What exists (measured on cde6bb485)
- Kosmos has no record of who wrote a project file. listFiles rows are `{ name, size, modified }` (projects.js).
- Claude Code's PreToolUse hook (install/kosmos-report-hook.sh) already sends the path of every Edit, Write, MultiEdit
  and NotebookEdit to `POST /api/undo/keep` with the cwd and session id, whether the person's undo switch is on or off.
  undo.keep returns at once when the switch is off; undo.ownerOf maps the session (or folder) to the agent's name.
- No other provider's bridge reports file tools (Codex notify, Gemini and Grok lifecycle hooks, Antigravity
  ask_question only). The Windows JS hook does not send keep-copy at all.

## The call
- engine/filewriters.js: `noteWrite(file, who, now)` records `{ agent, at }` for a file inside a project's folder, per
  project, keyed by the project-relative name (the listFiles name). Only project files are recorded; anything else an
  agent edits is not. One small JSON file per project under the store; entries older than 30 days pruned on write.
- server.js `/api/undo/keep`: before undo.keep, resolve the agent with undo.ownerOf (exported) and note the write. A
  token-only caller notes only for itself (the same narrowing undo.keep applies). It never changes the route's answer.
- `writerOf(record, modifiedIso)`: the agent is shown only when its record is at most 2 minutes before the file's last
  change and not more than 2 seconds after it. A change with no record that recent shows nobody.
- The documents route annotates each row with `changedBy` (the agent's display name from the roster, or its session
  name when the roster has no card for it).
- The project's Files page shows "changed by <agent>" after the date when a row has one.

## Rejected
- Attributing by time alone (the agent working when the mtime moved): wrong exactly when two agents work at once.
- A Kosmos write verb agents must use: agents edit with their own tools.
- A new PostToolUse hook event: it would be exact (after the write) but rewires every agent's settings for a fact
  PreToolUse already carries; the 2-minute window bounds the difference.

## Weakest premise
The record is made before the edit, so it is a heuristic, wrong in two ways inside the window:
- an edit that then fails (an Edit whose old text no longer matches) leaves a record, and a change by anyone else in
  the next 2 minutes (the person, an agent with no hook, a shell write) is named for the agent whose edit failed;
- a write that waits on a permission prompt while a second agent writes the same file is named for the second agent.
The window is 2 minutes, not longer, because a real write follows its record within seconds and a short window fails
toward naming nobody. If either case shows up in practice, a PostToolUse record (after a completed write) is the fix.

## Gaps, stated
- Claude Code agents on Mac and Linux only. The Windows hook does not send the path; other providers report no file
  tools. Their rows show no writer, which is the honest answer.
- The rail's short file list shows size only and stays as it is.

## Tests
- filewriters: a note inside a project folder is recorded under its relative name; outside any project it is not; the
  window shows the writer for a change just after the record, nobody for a change long after it or before it; a later
  note by another agent replaces the writer; pruning.
- the keep route notes the writer with the switch off; a token-only caller cannot note for another agent.
- the documents route carries changedBy; the page paints "changed by" (lifted-function test).

## Review 1 (opus)
- FIXED: the "never a guess" claim was false inside the window (a failed edit's record); the window is 2 minutes and
  the plan states both ways it can be wrong.
- FIXED: the token-only narrowing on the keep route is tested through the server (an agent cannot note a write in
  another agent's name; its own is noted).
- FIXED: the agent lookup is paid only for a file inside a project (noteWrite takes a lazy lookup).
- DEFERRED: a lock on the per-project file. noteWrite is synchronous in the one board process, so two hook calls cannot
  interleave its read and write.
- NITs taken: the display name read once per request; the deepest project folder wins; realpathSync.native for the
  letter case on macOS.
