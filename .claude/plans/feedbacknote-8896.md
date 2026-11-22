# kosmos#8896: add a short note to a feedback report already written

## Problem

An agent that has written its daily product-feedback report cannot add one line to it. `kosmos feedback write`
replaces the writer's whole section, and `kosmos feedback write --unchanged` refuses when a report already exists that
day ("You already saved a report today, so nothing was changed. To change it, write the whole report again."). Two
installs asked for this (11-05: a correction to an earlier day's report; 11-21: one line after an --unchanged report).

## Change

1. engine/feedback.js `note(from, text, date, now)`: under the same lock as write(), add the text to THIS writer's
   section of that day's report, after a line "Added later (YYYY-MM-DD HH:MM UTC):". The frontmatter (date, install,
   generated_at) is kept as it was. Refused, saving nothing, when:
   - that day has no section of this writer's (`why: 'none'`): write a report first;
   - the text is empty (`why: 'empty'`);
   - the date is not a date, or is after today (`why: 'date'`).
   The text goes through neutral(), so a line shaped like a section marker cannot split the report.
2. `kosmos feedback note [--date YYYY-MM-DD] [text]` in install/kosmos and tools/windows/kosmos-cli.js (parity verb;
   the Windows half gets one real run from Homer, not gating). Text as words, piped in, or --body-file, as for write.
3. Sending: a note on TODAY's report is sent the way `feedback write` sends (sendNow), with the note's own sentences
   (feedbacksend NOTE_MESSAGES: write's "failed" and "soon" say to write the report again, which would replace the
   note). A note on an EARLIER day is not sent by the command; what the command says about it is read from the send
   record (feedbacksend.earlierNoteMessage, review 1): the record names one day, and while sending is on that day is
   sent again once its report changes (sweepTick for yesterday, flushChangedDay when a later day goes). So a note on
   that day says it goes with a later send; any other earlier day says it stays; sending off says so.
4. The --unchanged refusal names the new verb: "To add a line to it, run kosmos feedback note 'the line'."
5. A whole `feedback write` behaves exactly as now: it replaces the writer's section, notes included.

## Rejected

- A `--note` flag on `feedback write`: write means "this is my report"; one verb per meaning reads better in help and in
  the nudge text, and a flag would share write's --unchanged and body-file parsing paths that already carry many cases.
- Sending an earlier day's note now. The site keeps one copy per install per day (api/_feedbackcore.js deletes this
  install's older same-day blob), so a resend would replace, not duplicate. But sendNow tracks ONE day: marking an
  earlier day sent flushes the day it named before (today) and resets today's 3-hour floor. Left for a follow-up card
  rather than built into this one.
- Notes in a separate file: the ask is "kept with that report"; one file per day stays the one thing to read.

## Weakest premises

- An earlier day's correction usually matters most to the team, and this version keeps it on the computer. The card's
  done-when does not require sending; the follow-up card covers it.
- UTC time in the note line: unambiguous across installs, but a person reading their own report sees UTC, not local.

## Done when

An agent adds a note to an existing report (today's or an earlier day's) without rewriting it; the note shows as
added later with its time; a whole `feedback write` still replaces the section as before; another agent's section on
the same day is untouched.

## Review 1 (opus)
- BLOCKER, fixed: "A note on an earlier day is kept here and not sent" was false for the day the send record names
  (usually yesterday): the sweep and the next day's send flush it. The sentence is now read from the record, and
  engine/feedbacksend-note-8896.test.js runs the real sweep with a stub sender: the named day's note IS sent, an older
  day's is NOT (with a control that the stub saw a send). Mutation: ignoring the record reds it.
- Fixed: `--date ""` was today on the Mac and refused on Windows; refused on both (test, mutation red). Mac empty-text
  wording names --body-file, as Windows. NOTE_MESSAGES.already no longer claims the report equals the sent one.
  Tests: refusals assert their reason, the unused helper is gone, the CONTROL now finds the written report file.
- Deferred: a piped note on the Mac has no quiet limit (an open pipe nobody writes to waits), exactly as a plain
  `feedback write` on the Mac does today; agents pass words. Parity with Windows' limit belongs to both verbs, not this card.
- Deferred: a named agent whose report that day sits in the unnamed section is told it has none; the same safe rule
  --unchanged uses (a pre-#5317 report may not be this agent's).
- Deferred: a note given just before midnight can land on the day that has just ended; the sentence then describes
  that day from the record, so it stays true.

## Review 2 (sonnet)
- Fixed: "goes with a later send" was true only for yesterday. Yesterday goes on one of the board's hourly checks
  (sweepTick, through sendDailyOnce's three-hour floor); an older day that is still the last one sent goes once, when a
  later day's report is next sent (flushChangedDay), and not if that never happens. Three sentences now, each tested
  against the real sweep or sendNow with a stub sender; a mutation that treats every day as yesterday reds the new one.
- Fixed: the "stays here" sentence gave a false reason for a day never sent; it now says Kosmos sends an earlier day
  only when it is the last day it sent.
- Kept: NOTE_MESSAGES.already is unreachable after a note (the body always changes) and now says nothing false.
- Kept: Windows adds its PowerShell line to the empty-note refusal, as its `write` does (PowerShell piping is the
  Windows-only reason a note can arrive empty).

## Review 3 (opus)
- Fixed: note() kept the old generated_at, which the send carries and the daily digest selects by (feedback-triage
  freshSince), so a corrected report would not show as new. A note now refreshes generated_at, keeping date and
  install (test; mutation red).
- Fixed: after a failed or pending send the agent was told only what not to do; it is now told nothing more is needed,
  because Kosmos tries again on a later hourly check while it runs.
- Fixed: the NOTE_MESSAGES test let "kosmos feedback write again" through (its `(?! )`); it now refuses any mention.
- Fixed (NITs): yesterday can also go with today's report (flushChangedDay, one-minute floor), so "at most once every
  three hours" is gone; an older day's one send is said to be untried again if it fails.
- Deferred: no length cap on a note (as write, whose limit is the collector's 64 KiB); CRLF frontmatter reads as body,
  as for write; Mac refusals on stdout vs Windows stderr, as for write.

## Review 4 (sonnet)
- Fixed: the "no report" refusal told an agent to run `feedback write` even with --date (write cannot make an earlier
  day's report), and after midnight it hid the real fix. With --date it now names only the day; without, it offers both
  write and --date. Tested on both CLIs.
- Fixed: NOTE_MESSAGES.later says "while Kosmos is running", as its siblings do.
- Kept: the named-agent / legacy unnamed section and the unreachable `already` sentence (both as in rounds 1 and 3).
