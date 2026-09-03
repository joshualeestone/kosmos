# connections-1034 -- the connect block told agents they cannot see the connection state

## The card

kosmos#1034 (Josh, 2026-08-26: *"an agent to help me get some of these things
connected but they can't even see it to help with it."*). `engine/connections.js`
builds a static instruction block ("How connecting a provider works") that Kosmos
splices into every agent's brief. It ended with a bold clause: *"You cannot see any
of this. Ask. You do not know which providers are connected on this computer."*

That clause is FALSE. An agent can know which providers are set up. The clause made
an agent that could look refuse to, and send the person to read a screen it could
have read itself -- the inverse of the defect it looked like, and it failed while
looking like caution.

## The fix, and the constraint

Change the SENTENCE, not the architecture. The block must stay STATELESS
(`engine/connections.test.js` enforces it: `blockBody` takes no argument, the body
has no `@` and no `/is connected on this/i`). Baking machine state into a static
block goes stale the moment anything changes; that decision is correct and kept.

The corrected block splits two cases whose rule is opposite:
- **The connection SETUP is knowable** -- the board reports it at `GET /api/accounts`
  (every provider's accounts + a per-account live-checked connection status, Claude
  and OpenAI). So look, do not ask.
- **The live SCREEN genuinely cannot be seen** -- so ask what they are looking at;
  do not describe a button as though you can see it (both kept, both true).

The docblock was reconciled to match: the block is KNOWLEDGE, NOT STATE (it points
at where read-only state is readable, never bakes state in), and the phone-call
"cannot see, ask" model is scoped to the screen.

## The four-iteration challenge loop (why it took four)

Every attempt to make the read concrete (route, port, token) surfaced a real flaw
in the wording -- the mechanism is intrinsically fiddly, so the loop earned its keep:

1. **BLOCKER**: the first cut named `/api/connections` alongside `/api/accounts`.
   `/api/connections` is the WRONG route -- the GitHub/Vercel/Cloudflare/metered
   search-token "doors" shelf, and reading it makes live `verify()` calls that bill
   the person's PAID search quota (server.js:4643). Dropped it; `/api/accounts` only.
   (This was also the exact "claims more than the code does" defect the card removes,
   one route over -- and it was in the card's own framing, corrected on the card.)
2. **WARNING**: "a screen you could have read yourself" oversold the ease -- there is
   no `kosmos accounts` verb, so an agent told "look, do not ask" could hunt for a
   command, find none, and stall. Plus a card number leaked into agent prose, and the
   docblock's "no consent needed" clause outlived the new body. All fixed.
3. **WARNING (near-blocker, cross-account)**: the block hardcoded `16180` as "the
   default" port. `install/kosmos:93-99` derives the port PER-UID (only uid 501 gets
   16180); on a multi-account Mac -- the exact case #1946 exists for -- an agent
   hitting 16180 blindly could land on a DIFFERENT account's board. Removed the
   hardcode; the block now cautions that the port is per-account and to let the CLI
   resolve it.
4. **CONVERGED**: zero new actionable findings; two non-actionable NITs accepted
   (context disambiguates). The residual port risk is warned about and fails closed
   (a wrong-port read on an enforcing board is 403'd by the per-account token).

## Boundaries
- PR, not self-merge (Kosmos deploy is Angel / Mona Lisa).
- Robust to the #1946 transition: the token guidance holds whether or not the
  enforcing build is served yet, and never teaches an argv token leak (#1970 -- the
  token goes off the command line, the `kosmos` CLI is the reference).
