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
3. bin/agent-supervisor.sh: the grok launch refreshes our hook file with ensurePrepared (content-idempotent; rewrites
   only a file with our marker), so agents made before this get the hook and a wiped file comes back.

## Differences from the Codex slice, measured
- No trust record: hooks in $GROK_HOME/hooks run as they are (only project hooks need trust).
- Grok writes outside its workspace (a write to an outside folder went through), so project files can be attributed.

## Not in this change
- Edits through run_terminal_command (no path to read reliably; never guessed).
- Windows: grok there runs per turn through win32keyed, which does not refresh this file; a separate slice if wanted.

## Weakest premise
That the hook payload stays as measured on 1.0.41. Guard: the real-grok test (when grok 1.0.41 is installed) drives the
real CLI through the real bridge to a stub board, with a no-hook-file control.
