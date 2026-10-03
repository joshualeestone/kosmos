# receipt2-5153: change receipts for Codex and Gemini CLI agents (#5153 slice 2)

Card: kosmos#5153. Routed by Splinter 2026-10-03 18:34 ("take #5153's next slice: receipts for Codex and Gemini agents,
reusing your #5158 per-provider counting... Still a count, no command text, no undo"). Merges after Monday.
Stacked on slice 1 (receipt-5153, PR #5184) with #5158 slice 1 (usageproviders-5158, PR #5163) merged in: needs both.

## What finished looks like
A closed task's receipt shows, for a Codex or Gemini CLI agent, the files it edited, how many commands it ran (a count),
and its tokens per model with the at-API-prices figure, counted only inside its holds, exactly as for a Claude agent.
Grok, Antigravity and Muse agents still say "not available yet".

## Reuse of #5158
Tokens come from engine/usageproviders.js's own readers and rules (Codex running totals by their change, forks and
resets; Gemini replies once per id). Two additive changes there: each reader passes the row's time as a fifth argument
to acc.add, and an optional acc.onRow(provider, row, file, folder) sees every parsed row; Acc, scanCodex and scanGemini
are exported. The receipt gives the readers an accumulator of its own that keeps only the agent's folder inside a hold.

## Tool calls (measured on this Mac 2026-10-03, read-only)
- Codex (23 rollouts): every call is a custom_tool_call named exec whose input is a script; `tools.exec_command(` is a
  command (13 files), `tools.apply_patch(` carries `*** Add|Update|Delete File: <path>` (7 files). Outputs begin
  "Script completed" (62 of 63; one abort). A patch counts as edited only when its output begins "Script completed".
  Older shapes (function_call shell/exec_command, local_shell_call) count as commands; an older standalone apply_patch
  is not counted as an edit (its success report was not measured).
- Gemini CLI (12 sessions): toolCalls carry id, name, args, status, timestamp. run_shell_command is a command;
  write_file and replace are an edit when status is success. A reply written twice: the latest status per id wins.
- Checked against an independent count on real folders: Codex 13 commands / 1 file, Gemini 13 / 1, equal.

## Weakest premise
That a Codex patch whose output does not begin "Script completed" changed nothing. Only completed outputs (and one
abort) exist here; a partial failure inside a script that still reports completed would count its patch. Shown as
"Edited", which errs toward an attempted edit only in that unmeasured case.
