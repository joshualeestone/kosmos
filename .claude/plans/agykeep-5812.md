# agykeep-5812: an Antigravity agent's file edits record their writer and keep an undo copy (#5812 item 4)

## What
agy 1.2.17 runs a PreToolUse hook before its two file tools, write_to_file and replace_file_content. The payload carries
toolCall.name, toolCall.args.TargetFile (absolute), conversationId and workspacePaths (no cwd field). Measured 10-16
against the real CLI and a local fake Gemini API, with HOME on a scratch folder (card comment 6225769167). This posts the
board's `POST /api/undo/keep {path, cwd, session}` from that hook, as the Claude, Gemini, Codex and Grok hooks do.

## How
1. engine/agyhooks.js: the Kosmos entry's PreToolUse matcher becomes `^(ask_question|write_to_file|replace_file_content)$`.
   PostToolUse stays ask_question only (the bridge reads any PostToolUse as working). Written before every agy launch,
   as today, so existing agents get it at their next launch.
   ONLY for agy 1.2.17 or newer (MIN_FILE_TOOL_HOOKS, review 1): the answer-cannot-stop-an-edit premise was measured
   there, and 1.2.11 denied on an empty answer. Older agy, an unknown version, and agyrefresh's repair keep ask_question only.
2. bin/agy-report-bridge.js: keepRequestFor + postKeep. The answer to a file tool is ASK, unchanged (every tool but
   ask_question gets ASK today); the keep is posted after the answer, bounded at 3 s
   (the bridge exits through process.exit, so a stalled answer body cannot hold it).

## Measured, the reason this is safe
- Under --dangerously-skip-permissions (the supervisor always passes it; a test now pins it) the edit goes ahead
  whatever PreToolUse answers: ask, allow or nothing. Without the flag, headless agy refuses the write whatever it
  answers. So the hook's answer cannot change whether an edit happens.
- agy waits for the hook to EXIT before it runs the tool (a hook that answered, then slept 2 s, saw the file not yet
  written), so a keep after the answer still lands before the write: a real undo copy.

## Versions
Measured on agy 1.2.17. agy auto-updated to 1.4.0 during the work, and the real-agy test passed on 1.4.0 as well.

## Stated (review 3)
- A person running agy BY HAND in an agent's folder reads the same hooks file: their edits get a keep and are taken
  for that agent's (the board matches by folder: the known case Claude's keep has, engine/undo.js), and without
  --dangerously-skip-permissions they get agy's own prompt before each file edit (the ASK answer every other tool
  already gets). Rare, and it fails toward asking.
- The real-agy test is OPT-IN (KOSMOS_REAL_AGY_TEST=1): agy updates its own binary, and a suite run must not update a
  shared agy under other agents. It passed by hand on 1.4.0; the suite runs the unit, spawn and timing arms.

## Stated (review 2)
- Unmeasured: what agy does when it kills a hook at its 5 s handler timeout after the hook already answered. The bridge's
  worst case (node start, the 1 s stdin bound, the 3 s keep bound, a 500 ms flush) sits near that limit only when the board does not answer;
  the answer is written first, so a kill lands after the decision.

## Not in this change
- Edits through run_command (no path to read; never guessed).
- Windows (Kosmos runs no agy agents there).

## Weakest premise
That the supervisor keeps launching agy with --dangerously-skip-permissions. Pinned by a test. If that ever changed, the
PreToolUse answer would matter again (agyhooks.js notes a missing decision denied on 1.2.11); the bridge still answers
ASK first, so the edit would go to agy's own prompt, as for every other tool today.
