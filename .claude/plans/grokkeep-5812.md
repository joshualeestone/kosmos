# grokkeep-5812: a Grok agent's file edits record their writer and keep an undo copy (#5812 item 3)

## What
Grok 1.0.41 (the pinned build) runs a PreToolUse hook before its two file tools, `search_replace` and `write`, with
Claude-style snake_case fields beside its own camelCase ones: tool_name, tool_input.file_path (search_replace: relative
to the workspace or absolute; write: absolute), cwd, session_id. Measured 10-16 against the real CLI and a local fake
Chat Completions server (card comment 6222103286). This wires that hook to the board's `POST /api/undo/keep
{path, cwd, session}`, the call the Claude, Gemini and Codex hooks make: the undo copy (#5153) and changed-by (#5812).

## How
1. engine/groksettings.js: the hook file Kosmos owns ($GROK_HOME/hooks/kosmos-report-bridge.json) gains a PreToolUse
   entry, matcher `^(search_replace|write)$` (a regex over the tool name: measured firing for write, not read_file; a
   "" matcher fires for read_file, the control). HOOK_EVENTS (pinned to the bridge's report states) is unchanged.
2. bin/grok-report-bridge.js: keepRequestFor (the Gemini bridge's shape: refuse other events and tools, no path, a
   relative path with no folder, a control character, a win32 UNC path) and one bounded post for keep and report: the
   answer read under the timer, stdin let go once read (both lessons from the Codex hook's reviews).
3. No launch-time refresh (decided after review 4): agents made before this get the hook when they are remade, as
   Gemini's do on a Mac. A refresh was tried in reviews 1 to 4 and dropped: for a default-account agent the file sits in
   the person's own ~/.grok, and no reading of its content can tell an untouched older file from a person who deleted
   just the tool hook (the bytes are identical), so any refresh would put back a hook a person removed. The other way,
   a per-home stamp, is Kosmos state in a person's folder for a one-time upgrade; not worth it for this.

## Differences from the Codex slice, measured
- No trust record: hooks in $GROK_HOME/hooks run as they are (only project hooks need trust).
- Grok writes outside its workspace (a write to an outside folder went through), so project files can be attributed.

## Stated
- For a default-account agent the hook file is in the person's own ~/.grok, so their own grok sessions run the bridge
  before each edit too: bounded (about 5 s, near grok's own 5 s hook cutoff, which lets the edit through), harmless with no board listening, and the
  board takes a copy or notes a writer only for a session run inside an agent's own folder (the same known case as
  Claude's, engine/undo.js).

## Not in this change
- Edits through run_terminal_command (no path to read reliably; never guessed).
- Windows: the Windows form of the hook file carries no tool hook (a Windows grok's payload was never measured), and
  win32keyed does not refresh the file; a separate slice if wanted.

## Weakest premise
That the hook payload stays as measured on 1.0.41. Guard: the real-grok test (when grok 1.0.41 is installed) drives the
real CLI through the real bridge to a stub board, with a no-hook-file control.
