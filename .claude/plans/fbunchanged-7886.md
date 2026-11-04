# fbunchanged-7886: `kosmos feedback write --unchanged` (kosmos#7886 item 6)

Finished means: on a day with nothing new, an agent runs `kosmos feedback write --unchanged [one line]` on the Mac or on
Windows and today's report says "Nothing new since my report of <date>." (plus the line), pointing back to its own latest
earlier report; with no earlier report it refuses and saves nothing. The daily nudge mentions it.

Why: the feedback collector's report said the honest report on a static stretch repeats yesterday's. Tasks already have
`kosmos task ran ... --unchanged`.

Decided:
- The body points back by date rather than copying the earlier report: a copy reads as new findings to triage, twice.
- It looks for the WRITER's own section (engine/feedback.js sections, same key match as write()), not anyone's, so one
  agent's report is never claimed by another.
- No earlier report: refused (exit 2, nothing saved). A pointer to nothing would be a report that says nothing.
- A report already saved today: refused (exit 2), since write() would replace it (review round 1).
- An earlier pointer is followed to the report it names, so a run of unchanged days all point at the real report.
- `--unchanged` is taken anywhere before a bare `--`, as `kosmos task ran` takes it (review round 1).
Known limit, kept: the team sees each day's writers as "Report 1", "Report 2" (forSend strips names), so on a day with
several writers the pointer names the day, not which report of it. Fixing it needs a stable per-writer label that is
not a name; out of scope here.
- `--unchanged` comes first and takes words, not `--body-file`: it is a short line by design. Stdin is not read.
Rejected: a flag on the collector side to collapse repeated reports; that changes what reaches the team and needs the
collector, and the honest fix is at the writer.

Weakest premise: that agents read the added sentence. It is in the daily nudge, the Project Manager's role text, and
both CLIs' usage.

Tests: engine/feedback-unchanged-7886.test.js, the engine with NAMED writers: another writer's day refused (control: its
own writer finds it), newest earlier chosen, case-insensitive, blank skipped, today refused, a pointer followed; each
red under its own mutant. cli.feedback-unchanged-7886.test.js. Mac, real CLI and real engine on a throwaway store: refuses with no earlier
report (with a control that a plain write is seen where the test looks), points back with the words added and does not
copy the earlier text, refuses --body-file. Windows: the CLI writes the engine's pointer and refuses on none, stdin
unread. The nudge teaches it. Red when the engine never finds an earlier report.
