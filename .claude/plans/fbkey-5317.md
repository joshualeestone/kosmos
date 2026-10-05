# #5317: two agents writing the daily feedback report the same day both reach the team

## The report (0.7.22, a team of Kosmos agents, forwarded by Josh 10-05 11:12)
`kosmos feedback write` replaced feedback/YYYY-MM-DD.md, keyed by date only. On a multi-agent install only the last
writer's report survived the day, silently.

## Change (built on #5294, which touches the same files; rebased onto main once #5294 merges)
- engine/feedback.js: one file per day still (the collector keeps one record per install per day and replaces on
  re-send, so one file per day needs NO collector change), with one SECTION per writer: a marker line
  `<!-- kosmos-feedback-from: <name> -->` and a `## From <name>` heading. write(body, {from}) replaces ONLY that
  writer's section, in place (idempotent per writer), under a lock directory so two writers at once cannot lose one.
- A day with only an unknown writer is stored bare, byte for byte as before; a report from before #5317 reads as that
  writer's section and is kept when an agent writes.
- readBody: a day with ONE writer reads back exactly as written (no heading, no name), so show, send and triage are
  unchanged for the single-agent case; headings appear only once two writers share a day.
- forSend: what leaves the computer heads sections "Report 1", "Report 2", never an agent name (scrub removes names it
  can find; a legacy agent with no profile is still a name). The local file keeps the names for the person.
- writer(env): the agent its launch token names, else its tmux window, through outbox.resolveKeepSender (the resolver
  a kept message uses); else null. Both CLIs pass it.
- A body line that looks like a marker is indented by one space so it cannot split the report.

## Tests
engine/feedback.test.js 22 (8 new); mutation (back to replace-the-day) reds 3. Unchanged and green: feedbacksend 76,
feedback-triage 23, cli.feedback-2037 14, server.feedback-2037 7, windows verbs 15, unknown-flag 63.

## Weakest premise
That one combined record per day is what the team wants, rather than one record per agent. It needs no collector
change and every report arrives; if per-agent records are wanted later, the sections are already separable.
Second: a re-send after a second agent writes waits for the 3 h floor (#5294's sendNow says "soon"), so the team sees
the second report up to 3 h later. Accepted: the floor exists to keep one install from flooding the collector.
