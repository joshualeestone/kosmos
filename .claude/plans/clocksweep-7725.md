# clocksweep-7725 (kosmos#7725)

Tests in both repos assumed no repeated fall-back hour, and one reader was really wrong.

## Done
- Every computed `touch -t` site runs both `date` and `touch` in UTC.
- `test-touch-t-utc-7725.sh` guards it, with a seeded control, wired into each repo's runner.
- kosmos: test fixtures that assumed no repeated hour (agentnudge, taskrepeat-minutes-6893, limithold-5805, limitmsg-5805, versions-entry-gate).
- kosmos: `kosmos_versions_entry_stamp_off` reads the CST label in the repeated hour; anything else keeps the first reading.

## Proof
Run live only in the SECOND reading of the repeated hour, 07:00 to 08:00 UTC, 2026-11-01, with TZ=UTC as the control. The first reading was not run live: the JS tests were replayed there under a shifted clock, and the versions gate has fixed-clock checks there. Other shell tests were not. Results are on the card.

## Decided
Read the label the writer has written since #1464. Rejected: picking an instant by nearness or a 20-minute bound, which accepted stamps up to 80 minutes stale. A stamp from before #1464 carries a literal CDT and keeps its old reading.
