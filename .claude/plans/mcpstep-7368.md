# mcpstep-7368: #7368 follow-up, two measured seams and the MCP step words

Card: kosmos#7368 (merged in #7379, fa72732af8). This branch closes two of its "reasoned only" seams by measurement.

## Done means
- A hung MCP call's step on the card reads in plain words, not `mcp__server__tool`.
- The measured stream for a hung MCP call and for a refused tool call is replayed through the real publisher in tests,
  each with a mutation that goes red.

## Measured (Claude Code 2.1.312, `claude -p --output-format stream-json --verbose`)
1. A stdio MCP server whose tool never answers: after the `tool_use`, only `tool_progress` every 30 s, with
   `tool_use_id` and `parent_tool_use_id` both the hung call's own id. No timeout or `tool_result` in 150 s.
2. A permissions deny rule on `Bash(echo hi)`: a `system` event, subtype `permission_denied`, whose `message` is a
   plain string; then a main-agent `tool_result` with `is_error: true`.

## Change
- `engine/win32streamstate.js`: `toolWords(name)` turns `mcp__<server>__<tool>` into `<tool> from <server>`
  (underscores as spaces, Claude Code's `claude_ai_` prefix dropped, a plugin server as under Decided). Any other name unchanged.
- `engine/deliverystreak.turn-7368.test.js`: step-word cases, and two replay tests of the measured streams.

## Decided
- Words `using <tool> from <server>`. Rejected: the bare tool name (loses which service is stuck).
- Weakest premise: server names are whatever the person named them, so some read oddly; that is their word.
- The name splits at its LAST `__`. A server name is typed by a person and Claude Code turns each character it does not
  allow into `_`, so "my server (prod)" carries `__`; a tool name is a developer's snake_case. Rejected: the first `__`.
  Premise: tool names do not contain `__`. If one does, part of it is shown as the server.
- A plugin server (`plugin_<plugin>_<server>`) keeps everything after `plugin_`, shown once when the two halves match.
  It never guesses where the plugin name ends.
- A name that hides a token anywhere is shown as the mask alone, service included. One mask call per name, over
  the name and each suffix after an underscore (secretmask's patterns begin at a word boundary, which an underscore
  is not), so the shared mask cache gets one entry per name. Rejected: masking per underscore (hundreds of cache
  entries per tool call).
- A name longer than STEP_MAX * 3 characters is shown as before, not reordered: the step is cut there, and a reordered
  tail could put the start of a token in front of the cut.
- `one()`, which cleans commands and targets, is left exactly as on main. Rejected: cleaning invisible characters out
  of it on this branch: each way of doing it let some secret past the mask (a space inside a token, a joined token,
  DEL no longer a space). That is kosmos#7386.

## Mutation checks (run by hand in the worktree, code restored after each)
- `tool_progress` counted as activity: the hung-MCP replay test goes red.
- A `tool_result` with `is_error` not closing its call: the refused-call replay test goes red.
- The suffix tries removed (the name alone masked): the token-after-an-underscore case goes red.
- The whole-name mask check removed: the token cases go red.
- The long-name guard removed: the long-name case goes red.

## Not in scope
- Compaction mid-turn, a dropped >16 MB line, Windows itself: still reasoned only.
- A token split by an invisible character (C1, bidi) in a command, target or tool name: shown on main too; kosmos#7386.
- A tool name with a line break is shown as it is, as on main (the split does not cross a line).
