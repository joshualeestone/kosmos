# onestep-8286: say on the card when an agent has been on one tool call for minutes

Card: joshualeestone/kosmos#8286. Decision comment: https://github.com/joshualeestone/kosmos/issues/8286#issuecomment-6742314800

## What

On 11-08 an agent waited 40 minutes on one tool call (#8249) and nothing on the board showed it. The card's pill hover
and the agent's page now say "<Name> has been on one step for about N minutes: <tool>. If that is a long job, it is fine;
if not, open it to see what it shows." once one tool call has run 5 minutes.

## How

- The signal is the transcript: Claude Code writes the `tool_use` row when a call starts and the `tool_result` row when
  it ends (measured live). `engine/onestep.js` reads the agent's transcript found by `status.transcriptFor`: a stat
  first (a file written within 5 minutes cannot hold a 5-minute step), then the last 64 KB; the oldest open call, if
  older than 5 minutes, is the card's `oneStep { tool, since }`.
- `status.oneStepOf`: Claude Code cards only, never one already waiting on the person or stopped.
- `web/index.html` stateReason: the sentence for a working card, after #7368's Windows sentence, never on the tile
  (#6716), in #7368's words.

## Rejected

- A timer on the last report: the report hook sends PreToolUse at most once a minute and nothing when a tool ends, so it
  cannot tell a hung tool from a model writing.
- A PostToolUse report: the throttle can hide a hung call's start, and unthrottled it doubles every agent's reports.
- The pane's child shells: Bash only, and a pane read.

## Not covered

- Codex, Gemini, Grok and Antigravity agents (their transcripts differ), and Windows (the board reads no transcripts
  there today).
- An open call more than 64 KB above the end of the transcript.

## Proof

- engine/onestep-8286.test.js (13), docs/browser-checks/render-onestep-8286.js; nine mutation arms red; the page check
  red with the sentence removed; a sweep of 49 test files (1198 tests) green.
