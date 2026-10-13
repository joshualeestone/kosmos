# winkeep-5812: the Windows report hook sends the keep-copy call (#5812, Windows half; #5153 on Windows)

**Branch:** `winkeep-5812` · **Card:** kosmos#5812 (reopened 10-13 by Angel's release check: built for Claude agents on
Mac and Linux, not on Windows, not for other providers).

## The gap, measured
On Mac and Linux, `install/kosmos-report-hook.sh` (PreToolUse, lines ~447-456) calls `kosmos keep-copy <file> <cwd>
<session>` just before Claude Code runs Edit, Write, MultiEdit or NotebookEdit. That one call (POST /api/undo/keep)
feeds two things on the board: the undo copy (#5153, only while the person's undo switch is on) and, since #5821, the
record of which agent is about to write a project file (#5812, engine/filewriters.js noteWrite).

On native Windows the hook is `engine/kosmos-report-hook.js` (the node twin, wired in exec form by reporthook.js). Its
PreToolUse branch only sends a throttled "working" heartbeat. It never calls /api/undo/keep, so on Windows no project
file ever shows who changed it last, and the undo switch keeps no copies.

## The change
- `keepRequestFor(evt)`: for PreToolUse with tool_name Edit, Write, MultiEdit or NotebookEdit, the file is
  `tool_input.file_path`, else `tool_input.notebook_path`; returns `{ path, cwd, session }`, or null. A path or cwd
  holding a control character is not sent at all, as the bash CLI refuses it (rewriting it would name a different file).
- `keepCopy(req, io)`: POST `/api/undo/keep` with `{ path, cwd, session }` and the same headers `deliver` sends (board
  token unless token-only, agent token, world header). Waits at most 3 s (the bash CLI's `-m 3`), never throws, and its
  answer changes nothing: the edit goes ahead whatever happens.
- `main`: for PreToolUse, the keep call runs on EVERY edit, before the heartbeat throttle can return early (the bash
  hook does the same: keep-copy is outside `heartbeat_due`). The heartbeat report is unchanged.

The server side is unchanged: `/api/undo/keep` already records the writer and keeps the copy for any caller.

## Not in this slice, said on the card
Other providers (Codex, Gemini, Grok, Antigravity): their bridges see no file-tool event before an edit today, so they
have nothing to send. That needs each provider's own hook support researched first.

## Weakest premise
That Claude Code on Windows sends `tool_input.file_path` as the same absolute path form the board's project folders
resolve to (filewriters resolves links and compares case-insensitively on win32). Not measured on a Windows box in
this slice; the Windows test box (EC2) can check it.

## Tests
`engine/kosmos-report-hook.keepcopy-5812.test.js`, through the exported `main` with an injected fetch:
- an Edit, a Write, a MultiEdit and a NotebookEdit each POST /api/undo/keep with path, cwd and session, before the
  report, and even when the heartbeat is not due (no report at all);
- the request carries the board token, the agent token and the world header, and token-only sends no board token;
- Bash, Read and an Edit with no path send nothing;
- a control character in the path or cwd sends nothing;
- a keep call that throws, refuses (500) or never answers still resolves 0, and the never-answering one returns within
  the 3 s bound (measured with an injected short timeout and a real clock).
Mutants: drop the keep call; put it after the heartbeat return; drop the control-character refusal.
