# familycap-6309: a monthly usage cap in the family policy (kosmos#6309)

## Goal
A family's signed org policy can set `usage_cap: { monthly_tokens, warn_pct, tz }`. The child's board counts every Claude
transcript's tokens on the computer this calendar month (from the 1st in `tz`). At warn_pct the rollup says so, and the
parent's console shows "Close to this month's cap"; the child's own board shows nothing until the cap (see Decided). At
the cap, new messages to agents and answers to their questions are refused with the policy's own sentence, beside the
quiet-hours gate (engine/chat.js); the look-after commands still go. So are the person's Start, Restart and put-back, and
making an agent (engine/remove.js, engine/create.js), as quiet hours refuses them: a started agent can go to work
without a typed message, so starting one is new work, not looking after it. Restarts the board makes to finish a
change still go.

## Order
1. Board: orgpolicy shapeOk holds usage_cap to an exact shape (as the coordinator will); a capAt() reading.
2. Board: the month's count, reusing engine/swarm.js's meter (tokensOf, transcript reading) over all agents.
3. Board: the gate in deliverWithGap, and the sentence. (The AI policy block was dropped: see Decided.)
4. Board: the rollup carries policyUsage { used, cap, warn, over, month } (under consent words that name the monthly AI
   cap).
5. Coordinator (kosmos-relay): org.rs policy_problem accepts usage_cap; the console row shows used / cap.

## Known limits (said on the card)
- The meter reads Claude Code transcripts only, so a non-Claude agent's tokens are not counted yet.
- A board new to the cap (no saved count for the month) enforces nothing until its worker posts a first count, and
  then the partial count until it has caught up. A restarted board does not: the month's saved count holds it up.
- Every Claude transcript in the config folders Kosmos finds (status.configRoots) counts, Claude Code used outside
  Kosmos too. One run with CLAUDE_CONFIG_DIR somewhere else is not counted.
- A board older than this ignores usage_cap (unknown keys stay unread): no cap is enforced there, and the console must
  not imply one is.

## Merge order
Either order is safe. A board with this change and a coordinator without it: no policy can carry usage_cap yet (the
coordinator refuses the key), so nothing is counted or sent. A coordinator with it and a board without it: a cap can
be saved, an older board ignores the key (enforces nothing, reports nothing), and the console shows no count.

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
- 66791cfcb1: the rollup's policyUsage { used, cap, warn, over }; heads-up and cap are changes. (Challenge loop
  iteration 1 moved it from the policy-version words to its own line naming the monthly AI cap, NAMES_CAP.)
- kosmos-relay familycap-6309 411ab936: usage_cap in the policy shape, policyUsage stored and served, the console
  editor section, policy row, chip, and This month on the child's card and drawer.

## Decided
- No AI policy block line: quiet hours has none, and the refusal reaches the person, not the agent.
- A cap refusal is not an agent event yet (no coordinator rule word); the parent sees used / cap in the console.
- The heads-up is the parent's (console). A banner on the child's board is new board UI and waits on design.
- A fault reading the policy or the count reads as open, as quiet hours do.

## The count moved off the message path (challenge loop, iterations 1, 5 and 6)
Three reviewers in a row flagged the gate counting transcripts inside deliverWithGap. I deferred it twice, then
measured it: on this Mac (8,313 transcripts touched this month, 2.5 GB) a bounded count took over 3.7 s a call and
had not caught up after 31 minutes. Deferring was wrong. Now a worker thread (engine/usagecap-worker.js) counts, and
the gate reads its latest count with the month's saved one; it never reads a transcript. The rollup reads the same
way (capReport): on the enrolled board its tick runs in the board's own process (server.js orgRollupTick), so an inline
count there was the same stall. (I first wrote that the tick ran in a child process. It does not; iteration 7 caught
it.) The worker stops the next time a gate or the rollup reads a policy with no cap in force. Tests use the inline count ('sync', resetForTests); one test drives the
real worker.
Known limit: the worker's month cache holds a set of message ids per transcript touched this month (about 8,300 files
on this fleet Mac; a child's computer has far fewer).
Weakest premise: that a worker thread is cheap enough to keep on every board with a cap. It starts only when a cap is
in force, is unref'd, and recounts every 10 s off the main thread.

## Only the board counts (challenge loop, iteration 13)
The worker starts only in the board's process (server.js calls usagecap.countOnThisBoard). Any other process that
reaches a gate reads the month's saved count. A worker that stops unexpectedly logs one line. Reading a transcript
(readFile, tokensOf) moved out of engine/swarm.js into engine/transcriptread.js, which requires node's own modules
only, and the board sends its config folders with the zone: the worker no longer loads the engine or status.js.
