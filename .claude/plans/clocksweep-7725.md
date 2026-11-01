# clocksweep-7725 (kosmos#7725)

Tests in both repos assumed no repeated fall-back hour, and one reader was really wrong.

## Done
- Every computed `touch -t` site runs both `date` and `touch` in UTC.
- `test-touch-t-utc-7725.sh` guards it, with a seeded control, wired into each repo's runner.
- kosmos: test fixtures that assumed no repeated hour (agentnudge, taskrepeat-minutes-6893, limithold-5805, limitmsg-5805, release-gate, versions-entry-gate).
- kosmos: `kosmos_versions_entry_stamp_off` takes the later instant of a repeated wall time unless it is more than 20 minutes ahead.

## Proof
Run on the live repeated hour 07:00 to 08:00 UTC, 2026-11-01, with TZ=UTC as the control. Results are on the card.

## Decided
The reader accepts a stamp up to 40 minutes stale for up to one hour a year, because a stale and an ahead stamp print the same wall time there. Rejected: the old read, which refused every fresh stamp.
