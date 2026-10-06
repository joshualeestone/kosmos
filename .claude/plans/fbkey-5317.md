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
- sendBody/forSend: what leaves the computer is built from the STORED sections and heads them "Report 1", "Report 2",
  never an agent name (scrub removes names it can find; a legacy agent with no profile is still a name). The local
  file keeps the names for the person, and two writers READ as their headings, never the marker lines.
- writer(env): the agent its launch token names, else its tmux window, through outbox.resolveKeepSender (the resolver
  a kept message uses); else null. Both CLIs pass it.
- A body line that looks like a marker is indented by one space so it cannot split the report.

## Tests
engine/feedback.test.js 22 (8 new); mutation (back to replace-the-day) reds 3. Unchanged and green: feedbacksend 76,
feedback-triage 23, cli.feedback-2037 14, server.feedback-2037 7, windows verbs 15, unknown-flag 63.

## Review 1 (opus, blind)
- W1 fixed: two writers read back with the raw marker lines (show and triage saw them; a PM pasting the assembled day
  back sent markers and names). readBody now renders headings only; the payload is built from the stored sections.
- W2 fixed: the board sweep sent only today, so a second agent writing at 22:30 after a 22:00 send was never sent.
  sweepTick also sends the day before while the send record still names it and its report changed (once: the record
  then names that send; the next day's send moves it on). The 'later' sentence no longer says the earlier version was
  this agent's.
- W4 fixed: wiring guarded where it ships (payload with two writers, the sweep, both CLIs). Mutations: payload from the
  rendered body reds 1; no yesterday branch reds 1.
- W3 ACCEPTED: an agent with no resolvable name (an unknown token, a tokenless non-tmux runner) writes the unnamed
  section, so two such agents still replace each other. Appending instead would duplicate every re-run by a person;
  every Kosmos-made agent has a token (Windows) or a window (Mac).
- NITs fixed: the writer doc states the no-downgrade rule; Mara and mara are one section; a stale lock is taken over
  by rename (one waiter wins). NITs accepted: a lock held by a crashed writer delays writes up to 30 s; a CRLF re-save
  stops the frontmatter parse (true before this change too).

## Review 2 (sonnet, blind)
- W fixed (the substantive one): the send record names ONE day, so once TODAY was sent (by the sweep or by an agent's
  write just after midnight) a change to yesterday that the 3 h floor had held was never sent. flushChangedDay sends
  the day the record names once more, before the record moves on, if its report changed since its last delivery (or its
  last attempt failed over a minute ago; under a minute it may still be in flight). Once per change of day, so it cannot
  flood. Test: 22:00 send, 22:30 second agent, 00:30 the next day's report: both of the first day's versions and the
  new day go, and nothing repeats. Mutation: no flush reds it. This also covers the lost delivered-hash of a send of the
  day before (the record has moved on; that day is done).
- W accepted, stated in the code: the stale-lock takeover by rename is not fully exclusive (a slow waiter can rename the
  fresh lock); it needs a crashed writer and two writes within 50 ms. NITs accepted: a whitespace-only legacy body and a
  re-spelled agent name each cost one identical re-send; a store file copied by hand into `triage --dir` shows markers.

## Review 3 (opus, blind)
- W fixed: the in-flight rule held only with no delivered hash, so a re-send of the day before still in flight was sent
  again by the new day's send in the same tick. Now any attempt under a minute old is in flight. Test: one tick at
  01:30 sends the changed day once; the old rule reds it.
- W fixed: the flush ran before the new day's mark, so with an unwritable settings file every write posted the day
  before again (a flood). It runs only after the mark held. Test: three writes with the folder read-only post nothing
  extra; the old order reds it.
- NIT fixed: the flush's post refuses redirects under test, as sendNow's does. NIT accepted: an old record with no time
  sends the day before once more (the same one-POST rule already accepted for unknown content).

## Review 4 (sonnet, blind): converged (no BLOCKER, WARNING or CONVENTION)
- NIT fixed: the flush sends only a day BEFORE the one being sent, so a write that straddles midnight (sending the older
  day) does not also post the newer day the sweep will send. NIT accepted: an in-flight re-send that then fails inside
  its minute is not retried (already accepted: a failure in the flush is not retried).

## Weakest premise
That one combined record per day is what the team wants, rather than one record per agent. It needs no collector
change and every report arrives; if per-agent records are wanted later, the sections are already separable.
Second: a re-send after a second agent writes waits for the 3 h floor (the CLI says 'later'), so the team sees the
second report up to 3 h later, the next day if need be (sweepTick). Accepted: the floor exists to keep one install from flooding the collector.
