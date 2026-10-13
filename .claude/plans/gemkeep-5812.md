# gemkeep-5812: Gemini agents' file edits send the keep-copy call (undo copies now; #5812's writer record once projects are in its workspace)

**Branch:** `gemkeep-5812` · **Card:** kosmos#5812. Claude on Mac/Linux: #5821. Claude on Windows: #6033. This slice:
Gemini, on both. Codex, Grok and Antigravity stay on the card (each needs its own measurement).

## Measured (gemini-cli 0.61.0, this Mac, 2026-10-13; card comments 6146366245 and below)
A throwaway folder with a project-level `.gemini/settings.json` holding one BeforeTool hook, matcher
`write_file|replace`, logging its stdin; one headless prompt there (GEMINI_CLI_TRUST_WORKSPACE=true, per process):
- the hook's stdin: `{"session_id","transcript_path","cwd","hook_event_name":"BeforeTool","timestamp",
  "tool_name":"write_file","tool_input":{"file_path":"probe.txt","content":"hello"}}`
- 🔑 `file_path` arrives RELATIVE to `cwd`. The board resolves the path with `path.resolve(p)` (filewriters), against
  the BOARD's folder, so the bridge sends `path.resolve(cwd, file_path)`.
- a hook answering `{}` lets the write go ahead.
- Measured, second run (08:2x): a SILENT hook (prints nothing, as the bridge does) also lets write_file go ahead: the
  file was written with its content. The same run's `replace` step never ran: the API answered 503 six times and the
  session ended. So `replace`'s path field (`file_path`) is read from the CLI's code (EDIT_TOOL_NAME "replace", its
  params.file_path), not yet seen live.

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

## What this does and does not give today (review 1, confirmed in the CLI's code)
gemini-cli refuses write_file and replace OUTSIDE ITS WORKSPACE: write-file's validateToolParamValues calls
`config.validatePathAccess(resolvedPath)` on the resolved path, during validation, before BeforeTool fires. A Kosmos
Gemini agent's workspace is its own workers folder, and the supervisor adds no `--include-directories`. Project folders
live in ~/Kosmos/Projects, outside it. So:
- **Given today:** undo copies (#5153) of the files a Gemini agent writes or edits in its own folder. The board
  attributes them through undo.agentFor's folder match (the session id is Claude-shaped and never matches; the cwd is
  the agent's folder).
- **Not given yet:** the #5812 writer record for PROJECT files, because a Gemini agent cannot write one with these tools
  at all. That needs the agent's workspace to include its projects' folders (`includeDirectories` or
  `--include-directories`), a change to what a Gemini agent may write, which is its own decision and slice. With it,
  this hook records the writer with no further change.
- A live measurement of the refusal was attempted and failed on quota (429, daily quota exhausted on this Mac's key,
  partly by these probes; Splinter told 08:3x). The code read is the evidence.

## Weakest premise
That `cwd` in the hook payload is the agent's own folder (what `undo.agentFor` maps to an agent). Measured: it is the
folder gemini ran in, which for a Kosmos agent is its workers folder.

## Tests
- engine/geminisettings: the sixth hook is added with its matcher, left alone when correct, repointed when moved,
  another tool's hook untouched, a non-ours BeforeTool entry kept.
- bin/gemini-report-bridge: write_file and replace each POST /api/undo/keep with the resolved absolute path, cwd and
  session; nothing on stdout; another tool, another event, no path, a control character, a relative path with no cwd,
  and (win32) UNC paths send nothing; the report path for the five lifecycle events unchanged.
