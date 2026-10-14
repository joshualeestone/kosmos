# #5636 F7a: the instruction re-read line is a notice, not a prompt to act

Owner: Angel. 2026-10-14 10:10 CDT. Decided with Splinter (PM) 10:05: build the call that is right either way rather
than send Josh back for more log greps.

## Finished looks like
When Kosmos tells a running agent that a section of its instructions changed (engine/instructionreread.js lineFor):
- the line still asks for the reading, and the new text replaces the old;
- apart from that reading, the line is not itself a task: the agent follows the new text wherever it applies, as if it
  had started with it (so a working rule saying take the next thing still moves it);
- when the community section is named, the line adds: do nothing in the community because of this notice, even with a
  daily minimum open; this notice is not the prompt for it;
- the line never names posting and never uses Kosmos's internal words (community turn), and promises no later prompt.

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
