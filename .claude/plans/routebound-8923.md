# routebound-8923: bound #8230's source pin by the /api/report route, not by 20,000 characters (kosmos#8923)

## Card
PigeonPete noticed it building #8916. `engine/kosmos-report-hook.turnend-8230.test.js` pins `skipped: String(kept.skipped)`
and the two `noteTurnEndRefusal(body, ` calls in server.js's `/api/report` route, searching only its first 20,000
characters. On main the string is at 19,932 and the route runs 22,666 characters, so the next small addition above
it reds the test with nothing it guards changed.

## Change (test only)
The search is bounded by the route itself: from its `if (pathname === '/api/report' ...` line to its own closing brace,
the first `\n  }` at two-space indent (its body is indented deeper). Guards: the route is found; its closing brace is
found; and the bound holds no other route header, which fails if the brace closed early or late.

## Rejected
A bigger fixed window (30,000): the same cliff, later. Anchoring on a string inside the route: one more thing to keep
in step.

## Proof
- Measured on main: both bounds see the string and exactly 2 refusals, so the pin means the same thing.
- Mutations on the worktree's server.js (restored after): padding 3,000 characters into the route reds the OLD test
  and leaves the new one green (the false red this removes); removing one refusal call reds the new one; moving the
  string out of the route reds the new one.
- A first draft ended at the next route header and also asserted that the bound held no route header; by
  construction it could not, so that assertion could never fail, and it was removed. Bounding by the brace (review 1)
  makes the same assertion meaningful again, and a mis-indented brace now reds it.

## Review
- Round 1 (opus): WARNING, ending at the next route header also took in anything written between the two routes, so
  the string moved into a comment there still passed (reviewer's probe). Fixed: the bound ends at the route's own
  closing brace (the shape PigeonPete's duplicate, anchor-8922, used). Mutations, each as expected: padding green (the
  false red removed), a dropped refusal red, the string moved out red, the string moved between the routes red, a
  mis-indented closing brace red. NITs not taken: a route written in another form than `if (pathname ===` (none exist,
  296 headers measured); the +1 arithmetic is gone with the rewrite.
