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
- Review 2 (warning 1): the watermark is checked as TEXT (9 or 10 digits, no leading zero) before any numeric compare;
  a 20-digit value used to error inside `[ -gt ]`, read as false, and be written, silencing the digest for good, and 0
  passed too. The stored last-posted gets the same shape check (a bad value is a first run, with a log line).
- Review 2 (warning 2): in message-file mode a 200 writes max(WM, the current last-posted), read raw under the lock,
  so the watermark never moves backwards (a stored value that is malformed or in the future is not kept).
- Review 2 (warning 3): in message-file mode a failed post exits 4 with "the digest was NOT posted; run it again"; the
  automatic path keeps exit 2 and "will try again next run" (true there). A node that cannot run is logged as that,
  not as an unreadable message file.
- Review 3 (warning): in message-file mode a 200 whose last-posted write fails exits 5, "POSTED, but the watermark was
  not recorded ...; do NOT run it again". It used to exit 2, which the contract reads as "refused, nothing posted", so
  Echo would re-run and double-post. The automatic path keeps exit 2 and its words.
- Review 3 (environment failures): CHOSEN, routed through post_failed, so in message-file mode no state folder, no temp
  folder, node missing, bound.js failing and jq failing all exit 4 with the cause in the log line. Rejected: keeping
  exit 2 and widening its meaning, because 2 tells Echo to fix a file that is fine. Routing was not awkward: MSG_FILE
  and the watermark are validated before the first of these failures, so post_failed is simply defined right after that
  validation. The automatic path's exit (2) and words are unchanged. Weakest premise: "run it again" does not fix a
  missing node; the log line names the cause, and a rerun is harmless because nothing was posted.
- Review 3 (nits): message-file mode saves WM - 1 (the automatic path saves its start minus one; the window is
  (since, now]); a watermark given with no message file logs "a watermark was given but no message file; posting the
  automatic text"; message-file mode skips the stored-watermark checks and their "using the last day" lines (it has no
  window; the raw value is still read under the lock for the never-backwards rule).

## Review 4
- W1 (a double post through a held lock or a rerun): this pull's WM is an idempotency key. After a 200 in message-file
  mode it is written to $STATE/last-message-wm (beside and renamed, BEFORE last-posted, so an unwritable last-posted
  still leaves the key; a key that cannot be written exits 5). Under the lock, a message-file run whose WM equals the
  stored key posts nothing, logs "this pull's result was already posted; nothing to do" and exits 0 (the text is in
  #admin). A message-file run that takes the lock writes its WM to $LOCK/wm before its pid; a message-file run that
  finds the lock held by the SAME WM logs "another run is posting this same result; do NOT run it again, check #admin"
  and exits 6; any other holder keeps exit 3. A dry run skips the key (it posts nothing and must still print).
  Rejected: keying on the message file's content, since Echo may re-word a retry of the same pull and it must still
  post once.
- W2 (a timeout reported as not posted): in message-file mode a code of 000 or empty (curl -m got no answer) logs
  "Discord did not answer; the digest MAY have been posted: check #admin before running again" and exits 7. The
  automatic path keeps at-least-once and its exit 2.
- Nits: a failed mkdir with no lock directory (after one retry, in case the holder just let go) is post_failed "could
  not create the lock in $STATE" (exit 4 in message-file mode), not "another run"; a FEEDBACK_DIGEST_STATE that is a
  regular file exits 4 in message-file mode.
- Weakest premise: Echo passes the SAME WM when it retries one pull. A retry that re-reads the clock gets a new WM and
  posts again; the key cannot tell a new pull from a re-timed old one.
- Arms: 8e two runs of one WM post once (a post counter) and the second exits 0 with the line, a different WM posts, a
  held lock with our wm exits 6 and with another wm exits 3; 8f a post answered 000 and one answered nothing exit 7,
  never say "run it again", and leave last-posted; 8g the state path a regular file exits 4. W1's rerun arm and W2's
  arm were each shown red with only that fix reverted.

## Review 5
- W1 (a crashed run of the same pull reposted): in the stale-lock takeover, after the stale lock is moved aside, its
  wm is read and the lock removed; in message-file mode, if that wm equals ours and $STATE/last-message-wm is not ours,
  the run logs "a previous run of this same pull died while posting; it MAY have been posted: check #admin before
  running again" and exits 7. The stale lock is already gone, so a deliberate rerun after checking goes through. A key
  equal to WM falls through to the key check (exit 0, already posted). Weakest premise: a run that died after writing
  its wm but BEFORE posting also reads as "may have been posted"; the cost is one look at #admin.
- W2 (a half-made lock): take_lock removes a lock it made but could not fill (wm or pid write failed) and fails via
  post_failed "could not write the lock in $STATE" (exit 4 in message-file mode), instead of leaving a lock that reads
  as a run starting with our wm (exit 6 with nothing posted).
- W3 (unpinned plan claims): (a) the post stub copies $STATE/lock/wm during the post and 8e asserts it equals
  FEEDBACK_DIGEST_WATERMARK; (b) after 2c's exit 5 (last-posted unwritable) a rerun of the same WM exits 0 with "already
  posted" and no new post, and a $STATE/last-message-wm.tmp that is a directory exits 5 with "POSTED, but this pull's
  key was not recorded".
- Nits: $WORK is removed on every exit (a trap right after mktemp, replaced by the full trap once the lock is held);
  the header and this plan say any other exit code means check #admin first; exit 6 says "the other run's exit code
  decides; do NOT start another".
- Decided NOT built: keeping only the latest key (a late retry of an OLDER pull after a newer one posts again). Echo
  retries only its current pull, and the WM shape check plus the max() on last-posted bound the damage to one repeat
  post that never moves the watermark back. Logging a stale last-posted on a key match: the next pull repairs it via
  max(), so the line would describe a state that fixes itself.
- Arms: 8e a stale lock with a dead pid (999999, checked not running with kill -0) and our wm exits 7, posts nothing and
  leaves no lock; CONTROL, a dead pid with another pull's wm is taken over and posts; a umask of 277 makes the new lock
  directory unwritable so the wm write fails: exit 4, "could not write the lock", no lock left, nothing posted; W3a and
  W3b above. W1, W2, W3a (take_lock does not write wm) and W3b (the key written after last-posted) were each shown red
  with only that code reverted.

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
Exit codes in this mode:
- 0 posted, or this pull's result was already posted (the same FEEDBACK_DIGEST_WATERMARK as the last post: nothing
  is posted again)
- 2 a refusal, nothing posted (fix the file or the watermark)
- 3 the lock is held by another pull (run it again)
- 4 not posted: Discord's error, no bot token, no state or temp folder, no lock, node or jq failing; the log line names
  which (run it again, after fixing the environment if it says so)
- 5 posted but watermark not recorded (do NOT run it again, it would post twice; the log line gives the value to write
  into last-posted)
- 6 this same pull is being posted by another run (the other run's exit code decides; do NOT start another)
- 7 the post may have gone out, check #admin first: Discord did not answer, or a previous run of this same pull died
  while posting (a stale lock carrying this WM)
- any other code (for example 128+n from a kill): the run may have died mid-post; check #admin first
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
  message-file mode and still 0 on the automatic path, with nothing posted and last-posted unchanged; 9 puts an emoji at every line end past the limit.
- Review 2 arms: 8b also refuses a 20-digit, a 0 and a leading-zero watermark; a 20-digit stored last-posted is a first
  run; 7 an older WM leaves last-posted where it was, a 500 and a missing bot token exit 4 (the automatic path still 2);
  a missing node is named. Each warning's arm was shown red with only that fix reverted.
- Review 3 arms: 2c also runs message-file mode against the unwritable watermark and requires exit 5 exactly, the
  "do NOT run it again" line and a post (shown red with only that fix reverted); a missing node exits 4 in message-file
  mode and 2 on the automatic path; 7 the saved watermark is WM - 1, and a 20-digit stored value logs no "using the
  last day" line; 8c the automatic run with a stray FEEDBACK_DIGEST_WATERMARK logs that it was given with no file.
