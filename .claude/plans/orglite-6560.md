# orglite-6560: a removed member's board stops saying enrolled within about 15 minutes (kosmos#6560)

**Card:** kosmos#6560. Measured before the fix: 3,900 s (the hourly status ask plus its 5-minute tick).

**Plan:**
1. engine/orgenroll.js `memberCheck()`: the status route with `{ lite: true }` (relay #456, merged). It changes nothing locally.
   - It answers ended only on a clear gone or notHere (statusVerdict).
   - It answers nocheap when the answer is not marked lite.
2. server.js `orgMemberCheckIfDue`, run from the existing 5-minute tick (`orgRefreshIfDue`), while enrolled and after live execution:
   - every 10 minutes (`ORG_MEMBER_CHECK_MS`);
   - an ended runs the full `orgEnrollRefresh`;
   - a nocheap latches it off;
   - a full ask that ANSWERED and left the enrolment in place latches it off, but an unreachable one does not;
   - the hourly ask counts as a check.
3. Tests in server.orgmember-6560.test.js, with controls on main and mutations for the review tests.
4. End to end on the local stack: 900 s after the fix, against 3,900 s before.
