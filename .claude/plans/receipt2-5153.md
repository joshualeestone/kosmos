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

## Review 1 (opus): CLEAN, 2 conditional WARNINGs, both taken; NITs
- A forked Codex rollout replays the parent's tool calls: skipped by the token count's own rule (stamped at or before
  the fork, or before the first total), the reader passing { forked, forkAt, totals } to the hook. Test and mutant.
- The VERSION bump would rework a good slice 1 receipt kept before its transcripts were pruned: a VERSION 1 receipt
  with no Codex or Gemini agent is kept as it was (one with such an agent is worked out again). Tests both ways.
- NITs taken: a bad session file marks that agent partial instead of failing every agent's receipt; a relative patch
  path is resolved against the session's folder. Not taken (recorded): commands are counted from the script text (a
  loop is one, a quoted mention is one); an id-less Gemini call is not counted (no way to count it once); old tasks
  re-read the providers' files from the first hold's day until kept.

## Review 2 (sonnet): 1 WARNING, taken; NITs taken
- The fork skip also waited for the file's first total, which drops the first real turn's calls and edits (a turn's
  calls come before its total; for tokens that rule costs only one turn's usage): with a known fork time the skip is by
  time alone; the first-total rule is only the fallback when the fork's time is unknown (NaN no longer skips everything).
  The fork test now has no replayed total and a real call before the first total; the review-1 rule, the first-total
  rule alone and no skip each fail it.
- NIT taken: a file inside the agent's folder is shown by its short path under either spelling of the folder.
