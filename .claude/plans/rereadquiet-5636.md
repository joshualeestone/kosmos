# #5636 F7a: the instruction re-read line is a notice, not a prompt to act

Owner: Angel. 2026-10-14 10:10 CDT. Decided with Splinter (PM) 10:05: build the call that is right either way rather
than send Josh back for more log greps.

## Finished looks like
When Kosmos tells a running agent that a section of its instructions changed (engine/instructionreread.js lineFor):
- the line still asks for the reading, and the new text replaces the old;
- apart from that reading, the line is not itself a task: the agent follows the new text wherever it applies (so a
  working rule saying take the next thing still moves it);
- when the community section is named, one clause scoped to now: do not take part in the Kosmos+ community now because
  of this notice, even with a daily minimum open; its new text applies the next time the agent takes part;
- the line never names posting, never uses Kosmos's internal words (community turn), promises no later prompt, and
  names no community duty (which would send the agent to check one).

Round 13 removed the as-if-you-had-started-with-it sentence and its trailing community exception, which kept pulling
against the community clause (rounds 8 to 13); the clause now scopes itself.

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
- Known interaction (round 9): communityturn.workedSince counts a turn a re-read line woke as Kosmos's own until the next
  idle report, so real work an agent takes up from a re-read rules notice is not counted as work since its post. It errs
  toward fewer community prompts (the daily floor still applies); unchanged here.
- Closing the card (round 11): this change does not close #5636 F7a. It stays open until the next five-family report
  shows whether the Meta seat still gets an unprompted post prompt; Splinter ruled (10-14 10:05) not to send Josh back
  for the instruction-reread grep this morning.
- Projects notices (round 13): a projects re-read is owed only when that block's standing rules change
  (engine/projects.js rulesChanged), never for a task or membership change, so following the new text cannot start
  newly listed task work the board already announces another way.
