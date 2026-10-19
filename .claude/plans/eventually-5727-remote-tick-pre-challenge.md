---
method: challenge-loop
branch: eventually-5727-remote-tick
diff_hash: 681c5d5514618cd5f7a9ab654a4a1269afa2132e891c118752d4493b3024d35e
validation: passed
subdir_audit: passed
timestamp: 2026-10-15T05:16:01Z
iterations: 1
converged: true
---

# Pre-challenge proof: eventually-5727-remote-tick (#5727 follow-up, Group-B batch 6, LAST file)

Migrates the one condition-poll in `server.remote-tick.test.js` onto the shared `eventually()` helper:
the `Date.now() + 3000` deadline loop that waits for the board's own ensure tick to clear the "the board
has not started the tunnel" resting sentence. POSITIVE, non-throwing (Liu m5040). require added at L50;
migrated block at L86-90; asserts (unchanged) at L91-92.

```js
let s = resting;
if (s.because === 'the board has not started the tunnel') {
  s = await eventually(status, (v) => v.because !== 'the board has not started the tunnel',
    { timeoutMs: 3000, stepMs: 50 }).catch(() => status());
}
assert.notEqual(s.because, 'the board has not started the tunnel', JSON.stringify(s));
assert.ok(['connecting', 'up'].includes(s.state), JSON.stringify(s));
```

Budget/step byte-equal to the old loop (3000ms/50ms); predicate is the old `while` guard un-negated; the
`if` guard mirrors the old `while`'s first test on the seed; `.catch(() => status())` re-reads on timeout so
the asserts' `JSON.stringify(s)` diagnostic stays current (eventually throws on timeout and does not return
its last-probed value). The asserts remain the check.

## False-negative hunt
A whole-file hunt (for / while / setTimeout / setInterval / Date.now / waitFor / new Promise / await) finds
exactly ONE migratable condition-poll (migrated). LEFT UNTOUCHED: L41 `setInterval(() => {}, 1000)` (inside
the FAKE_BIN heredoc, shipped fake-tunnel keepalive, not test code), L72 `for (const f of [...])` (fixed-list
write), and the one-shot `await start(0)` / `status()` / `const resting = await status()` reads.

## Polarity audit (Liu m5040) -- positive, zero negative
Waits for a condition to BECOME true (the resting sentence to clear); the following asserts check exactly
that. Not wrapped in assert.rejects/catch-as-success; does not expect a timeout. Zero negative waits in the file.

## No asserted time budget (scale-safety)
The two asserts test STATE (`s.because`, `s.state`), not elapsed time; there is no `took < N` assertion in the
file. KOSMOS_TEST_TIME_SCALE only EXTENDS the eventually budget (3000ms -> 12000ms @ scale 4); the tunnel's
ensure cadence (`AGENT_WORKFORCE_TUNNEL_ENSURE_MS`) is a separate seam that scale never touches. A larger budget
can only make a slow tick MORE likely to be caught, never tighten anything.

## WEAKEST PART, named: the migrated branch is NOT exercised in this test environment (coverage, not correctness)
The blind reviewer (below) flagged, and I then confirmed by direct investigation, that in EVERY run -- my 5-leg
RBT and the reviewer's own two runs -- the test printed `note: the tick fired before the first read`. That note
is the `else` of L77: it means the FIRST `status()` read already saw `because !== 'the board has not started the
tunnel'`, so the L87 guard was FALSE and `eventually` NEVER RAN. The green runs validated that the FILE passes;
they say nothing about the migrated wait itself.

This is a PRE-EXISTING property of the test, not introduced by the migration: the old `while` loop read via the
same `status()` and had the identical blind spot (its `while` also never entered when the first read did not
observe resting). The test's own comments (L74-76, L79) acknowledge the resting half is "unproven for this run"
when the tick beats the read and route that coverage to `engine/remote.test.js`.

I made a genuine effort to force the branch, documented honestly:
1. Bumped the ensure cadence 200ms -> 1500ms (throwaway copy). The note STILL printed (first read still saw
   non-resting). Interval tuning cannot reliably hit the narrow window.
2. Disabled the auto-tick (60000ms) and injected one deterministic `remote.ensure()` at 600ms (byte-identical to
   server.js's production tick, L22743), so nothing should start the tunnel before the first read. The note STILL
   printed in both scale 1 and scale 4. So the first `status()` read observes a non-resting state regardless of
   when ensure is called.
3. Verified the GET `/api/remote` route (server.js:10069-10088) is READ-ONLY (no `ensure()`), so the read is not
   itself starting the tunnel. The resting sentence is simply not observable through `status()` in this
   environment; the condition is already resolved by the first read, for the same engine-timing reason the old
   loop was never entered either.

I stopped there rather than stub the engine/route to force an unreachable branch (that would be a fixture
answering a different question, not the shipped integration). The migrated wait's CORRECTNESS rests on: the blind
reviewer's converged behavior-preservation review (all five questions, by code reading); the `eventually()`
helper's own test suite; the 8 already-merged identical migrations in this batch (#6102/#6112/#6117/#6121/#6123/
#6128/#6145 + PR-1 #5738); and the RBT below confirming the file passes identically to its pristine baseline at
both scales. WHAT WOULD CHANGE MY MIND: if the migrated `eventually` call, when actually entered (driven at the
engine level in engine/remote.test.js, where the resting->started transition IS deterministically observable),
behaved differently from the old loop -- but the code is a mechanical budget/step/predicate-equal transform, and
the reviewer confirmed the timeout/catch/re-read handling preserves the old no-throw fall-through.

## Validation (Mortals, node v26.8.1) -- run-before-trust, 5 legs, rebased branch
Branch rebased onto latest origin/main (dacb944f7; +224 commits since the 7569bb150 base). `server.remote-tick
.test.js` and `test-support/eventually.js` were byte-identical across that span, but `server.js` (a runtime
import) changed (+65/-24), so the RBT was RE-RUN on the rebased branch against the shipping server.js.
`unset KOSMOS_AGENT_TOKEN && bash tools/queued-heavy.sh "..." node --test server.remote-tick.test.js` (full-claim
lane, who-has-the-box checked first), per Liu m5247 care point 3 (scale 1 AND scale 4, twice each, plus baseline):
- baseline (origin/main content, pre-migration, via git stash): 2 tests / 2 pass / 0 fail / 0 cancelled, 0 not-ok, 0 timed-out.
- branch scale 1 run 1: 2 / 2 / 0, 0 not-ok, 0 timed-out.
- branch scale 1 run 2: 2 / 2 / 0, 0 not-ok, 0 timed-out.
- branch KOSMOS_TEST_TIME_SCALE=4 run 1: 2 / 2 / 0, 0 not-ok, 0 timed-out.
- branch KOSMOS_TEST_TIME_SCALE=4 run 2: 2 / 2 / 0, 0 not-ok, 0 timed-out.
All five identical; "restored (expect 1)? 1" confirms the stash popped the migration back cleanly. CI re-runs the
whole suite on the head as the authoritative green-by-name gate.

## Challenge-loop ledger (1 blind pass, Sonnet) -- CONVERGED, 0 actionable findings
The reviewer (blind to my conclusions) independently read the diff, the eventually() helper contract, and the
exercised parts of server.js/engine/remote.js, and ran the test via the queued-heavy lane at default scale and
KOSMOS_TEST_TIME_SCALE=4 (both 2/2/0, no "not ok", no "timed out"). Its answers: (1) behavior-preserving -- guard
equivalent, polarity exact, step/budget equal, timeout throws and `.catch(() => status())` re-reads so `s` is
always a status object and the asserts are the check on both paths; (2) not vacuous -- if the tunnel never starts,
eventually throws, the catch re-reads the stuck status, and L91 fails with it; a probe error is re-thrown by the
re-read, hiding nothing; (3) scaling safe -- scale only lengthens the budget, no elapsed-time assertion, the 200ms
ensure seam is unscaled; (4) nothing else to migrate, nothing wrongly migrated; (5) no convention issues, no em/en
dashes in the added lines. ONE [WARNING] (coverage, not a code defect): in both runs the "tick fired before the
first read" note printed, so the migrated branch did not execute -- the same blind spot the old loop had. No code
change was made. See "WEAKEST PART" above for my investigation and disposition.

## Subdir audit: passed
The changed test file sits at the repo root (project-wide root CLAUDE.md); `.claude/plans/` has no CLAUDE.md; no
directory was added.

## Origin classification
Every change is BRANCH-origin: one `eventually` require, one poll-block replacement (with a 4-line comment), and
the two plan files. No other file touched; test count unchanged (2). The diff_hash is `git diff origin/main...HEAD`
excluding this proof file, `shasum -a 256`.
