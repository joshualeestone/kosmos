---
pre_challenge: true
method: challenge-loop
branch: connections-1034
diff_hash: c5ddf7064173fac99e4504f09283c358cc44ae3f7849f632d6a9de58efa74de0
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T12:29:06Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 produced zero NEW actionable findings; its two
findings were NITs the reviewer itself rated non-actionable, context disambiguating)
**Total findings:** 1 BLOCKER, 3 WARNINGs, 4 NITs
**Fixed:** 1 BLOCKER + 3 WARNINGs + 2 NITs | **Accepted/documented residual:** 2 NITs

The change (kosmos#1034): `engine/connections.js` splices a static, stateless
instruction block into every agent brief. It ended with a false clause -- "You
cannot see any of this... you do not know which providers are connected" -- which
made an agent that could look refuse to and send the person to read a screen it
could have read itself. The fix corrects the sentence, keeps the block stateless
(the tests enforce it), and splits two opposite cases: the connection SETUP is
knowable (GET /api/accounts), the live SCREEN is not (ask). Every mechanism claim
was verified against server.js and install/kosmos across the loop.

### Per-Iteration Breakdown

#### Iteration 1 -- 1 BLOCKER
- [BLOCKER] engine/connections.js -- the first cut named `/api/connections` as a
  read for provider setup. That route is the GitHub/Vercel/Cloudflare + metered
  search-token "doors" shelf (server.js:288, :4642) and reading it makes live
  verify() calls that bill the person's PAID search quota. Wrong subject AND
  spends money. --> FIXED: `/api/accounts` alone (the route that actually carries
  Claude + OpenAI accounts with a live-checked connection field). This was the
  "claims more than the code does" defect the card removes, one route over.

#### Iteration 2 -- 1 WARNING, 2 NITs
- [WARNING] "a screen you could have read yourself" oversold the ease: no
  `kosmos accounts` verb, so an agent told "look, do not ask" could hunt for a
  command, find none, and stall. --> FIXED (named the read, softened the claim).
- [NIT] `(kosmos#1946)` card number leaked into agent-facing prose --> FIXED
  (dropped from the emitted block; kept in the docblock).
- [NIT] the docblock's "no security surface, no consent" clause outlived the body
  --> FIXED (reconciled: knowledge-not-state; runtime read is token-gated, so
  consent is enforced by the token, not by asking).

#### Iteration 3 -- 2 WARNINGs, 1 NIT
- [WARNING] (near-blocker, cross-account) the block hardcoded `16180` as "the
  default" port. install/kosmos:93-99 derives the port PER-UID; only uid 501 gets
  16180. On a multi-account Mac (the exact case #1946 exists for) an agent hitting
  16180 blindly can reach a DIFFERENT account's board. --> FIXED: removed the
  hardcode; the block cautions the port is per-account and to let the CLI resolve it.
- [WARNING] the enforcing-board token route was under-specified. --> FIXED: the
  token goes off the command line (never argv, which leaks it cross-account, #1970);
  the kosmos CLI is the reference; honest that there is no one-word verb.
- [NIT] the opener said "the last paragraph matters" but the ending is now two
  paragraphs --> FIXED ("the closing paragraphs").

#### Iteration 4 -- CONVERGED (zero new actionable)
An independent blind reviewer verified every claim against the code: /api/accounts
returns both providers with live status (server.js:3489); the runtime read is
403'd without the board token on an enforcing board (server.js:1560-1580); 16180
is only the uid-501 default and the cross-account hazard is real and warned about;
the token guidance teaches the safe off-argv pattern (kosmos_curl -H @file) and
forbids argv; no `accounts` verb exists; tests 9/9; no @, no /is connected on
this/, no card numbers in the emitted block, no em dashes (positive control fired).
- [NIT] ":105 the CLI resolves the address... reads for a beat like a turnkey verb"
  and ":107 a gate to pass could be misread as bypass" -- both DOCUMENTED as
  accepted: the reviewer states context disambiguates each and neither is worth
  changing; re-churning agent prose on non-actionable NITs is the moving-target trap.

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | BLOCKER | engine/connections.js | named /api/connections (paid-quota doors shelf, wrong subject) | FIXED (/api/accounts only) |
| 2 | 2 | WARNING | engine/connections.js | "could have read yourself" overclaim could strand an agent | FIXED |
| 3 | 2 | NIT | engine/connections.js | card number in agent-facing prose | FIXED |
| 4 | 2 | NIT | engine/connections.js | docblock consent clause outlived body | FIXED |
| 5 | 3 | WARNING | engine/connections.js | hardcoded 16180 -> cross-account board read | FIXED (per-account caution) |
| 6 | 3 | WARNING | engine/connections.js | enforcing-board token route under-specified | FIXED (off-argv, CLI reference) |
| 7 | 3 | NIT | engine/connections.js | "the last paragraph" after ending split | FIXED |
| 8 | 4 | NIT | engine/connections.js | "CLI resolves"/"gate to pass" momentary ambiguity | ACCEPTED (context disambiguates) |

### Strengths (verified against code at iteration 4)
- Route is correct and the only one named: /api/accounts (server.js:3489), Claude
  + OpenAI, live-checked connection field. /api/connections (paid quota) absent.
- Token guidance is accurate AND safe: enforcing board 403s an untokenized read
  (server.js:1577); the block teaches the off-argv pattern and forbids argv (#1970).
- The cross-account port hazard is warned about and fails closed: a wrong-port read
  on an enforcing board is 403'd by the per-account mode-0600 token.
- Stateless: blockBody arg-free (test asserts .length===0); no @, no
  /is connected on this/i in the body.

### Validation
- `node --test engine/connections.test.js` -> 9/9 pass, every iteration.
- Invariants (each iteration): /api/accounts present, /api/connections absent, no @,
  no /is connected on this/, blockBody arg-free, no card number in emitted block,
  all eight required true-phrases present, no em dashes in any of the five spellings.
- Scope: only `engine/connections.js` (plus these plan/proof files). No web/ change,
  so the #1720 browser-check CI gate needs no trailer.
