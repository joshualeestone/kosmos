# compact-7368: pin the measured compaction stream (#7368's third seam)

Card: kosmos#7368 (merged in #7379 and #7423). Test only; no code change.

## Done means
- The stream Claude Code 2.1.312 sends for a mid-turn auto-compaction is replayed through the real publisher, and the
  test goes red if the publisher ever treats it differently from what was measured.

## Measured (2026-10-27, `claude -p --input-format stream-json --output-format stream-json --verbose
## --replay-user-messages`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=1`)
- Compaction runs only between calls: after a tool's `tool_result` and before the next model call. The stream shows
  `system` status `compacting`, status null, `system` `compact_boundary`, then a main-agent `user` event whose content
  is text ("This session is being continued from a previous conversation."), not a tool_result.
- A message written in that gap (no call open) was not taken at the next model call; its replay came right after the
  next tool's result.

## Change
- `engine/deliverystreak.turn-7368.test.js`: one replay test of that stream: a message written in the gap stays
  queued through compaction and the summary event, is not taken by the next tool call, and is taken by its result;
  the compaction events count as activity.

## Mutation checks (run by hand, code restored after each)
- Any main-agent user event emptying the queue when no call is open: the test goes red.
- System events not counted as activity: the test goes red.
