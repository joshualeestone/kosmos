# digestwords-4415: the daily digest stops asking Josh to do the triage (kosmos#4415)

## Why
Josh, #admin 2026-09-30, on the daily digest: "I was sort of expecting you to have an agent review them and then
assess if we need to make cards". The post said "Read them all, and mark them triaged: https://installkosmos.com/admin"
and "No card was opened", on a day the agent Echo had already triaged the reports and filed #4784 to #4787. The
automatic text read as a task for him and as a final word, and Echo's actual result never reached #admin.

## Call
- tools/feedback-digest-daily.sh takes FEEDBACK_DIGEST_MESSAGE_FILE. Set to a readable file with any non-blank text,
  that text is posted verbatim instead of the automatic summary, bounded to one Discord message (2000 characters,
  counted in UTF-16 units, never fewer than Discord counts): cut at the last line break that fits, with a closing line
  "[cut here to fit one Discord message]" and a log line saying it was cut. With a message file the card list, pull
  and triage are skipped (Echo did that work, and a store or gh failure should not block Echo's post). The lock, the
  watermark (moves on a 200 only), at-least-once delivery, the token handling and the dry run are unchanged.
- The variable SET (even to empty) with a missing, unreadable, empty or whitespace-only file REFUSES: exit 2, a log
  line starting "REFUSED: FEEDBACK_DIGEST_MESSAGE_FILE is set", nothing posted, the watermark still. Rejected: falling
  back to the automatic text, which would tell #admin "not yet triaged" on a day an agent triaged them.
- engine/feedback-triage.js adminSummary (the fallback) reports status and asks for nothing. "Read them all, and mark
  them triaged" and "No card was opened" are gone, and "to review" became "look like problems".
- Not changed: renderDigest's "No card was opened and nothing was changed" (the `kosmos feedback triage` CLI's markdown
  header, a different surface that is not posted to #admin and is literally true of that command).

## Weakest premise
That skipping the pull when a message file is given is right. If Echo's run ever needs the watermark to reflect only
reports Echo actually saw, the watermark would still be the run start, which may include a report that arrived after
Echo read the inbox; it would then be missing from every later automatic digest. Acceptable because Echo reads the
/admin inbox itself each day, which is not windowed by this watermark. Change it if Echo stops reading the inbox.

## The new default text (one report, one candidate)
```
Daily reports: 1 new since the last digest. Not yet triaged into cards.
Automatic first pass: 1 look like problems, 0 match open cards, 0 below the bar.
- `<report line, up to five>`
Where they live: https://installkosmos.com/admin (Reports). This counts reports that arrived since the last digest; one delivered late is only there.
```

## Echo's message (the file Echo writes, then runs the job with FEEDBACK_DIGEST_MESSAGE_FILE=<that file>)
Renet puts this into Echo's instructions; this branch does not edit Echo's folder. Plain text, no em dashes, under
2000 characters, a section with "0" rather than left out:
```
Daily reports, triaged by Echo: <N> read from <I> installs since yesterday's digest.
Cards filed (<F>):
- #<num> <one line: what is broken>
Existing cards commented (<C>):
- #<num> <one line: what the report added>
Held back (<H>):
- <one line: the report, and why no card (already fixed, not reproducible, a question, below the bar)>
Community check: <one line: what the community channels said about these, or "nothing related">
```

## Tests
- engine/feedback-triage.test.js: the default text's first and last lines; a new test that the default text
  carries none of "mark them triaged", "No card was opened", "Read them all", "to review", "please".
- tools/test-feedback-digest-daily.sh: arm 2 pins the new first line and the absence of the old phrases; arm 7 the
  message file posted byte for byte (cmp) with an unreadable card list, watermark moves on 200 and stays on 500;
  arm 8 refusal for an empty, blank, missing and empty-named file; arm 9 a 120-line file cut at a line break, at most
  2000 and at least 1800 characters, with the note; arm 10 the dry run prints the file and posts nothing.
