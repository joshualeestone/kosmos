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

- Review (warning 1): in message-file mode FEEDBACK_DIGEST_WATERMARK is REQUIRED (whole epoch seconds, not in the
  future; else exit 2 "REFUSED"), and on a 200 the watermark written is that value, the moment Echo STARTED its pull,
  not the run start. A report arriving while Echo triaged is then inside the next automatic window.
- Review (warning 2): in message-file mode a held lock exits 3 with "the digest was NOT posted ... run it again". The
  automatic path keeps exit 0 (the run holding the lock posts the same summary). No launchd job runs this script today
  (checked by the reviewer), so there is no second daily post to retire; Echo's run is the only caller.

## Weakest premise
That Echo passes an honest pull-start epoch. The script can check the number is well formed and not in the future,
not that it is the real start of Echo's pull; a watermark later than the pull reopens the gap from warning 1.

## The new default text (one report, one candidate)
```
Daily reports: 1 new since the last digest. Not yet triaged into cards.
Automatic first pass: 1 look like problems, 0 match open cards, 0 below the bar.
- `<report line, up to five>`
Where they live: https://installkosmos.com/admin (Reports). This counts reports that arrived since the last digest; one delivered late is only there.
```

## Echo's message (the file Echo writes, then runs the job with FEEDBACK_DIGEST_MESSAGE_FILE=<that file>)
Before `kosmos feedback pull`, Echo records `PULL_START=$(date +%s)`; after triage it runs
`FEEDBACK_DIGEST_MESSAGE_FILE=<file> FEEDBACK_DIGEST_WATERMARK=$PULL_START bash tools/feedback-digest-daily.sh`.
Exit 2 is a refusal (fix the file or the watermark), exit 3 means another run held the lock: run it again.
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
- Review arms: 7 carries a literal @everyone, posted verbatim with allowed_mentions {"parse":[]}, and the watermark
  written equals FEEDBACK_DIGEST_WATERMARK; 8b refuses an unset, empty, non-numeric and future watermark; 8c a report
  stamped between Echo's pull start and the run is in the next automatic post; 8d a held lock exits 3 "NOT posted" in
  message-file mode and still 0 on the automatic path; 9 puts an emoji at every line end past the limit.
