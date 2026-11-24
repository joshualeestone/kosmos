# clifrict-8948: three agent-CLI frictions from 2026-11-23 feedback (kosmos#8948)

## Part 1: closed tasks listed in instructions as current work
Measured: projects.blockBody lists only open tasks at write time, and every route that closes a task rewrites the
assignees' blocks (the close route, the close-with-subtasks route, the part-close route via tellEveryoneOn; no other
code writes closedAt). On this Mac all 8 listed task lines (2 agents) match the live state. The reports came from two
other installs, which I cannot see, so the cause there (most likely a rewrite that failed) is not measured.
Decided: the block's task rules now say the live list wins: "If these lines ever disagree with `kosmos task list
<project-id> --mine`, the live list is right." That holds whatever the cause. Rejected: stamping each line with a
time (noise on every line, and still not the answer). Cost: a standing-rules change, so agents with tasks get one
re-read notice.

## Part 2: no "did you mean" on an unknown command
engine/didyoumean.js, called by both CLIs right after "Unknown: kosmos <word>" (the howhint pattern): a plural of a
real command suggests it, with " list" when it takes one (LISTABLE: task, project, agent, feedback, held by a test to
both CLIs); otherwise the single nearest command within two edits (one for a word under five letters). A tie or
nothing close suggests nothing. Mac reads the names from kosmos_command_list (the list --help prints), Windows from
VERBS. No change to the #8935 dispatch lines.

## Part 3: feedback day sees one calendar day
`kosmos feedback day [--date YYYY-MM-DD]` on both CLIs (feedbackday.dayArg; a day not real or after today is
refused, as feedback note --date). An asked-for day says "on <date>" where today says "today" (the CLIs pass
asked: true). An empty today (both halves read and empty) points to the day before. listTaskFilesIn now keeps task
files written on OR after the day, since a file written again later still holds that day's rows. An older engine
without dayArg keeps the old behaviour on both CLIs. Rejected for now: a whole-session view across days (needs a
reliable session start; bigger than this card).

## Tests
- engine/didyoumean-8948.test.js: the rules, with controls (tie, far, short word, option, real command); LISTABLE
  against both CLIs; the Mac CLI and the Windows CLI end to end.
- engine/feedbackday-8948.test.js: dayArg, the asked day's wording, the pointer (CONTROLS: a day with a message, an
  unreadable one), and the file filter (CONTROL: a file last written before the day).
- engine/tasks.test.js: the block carries the live-list sentence.
- feedbackday-7875's two source pins follow the new call and usage line.
- Perturbing each of the five fixes turns its test red. Related set, 84 files: 1,181 tests, 0 failed.

Weakest premise: part 1's cause on the reporting installs is not measured; the sentence answers the agent's
confusion, not the stale write itself.

## Round 1 (opus, blind): no blocker; two should-fix (test gaps), taken; nits taken
- Nothing tested that --date reaches the digest: a Windows main() test now runs the real dayArg and checks date and
  asked: true reach the digest, a plain call is not marked asked (CONTROL), and four bad arguments exit 2 before the
  agent is looked up. Putting the Windows call back to digest(who) turns it red. The Mac arm stays pinned by source
  (it needs a staged agent identity to run); both CLIs share dayArg and digest.
- _did_you_mean moved above the #8935 comment block, so that comment sits on _how_hint again.
- The empty-today test skips its check on a run that crosses midnight instead of reading red.
- Measured by the reviewer: shell metacharacters in the unknown word print only the Unknown line and run nothing;
  dayBefore holds across daylight saving in three zones 2010 to 2026; 12 block-reading test files pass.
- Left, noted: Mac feedback day errors now go to stderr (as Windows); suggestions draw only on the listed commands.

## Round 2 (sonnet, whole branch): no blocker, should-fix or nit. Converged.
