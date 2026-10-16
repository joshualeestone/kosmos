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
