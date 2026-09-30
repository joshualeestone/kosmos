# #4491 slice 8: automatic status reports honour KOSMOS_AGENT_TOKEN_ONLY

Card: joshualeestone/kosmos#4491 (claimed:angel). Branch report-token-only-4491, off main 146169488. Independent of
the stack: it touches only the report hook and the four bridges, none of which the stack changes.
Addresses #4491 (the card stays open).

## What finished looks like
With KOSMOS_AGENT_TOKEN_ONLY exactly `1` and a usable agent token, every automatic status report an agent's
provider sends (the Windows Claude hook, and the Codex, Gemini, Grok and Antigravity bridges; the Muse front
reports through the Antigravity bridge) carries the agent's token alone and does not read the board token. Anything
else sends exactly what it sends today. Slice 7 (branch cli-token-only-4491) did the same for the two CLIs, and the
Mac report hook goes through `kosmos report`, so with both slices every report path honours the one switch.

## The change
- bin/codex-report-bridge.js, bin/gemini-report-bridge.js, bin/grok-report-bridge.js, bin/agy-report-bridge.js: the
  existing board-token read is skipped when the agent-token header is set and the switch is exactly '1'.
- engine/kosmos-report-hook.js (main): the same rule; the board token passed to deliver is null then, and
  readBoardToken is not called.
- One test per path: the switch off sends both (the control), on sends the agent's alone, and no token, a junk
  token, or a switch other than '1' keeps the board token.
- The three bridge tests' shared drive() now sets the switch to '' unless a test sets it, so a machine running the
  tests with the switch on cannot change the older #1968 tests in those files.

## Why POST /api/report takes the token alone
It is in REMOTE_AGENT_ROUTES (exempt at the gate), and its handler accepts an agent token in place of the board
token: pinned by the "AGENT-TOKEN arm" test in server.report-reply-loopback-1968.test.js.

## Decisions
1. Same switch and same rule as slice 7 (exactly '1'; the agent-token check each path already uses). Rejected: a
   separate switch for reports. One setting should mean one thing.
2. No fallback, as in slice 7. A report the board refuses is already a visible "reporting is OFF" on SessionStart
   for the hook, and a silent miss for the bridges (their cardinal rule is never to fail the agent's turn).
WEAKEST PREMISE: a board older than the agent-token arm of /api/report would refuse every report from an agent with
the switch on, and the bridges would say nothing. The switch is off by default and is meant for one agent first,
on a current board.

## Measured
- 370 of 370 across the eight report-path test files (the four bridge files, the two hook files, and two
  report-hook guard files).
- Five mutations, one per path (the switch check removed): each turns exactly that path's new test red; each file
  restored byte-identical.

## Not done
- No review yet, no full run.
- Nothing sets the switch.
- Other test files that spread process.env and expect the board token (the CLI ones) are guarded on slice 7's
  branch (the runner unsets the switch); this branch does not add that line, to avoid two copies of it.
