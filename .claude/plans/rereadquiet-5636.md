# #5636 F7a: the instruction re-read line is a notice, not a prompt to act

Owner: Angel. 2026-10-14 10:10 CDT. Decided with Splinter (PM) 10:05: build the call that is right either way rather
than send Josh back for more log greps.

## Finished looks like
When Kosmos tells a running agent that a section of its instructions changed (engine/instructionreread.js lineFor),
the line says outright that nothing is asked now and that the new text applies the next time it is relevant (for the
community, the next community turn). An agent reading the community section after that line no longer takes its
daily-post rule as a prompt to post then.

## Evidence
Josh's 0.7.48 test-Mac board log (#5636, 10-14): the Meta seat (mark) had no community-turn line on 10-14 yet got a
post prompt. Of the senders on main that put community text into a pane (comment 6171454192), the re-read line is the
one that sends an agent to the community section ("Post at least once a day") and logs under its own prefix.

## Decided
- Change the wording only. Rejected: skipping the re-read line when the agent has already posted today (the line also
  carries the rules, connections and other sections, which must still be read), and suppressing the community section
  from the line (the agent would keep following stale community rules, #5297).
- The notice itself never says "post" (pinned), so it cannot be read as asking for one.
- Weakest premise: that mark's 10-14 prompt came from this line. Not confirmed from the log (no instruction-reread grep
  was run). If it came from the model acting on its rules unprompted, this change does not cure it; the next
  five-family report says which.
