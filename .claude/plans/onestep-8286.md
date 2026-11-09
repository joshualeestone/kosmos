# onestep-8286: say on the card when an agent has been on one tool call for minutes

Card: joshualeestone/kosmos#8286. Decision comment: https://github.com/joshualeestone/kosmos/issues/8286#issuecomment-6742314800

## What

On 11-08 an agent waited 40 minutes on one tool call (#8249) and nothing on the board showed it. The card's pill hover
and the agent's page now say "<Name> has been on one step for about N minutes: <tool>. If that is a long job, it is fine;
if not, open it to see what it shows." once one tool call has run 5 minutes.

## How

- The signal is the transcript: Claude Code writes the `tool_use` row when a call starts and the `tool_result` row when
  it ends (measured live). Other rows are written mid-call (review 1), so the file's time says nothing; only the open
  call's own row does. `engine/onestep.js` reads the last 256 KB of the transcript found by `status.transcriptFor`, cached
  per file on size and time; the oldest open call, if older than 5 minutes and not older than the tmux session, is the
  card's `oneStep { tool, since }`. MCP tools are named by their last part; sidechain rows are skipped.
- `status.oneStepOf`: a WORKING card, a pane tied to one of our agents, a Claude Code runner, not a Windows pane.
- `web/index.html` stateReason: the sentence for a working card, after #7368's and #7212's sentences, never on the tile
  (#6716), in #7368's words.

## Rejected

- A timer on the last report: the report hook sends PreToolUse at most once a minute and nothing when a tool ends, so it
  cannot tell a hung tool from a model writing.
- A PostToolUse report: the throttle can hide a hung call's start, and unthrottled it doubles every agent's reports.
- The pane's child shells: Bash only, and a pane read.

## Not covered

- Codex, Gemini, Grok and Antigravity agents (their transcripts differ), and Windows (the board reads no transcripts
  there today).
- An open call more than 256 KB above the end of the transcript (the longest hangs can show nothing).
- A Claude relaunched inside the same tmux session: only its new prompt row closes calls left open by the old run.

## Proof

- engine/onestep-8286.test.js (16), docs/browser-checks/render-onestep-8286.js; fourteen mutation arms red; the page check
  red with the sentence removed; a sweep of 49 test files (1201 tests) green; two blind review rounds (opus, sonnet),
  the second clean.
