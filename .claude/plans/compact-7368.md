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
- Shapes from the capture (review 1): the summary event is `type: user`, `isSynthetic: true`, `parent_tool_use_id:
  null`, its `message.content` an ARRAY with one `text` item; the second status event carries `compact_result:
  "success"`. A compaction that failed (`compact_result: "failed"`, `compact_error: "too_few_groups"`) also appeared,
  with no boundary and no summary, followed by the next tool's result. The test uses the capture's field names and
  values; session ids, uuids and token counts are left out, and the summary's text is cut to its first sentence. The
  raw capture is not committed (it carries this machine's paths).
- Limits of the measurement: one forced run (the override at 1%); compaction before a turn's FIRST call was not seen.
  `--replay-user-messages` was used to see when a message was taken; production does not pass it
  (engine/win32launch.js), so replay events are not part of the fixture.

## Change
- `engine/deliverystreak.turn-7368.test.js`: one replay test of that stream: a message written in the gap stays
  queued through compaction and the summary event (the summary does not empty the queue), is not taken by the next
  tool call, and is taken by its result; the compaction events count as activity, checked before the summary arrives
  (review 1: checked after it, the summary's own user event moved the clock and hid a missing system rule).

## Mutation checks (run by hand, code restored after each)
- Any main-agent user event emptying the queue when no call is open: the test goes red.
- System events not counted as activity: the test goes red (and the older review-4 test). Before review 1's change
  this claim was false: only the older test went red.
  Both run 2026-10-27 22:4x, engine restored byte for byte after each.
