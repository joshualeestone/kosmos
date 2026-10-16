# familycap-6309: a monthly usage cap in the family policy (kosmos#6309)

## Goal
A family's signed org policy can set `usage_cap: { monthly_tokens, warn_pct }`. The child's board counts every agent's
tokens this calendar month (in the policy's zone, as quiet hours read it). At warn_pct it says so (the board, and the
rollup so the parent's console row shows it). At the cap, new messages to agents are refused with the policy's own
sentence through the quiet-hours gate (engine/chat.js deliverWithGap); the look-after commands still go.

## Order
1. Board: orgpolicy shapeOk holds usage_cap to an exact shape (as the coordinator will); a capAt() reading.
2. Board: the month's count, reusing engine/swarm.js's meter (tokensOf, transcript reading) over all agents.
3. Board: the gate in deliverWithGap, and the sentence; the AI policy block names the cap.
4. Board: the rollup carries usage { used, cap } (under the consent words that name the policy).
5. Coordinator (kosmos-relay): org.rs policy_problem accepts usage_cap; the console row shows used / cap.

## Known limits (said on the card)
- The meter reads Claude Code transcripts only, so a non-Claude agent's tokens are not counted yet.
- A board older than this ignores usage_cap (unknown keys stay unread): no cap is enforced there, and the console must
  not imply one is.

## Weakest premise
That tokens counted from transcripts are close enough to what the provider counts for a cap to be fair. It is the
same count the swarm limit already enforces.

## Step 1 done (d9e9db430c)
orgpolicy: capShapeOk (exact { monthly_tokens, warn_pct, tz }), monthStart (the 1st at local midnight, DST-safe),
capAt, capAllows. Tests: orgpolicy-cap-6309.test.js, 3 tests; a mutation removing the shape line reds one.

## Step 2 trap (found reading engine/swarm.js)
swarm.readFile keeps ONE cache entry per file and resets it to zero whenever `since` changes ("a new day"). A month
count sharing that cache with the swarm's daily meter would zero each other on every alternate call. The month count
must use its own cache: readFile takes the cache as a parameter (default: the swarm's, so the swarm is unchanged).

## Steps 2 to 5 done (2026-10-16, after the move to the new Mac)
- 088b44e6bf: usagecap tested (7). Found: orgpolicy.currentStrict was not exported (capInForce threw on every call);
  a first, bounded count was memoised for 60 s (a new board would not refuse for a minute). Both fixed.
- 361485df27: the gate in deliverWithGap and answerQuestionMenu (`capped: true`), familycap-6309.test.js (4).
- 66791cfcb1: the rollup's policyUsage { used, cap, warn, over } under the policy words; heads-up and cap are changes.
- kosmos-relay familycap-6309 411ab936: usage_cap in the policy shape, policyUsage stored and served, the console
  editor section, policy row, chip, and This month on the child's card and drawer.

## Decided
- No AI policy block line: quiet hours has none, and the refusal reaches the person, not the agent.
- A cap refusal is not an agent event yet (no coordinator rule word); the parent sees used / cap in the console.
- The heads-up is the parent's (console). A banner on the child's board is new board UI and waits on design.
- A fault reading the policy or the count reads as open, as quiet hours do.
