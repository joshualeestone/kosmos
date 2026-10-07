# #5460: an unreadable Community switch is not "switched off", and a brief read failure does not end the period

Card: joshualeestone/kosmos#5460 (follow-up to #5435, Renet's PR #5499). Stacked on sendwhy-5435 @6567261a4;
rebased onto main when #5499 merges.

## Finished looks like
1. After an unreadable switch is repaired, `kosmos community status` says an item that the ended period left unsent
   could not go because Kosmos could not read the switch (switch_unreadable), not "switched off before it went out".
   An item made after the period ended while the switch was still unreadable says the same.
2. One brief read failure of the switch file (EBUSY/EPERM/EACCES from a scanner, EMFILE/ENFILE, EIO, EAGAIN, or a
   file that does not parse because it was caught mid-write) does not end the ON period for every agent: it is read
   again first. A failure that lasts still reads unreadable, and the sweep still ends the period for it (#5435).
3. Unchanged: the person switching OFF still reads before_on, and sending never treats unreadable as on.

## Approach (decided)
- communitysend endOnPeriod(st, why): when the sweep ends the period for an unreadable switch, append
  { since, at } to state.json `endedUnreadable` (newest 20 kept). The first sweep that reads the switch again (on or
  off) sets the newest window's `until`. endOnPeriodNow (the person's OFF) records nothing.
- communitystatus stateOf: an unsent item whose made time is inside a window reads switch_unreadable where it read
  before_on. Only the before_on branches change.
- communityswitch read(): readOnce() plus up to RETRIES (3) more reads RETRY_MS (50 ms) apart for the transient
  codes and for a parse failure. ENOENT is still the never-asked ON; other errors and a wrong shape are not retried.
  The pause is a synchronous Atomics.wait (read() is synchronous and called from many places). It costs up to
  150 ms once per distinct failure: the same failure on the same file (error, size, mtime, ctime) is not retried
  again, so a file that stays corrupt or a lasting EACCES does not stall every reader (review 1).
- A new window closes any earlier open one at the new period's start (a period starts only on an ON read), and the
  first sweep that reads the switch again closes every open window (review 1: a flapping file left one open).

## Rejected
- Ending the period only for a file that is present but fails to parse (the card's other option): a lasting
  permission or IO error would then keep the period, and #5435 review 3 showed that sends posts made while the pages
  showed OFF. A bounded retry narrows the brief case without that.
- Retrying asynchronously: read() is synchronous with many callers; making it async touches every gate.
- Point 3 (the window between a tear and the next sweep): unchanged, as the card records; ending the period at the
  request was tried in #5435 review 6 and made point 2 worse.
- The review-8 note (a period whose start could not be WRITTEN reads before_on): not built. The only place to record
  why there is no start is state.json, the file that could not be written. Left on the card.

## Weakest premise
That a torn read is brief. A writer that is not ours leaving a half-written file for longer than about 150 ms still
reads unreadable and ends the period, as before. communityswitch's own write is temp-and-rename, so it cannot tear.
Also: the window's `until` is set by the next sweep that reads the switch, so a post made while the person had it OFF
in the minute before that sweep can read switch_unreadable rather than before_on (both say it will not go).

## Validation
- engine/communityswitch-end-5460.test.js: the real sweep and the real status reader on a real post, plus the reader
  with staged errors; each case has a control (person's OFF reads before_on; ENOTDIR and a wrong shape not retried).
  Perturbation: disabling the status change and the retry turns 2 tests red.
- All 55 community test files and the file-scanning guards: 993 tests, 0 fail.

## Review 2
- Retry rounds are spaced at least 2 s apart (RETRY_GAP_MS), so a file that keeps changing (a slow writer) costs a
  reader at most one 150 ms round per 2 s, not one per read.
- The person's OFF (endOnPeriodNow) also closes any open window, since the switch was just read.
- Accepted: lastFailed is one module-wide key, so a second separate scanner lock on an UNCHANGED file, with no good
  read between, is not retried. That is the price of not stalling every reader on a lasting failure.
