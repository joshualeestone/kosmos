# idlefresh-5635: summary freshness counts work time, not clock time (kosmos#5635 F2, 0.7.45/0.7.46 reports)

## Why
Five-family reports (Claude, GPT, Gemini, Grok, Meta on one computer): every seat wrote a summary in the morning,
had no work until a request at 14:19, and at 14:20 the board read all five "older than the 4-hour rhythm" (5h 26m to
5h 33m). The seats were WORKING then (just woken), and idleExcused only helps a member idle now. Its latest idle report
also moves on with every short prompted turn (community prompts), so an idle seat flips back to stale (the Gemini
note). The ask: a seat whose summary was current when it went idle stays current, and the 4-hour clock starts when it
next starts working.

## Finished looks like
A summary of a member whose own reports show at most four hours of work since it was written reads current
("current: N of reported work since it was written (file, age)"), whether the member is working or idle now; one with more
work since, or whose history cannot show it, reads as before. Tests pin the report's timeline and each control.

## Change
Review 3: selfreport.history marks an operator's clear (by: 'operator'), and workExcused skips it, as idleExcused and
idleNoted do; and a member the board reads busy now counts the time since its last report as work (#1995: the board's
read wins over a reported idle).
engine/projectview.js: workExcused(summary, member, readHistory, now), applied after idleExcused and quietExcused,
before idleNoted. Sums the busy time in selfreport.history since the summary was written. Busy is any state but idle,
started and stopped (as communityturn.workedSince). Only REPORTS_WORKING runners. A history cut short that starts
after the summary is unknown (left stale). No report at or before the summary: the stretch to the first report counts
as work. New state 'worked' with workMinutes and its line in SUMMARY_WORDS; span() formats a duration.
overviewOf takes opts.readHistory (default selfreport.history); a caller that injects readReport and no readHistory
gets none, so a view never mixes an injected report source with the store's timeline (this also keeps the existing
tests hermetic: without it, one existing test read history rows that an earlier test had left in the sandbox).

## Decided
- No cap on the summary's clock age. The rhythm is four hours of work and an idle agent is not expected to write, so
  a summary days old with little reported work since reads current; the line still shows its age ("3 days ago").
- The line says "reported work": work while the board was down leaves no reports (the gap below), so the number is
  what the reports show, not a claim about all work. Not measured from the board's start: that would read every idle
  member stale after each restart, which idleExcused's review 6 rejected for the same reason.

## Rejected
- Changing idleExcused to look at the first idle after the summary: it would still not cover a member working now.
- Starting the clock at the next working report and ignoring later idle stretches: work time is the rhythm's unit, so
  summing busy time is the direct measure.

## Not in this change
- GPT (Codex) seats: Codex reports idle only, so its work time cannot be measured; unchanged. "GPT shown idle while it
  had an open task" is the same root (no working report from Codex) and is a status question, not freshness.
- Grok "working and idle members flagged alike" is covered for Grok members that report working (grok is in
  REPORTS_WORKING).

## Weakest premise
That the self-report history is complete enough: reports reach the store only while the board runs, so work done
while the board was down leaves no rows and an earlier idle can make that time read as idle (the same known gap
idleExcused documents). And a wait for a person (needs_you, blocked) counts as work, which errs toward stale.

## Validation
projectview and the six suites that use it, the file guards, Windows guards, engine.reachable: 166/166. The two new
tests fail with the rule disabled. Full suite left to CI.
