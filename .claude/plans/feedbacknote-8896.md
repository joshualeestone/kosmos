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
3. Sending: a note on TODAY's report is sent the way `feedback write` sends (sendNow, same sentences). A note on an
   EARLIER day is saved on this computer only, and the command says so in plain words.
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
