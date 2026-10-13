# gemkeep-5812: Gemini agents' file edits record who changed a project file (#5812, Gemini slice)

**Branch:** `gemkeep-5812` · **Card:** kosmos#5812. Claude on Mac/Linux: #5821. Claude on Windows: #6033. This slice:
Gemini, on both. Codex, Grok and Antigravity stay on the card (each needs its own measurement).

## Measured (gemini-cli 0.61.0, this Mac, 2026-10-13; card comments 6146366245 and below)
A throwaway folder with a project-level `.gemini/settings.json` holding one BeforeTool hook, matcher
`write_file|replace`, logging its stdin; one headless prompt there (GEMINI_CLI_TRUST_WORKSPACE=true, per process):
- the hook's stdin: `{"session_id","transcript_path","cwd","hook_event_name":"BeforeTool","timestamp",
  "tool_name":"write_file","tool_input":{"file_path":"probe.txt","content":"hello"}}`
- 🔑 `file_path` arrives RELATIVE to `cwd`. The board resolves the path with `path.resolve(p)` (filewriters), against
  the BOARD's folder, so the bridge sends `path.resolve(cwd, file_path)`.
- a hook answering `{}` lets the write go ahead. (A SILENT hook, which is what the bridge is, measured in a second run:
  see "Measured, second run" below.)

## The change
1. `engine/geminisettings.js`: one more hook, `BeforeTool` with matcher `write_file|replace`, running the same bridge
   command as the five lifecycle hooks. Same idempotent, merge-only, repoint-if-moved logic; "correct" also needs the
   matcher. Nothing else in the file changes.
2. `bin/gemini-report-bridge.js`: on BeforeTool for `write_file` or `replace`, POST `/api/undo/keep` with
   `{ path: <absolute>, cwd, session: session_id }` and the same headers the report sends (agent token, board token
   unless token-only, world header), at most 3 s, then exit having printed NOTHING (the edit is never held). The report
   path is unchanged: BeforeTool maps to no report state.
   Refused, nothing sent: a control character in the path or folder; a relative path with no folder; on win32 a UNC or
   device path or session folder (two leading slashes of either kind), as #6033 refuses for the same reason.

## Who gets it
- Windows: `win32keyed.js` runs ensurePrepared before every turn, so existing Windows Gemini agents get it on their
  next turn.
- Mac: ensurePrepared runs only when a Gemini agent is created. The default account's settings are one shared
  ~/.gemini/settings.json, so any new Gemini agent wires it for all of them on that account; until then an existing one
  shows no writer, as today. Stated, not fixed (the existing "wiped ~/.gemini" residual has the same shape).

## Weakest premise
That `cwd` in the hook payload is the agent's own folder (what `undo.agentFor` maps to an agent). Measured: it is the
folder gemini ran in, which for a Kosmos agent is its workers folder.

## Tests
- engine/geminisettings: the sixth hook is added with its matcher, left alone when correct, repointed when moved,
  another tool's hook untouched, a non-ours BeforeTool entry kept.
- bin/gemini-report-bridge: write_file and replace each POST /api/undo/keep with the resolved absolute path, cwd and
  session; nothing on stdout; another tool, another event, no path, a control character, a relative path with no cwd,
  and (win32) UNC paths send nothing; the report path for the five lifecycle events unchanged.
