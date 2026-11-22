# kosmos#8900: send a note added to an OLDER day's report

## Problem

`kosmos feedback note --date <day>` (#8896) adds a note to an earlier day's report on this computer. It reaches the
Kosmos team only when that day is the last one the send record names (yesterday on an hourly check, or an older day
once through flushChangedDay). A correction to any other earlier day stays here, though one install asked for
exactly that.

## Change

1. engine/feedbacksend.js keeps a short `pending` list beside the one-day send record: `[{ date, tries }]`, at most
   14 days (the oldest dropped past that). read() returns it (only well-formed entries); write() carries it across
   every partial write, as it carries `sent`, so setOn and markSent cannot wipe it.
2. `queueCorrection(date)`: adds an earlier day to the list (tries 0; a day already there is reset to 0). Refuses a
   bad date and today (today goes the normal way).
3. `drainCorrections(now)`, called at the end of sweepTick (the board's hourly check): with sending on, it takes the
   FIRST pending day, counts the attempt (tries + 1, saved before the POST), and sends that day's report once through
   maybeSend, which uses the same payload, scrub, endpoint, timeout and test guards. Accepted by the collector:
   removed. Three tries without acceptance: dropped. One day per tick, so it cannot flood the collector. With
   sending switched off, the list is cleared: nothing queued while sending was on leaves later because it was turned
   back on. It never touches `sent`, `sentHash` or `sentAt`, so today's send timing is unchanged.
4. Both CLIs: a note on an earlier day queues it (when sending is on), and earlierNoteMessage says the changed report
   goes to the Kosmos team on one of Kosmos's hourly checks while it is running (or not sent, with the reason: off,
   unreadable, a test run).

## Rejected

- Sending the older day from the note command itself (sendNow): sendNow tracks one day, so marking an older day sent
  flushes today and resets today's three-hour floor.
- Re-pointing the one-day record at the older day: the same problem, plus today's report loses its dedup marker.
- Sending every pending day in one tick: a long list could burst the collector; one per hour is plenty for a
  correction.

## Weakest premises

- The collector keeps one copy per install per day (chaoskosmos-site api/_feedbackcore.js stores the new blob, then
  deletes this install's older same-day blob), so a re-sent day replaces rather than duplicates. Read from the site's
  code, not measured against the live collector.
- A day that is also the last one sent can go twice (the existing flush plus the correction). Harmless if the
  premise above holds.

## Done when

A note on a day older than the last one sent reaches the collector once (a test with a stub sender), today's send
record is unchanged by it, three failed tries drop it, switching sending off clears the list, and the command's
sentence says what will happen.

## Review 1 (opus)
- Fixed: yesterday, when it is the last day sent, went twice in one hourly check (the sweep's own resend plus the
  drain). It is not queued (the sweep re-sends it, with its own retries); the sentence says so. A queued day that is
  also the record's day records its delivered hash on success, so flushChangedDay does not send it a third time.
- Fixed: switching sending off and back on between checks still sent old corrections. setOn(false) now cancels the
  list at once.
- Fixed (privacy): a note could push out a report kept here (written while sending was off, or before anything was
  sent) for the first time. Only days on or before the last one Kosmos sent are queued; later ones are refused with a
  sentence saying the note stays here.
- Fixed: the sentence now says each day is tried up to three times and that switching sending off cancels it.
- Fixed (NITs): a used-up day no longer costs that hour's check; the constants moved off read()'s docblock.
- Deferred: the settings file has no lock, so a CLI write and the board's write can race (a lost queued day, or a
  read-then-save that undoes a switch-off in the same milliseconds). The same window already exists for every writer
  of this file (setOn, markSent from the CLI's sendNow); a lock for the file is its own card, not this one.
- Weakest premise added: "on or before the last day sent" does not prove that day itself was sent (sending could have
  been off on that day and on later). It is the conservative line available without a per-day record.

## Review 2 (sonnet)
- BLOCKER, fixed: a queued day that is also the record's day went twice when a later day's send came FIRST
  (flushChangedDay, then the drain). Every corrected day now goes one way: drainCorrections alone. flushChangedDay
  skips a queued day, and sweepTick's own resend of yesterday skips a queued yesterday. So yesterday is queued like any
  other day (round 1's "leave yesterday to the sweep" is gone) and one sentence covers all.
- Fixed (privacy, replacing round 1's "on or before the last day sent"): `offered`, the days Kosmos has started
  sending (markSent records each, as every real send marks first; at most 60). Only those are queued, so a report kept
  here, even one older than the last day sent, is never sent for the first time by a note. A file from before the list
  allows only the record's own day.
- Fixed: a note added while that day's send was in flight was lost when the send's success removed the day. The
  completion now compares the report's hash with the one it sent and keeps the day queued when they differ.
- Fixed: wording "so it will not send that day".
- Kept: past 14 queued days the oldest is dropped; the sentence about the day just queued is still true.
- Tests for each (flush-first, the in-flight note, a never-offered day before the last one sent, offered survives
  markSent); four mutations each red.

## Review 3 (opus)
- Fixed: on a settings file from before `offered`, a day really sent before the upgrade was called "not sent". The
  sentence now says "Kosmos has no record of sending that day, so this note stays on this computer", true either way
  (test with an old-shaped file, and a control that the record's own day is still queued).
- Fixed: a queued yesterday that the collector kept refusing was tried more than three times: after the drain dropped
  it, sweepTick's own resend of yesterday took over. A used-up day that is the record's day is now marked handled (its
  current hash). Test: eleven hourly checks on the same day, exactly three posts. My first version of that test ticked
  every three hours past midnight, so "yesterday" moved and the mutation stayed green; corrected, it now goes red.
- Kept (NITs): past 14 queued days the oldest is dropped after the person was told it goes; the microsecond race
  between a CLI write and the board's (as round 1).
