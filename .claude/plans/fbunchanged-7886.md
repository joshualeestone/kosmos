# fbunchanged-7886: `kosmos feedback write --unchanged` (kosmos#7886 item 6)

Finished means: on a day with nothing new, an agent runs `kosmos feedback write --unchanged [one line]` on the Mac or on
Windows and today's report says "Nothing new since my report of <date>." (or, with a line, "Nothing new since my report
of <date>, except: <line>", which does not contradict itself; review round 5), pointing back to its own latest
earlier report; with no earlier report it refuses and saves nothing. The daily nudge mentions it.

Why: the feedback collector's report said the honest report on a static stretch repeats yesterday's. Tasks already have
`kosmos task ran ... --unchanged`.

Decided:
- The body points back by date rather than copying the earlier report: a copy reads as new findings to triage, twice.
- It looks for the WRITER's own section (engine/feedback.js sections, same key match as write()), not anyone's, so one
  agent's report is never claimed by another.
- No earlier report: refused (exit 2, nothing saved). A pointer to nothing would be a report that says nothing.
- A report already saved today: refused (exit 2), since write() would replace it (review round 1); except the SAME
  pointer again, so a send that failed can be retried with the same command, as the send message says (round 5).
- An earlier BARE pointer is followed to the report it names, so a run of unchanged days all point at the real report;
  a pointer with a line added carries something new, so it is pointed at (review round 3).
- `--unchanged` is taken anywhere before a bare `--`, as `kosmos task ran` takes it (review round 1).
Known limit, kept: the team sees each day's writers as "Report 1", "Report 2" (forSend strips names), so on a day with
several writers the pointer names the day, not which report of it. Fixing it needs a stable per-writer label that is
not a name; out of scope here. And it cannot know whether that earlier report was sent (sending switched off, or a
send that failed), so the team may get a pointer to a report it never received (review round 2). Both CLIs save under
the day the engine checked, so a run across midnight cannot refuse on one day and replace another.
- `--unchanged` takes words, not `--body-file`: it is a short line by design. Stdin is not read.
Rejected: a flag on the collector side to collapse repeated reports; that changes what reaches the team and needs the
collector, and the honest fix is at the writer.

Not done, on purpose: refusing piped stdin with --unchanged. An agent's stdin is usually not a terminal even when
nothing is piped, so a test for it would refuse ordinary calls.

Weakest premise: that agents read the added sentence. It is in the daily nudge, the Project Manager's role text, and
both CLIs' usage.

Tests: cli.feedback-unchanged-win32-7886.test.js runs the Windows CLI against the REAL engine on a throwaway store, and
its name puts it in tools/windows-tests.js (checked with that file's own selectFiles). engine/feedback-unchanged-7886.test.js, the engine with NAMED writers: another writer's day refused (control: its
own writer finds it), newest earlier chosen, case-insensitive, blank skipped, today refused, a pointer followed; each
red under its own mutant. cli.feedback-unchanged-7886.test.js. Mac, real CLI and real engine on a throwaway store: refuses with no earlier
report (with a control that a plain write is seen where the test looks), points back with the words added and does not
copy the earlier text, refuses --body-file. Windows: the CLI writes the engine's pointer and refuses on none, stdin
unread. The nudge teaches it. Red when the engine never finds an earlier report.
