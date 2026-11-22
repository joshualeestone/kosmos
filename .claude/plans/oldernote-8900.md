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
