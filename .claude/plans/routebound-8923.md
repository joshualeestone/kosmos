# routebound-8923: bound #8230's source pin by the /api/report route, not by 20,000 characters (kosmos#8923)

## Card
PigeonPete noticed it building #8916. `engine/kosmos-report-hook.turnend-8230.test.js` pins `skipped: String(kept.skipped)`
and the two `noteTurnEndRefusal(body, ` calls in server.js's `/api/report` route, searching only its first 20,000
characters. On main the string is at 19,932 and the route runs 22,666 characters, so the next small addition above
it reds the test with nothing it guards changed.

## Change (test only)
The search is bounded by the route itself: from its `if (pathname === '/api/report' ...` line to the next top-level
`\n  if (pathname === `. Two guards first: the route is found, and a route follows it. Nothing else in the file moves.

## Rejected
A bigger fixed window (30,000): the same cliff, later. Anchoring on a string inside the route: one more thing to keep
in step.

## Proof
- Measured on main: both bounds see the string and exactly 2 refusals, so the pin means the same thing.
- Mutations on the worktree's server.js (restored after): padding 3,000 characters into the route reds the OLD test
  and leaves the new one green (the false red this removes); removing one refusal call reds the new one; moving the
  string out of the route reds the new one.
- A first draft also asserted that the bound holds no second route header; by construction it cannot, so that
  assertion could never fail, and it was removed.

## Review
(rounds recorded below)
