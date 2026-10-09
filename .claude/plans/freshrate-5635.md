# freshrate-5635: F2 from the 0.7.33 report (kosmos#5635)

## Done looks like
In `kosmos project show`, an idle or rate-limited member's stale summary line says what is true about it now, instead
of reading only as "older than the 4-hour rhythm".

## Why #5642 did not take
#5642 appended "idle since" to the same line, which still led with "older than the 4-hour rhythm", and it did nothing
for a rate-limited member. The report: "'idle since' shows, but the flag does not use the idle or rate-limited states".

## Decided
- A reporting runner idle now, whose summary was written more than 4 hours before its idle report (measured in
  idleNoted), reads "last written more than 4 hours before it went idle (...; idle since ...)". The gap is stated,
  not hidden: the report itself called such flags fair.
- Rate limited now: the overdue line stays and "rate limited now, so it cannot work until the limit lifts" is added.
- State stays 'stale'; working members and idle-only runners keep their forms.
- Weakest premise: that the board's rate_limited state is current (it is read from the screen).
