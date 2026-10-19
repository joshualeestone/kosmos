# eventually-5727-remote-tick (#5727 follow-up, Group-B batch 6, LAST file)

The final #5727 tail-migration file: migrate the one condition-poll in `server.remote-tick.test.js`
onto the shared `test-support/eventually.js` helper. POSITIVE, non-throwing (Liu m5040); Liu m5247
ordered this file LAST with a care point: run-before-trust at scale 1 AND scale 4, at least twice
each (tick-timing risk).

## The one migratable waiter (false-negative hunt)

A whole-file hunt (for / while / setTimeout / setInterval / Date.now / waitFor / new Promise / await)
finds exactly ONE migratable condition-poll:

- orig `const deadline = Date.now() + 3000; let s = resting; while (Date.now() < deadline && s.because === 'the board has not started the tunnel') { await new Promise((r) => setTimeout(r, 50)); s = await status(); }`
  -> a guarded `eventually` (L86-90):
  ```js
  let s = resting;
  if (s.because === 'the board has not started the tunnel') {
    s = await eventually(status, (v) => v.because !== 'the board has not started the tunnel',
      { timeoutMs: 3000, stepMs: 50 }).catch(() => status());
  }
  ```
  Budget/step byte-equal to the old loop (3000ms / 50ms). Predicate is the old `while` guard
  un-negated (`!== 'the board has not started the tunnel'`). require added at L50.

LEFT UNTOUCHED (not condition-polls):
- L41 `setInterval(() => {}, 1000)` -- inside the FAKE_BIN heredoc (the fake tunnel's keepalive,
  shipped-binary code written into a temp file), NOT test code.
- L72 `for (const f of ['mac_id','address','tls.crt','tls.key'])` -- a fixed-list write, not a poll.
- L57 `await start(0)`, L66 `status()` one-shot fetch, L73 `const resting = await status()` -- one-shots.

## Why the guard + catch-reread form (named weakest part)

- The `if (s.because === ...)` guard mirrors the old `while`'s FIRST test on the seed value
  (`resting`): if the tick already cleared the sentence before the first read, neither the old loop
  nor this version waits. Equivalent entry condition.
- `.catch(() => status())` is the non-throwing equivalent of the old loop's no-throw fall-through:
  `eventually` THROWS on timeout and does NOT return its last-probed value, but the assert on the next
  line prints `JSON.stringify(s)` as its failure diagnostic, so on timeout we re-read `status()` to keep
  that diagnostic current (what the old loop's last in-loop `s = await status()` left behind). The
  asserts at L91-92 stay the real check; a swallowed timeout still fails them.
- WEAKEST PART: the catch-reread adds one extra `status()` fetch on the FAILURE path only (success path
  unchanged). `eventually` also probes fresh at t=0, where the old loop slept 50ms first, so it can
  converge one read sooner on success (negligible, and strictly an improvement). Neither affects a
  passing run's outcome.

## No asserted time budget (scale-safety)

The two asserts (L91 `s.because !==`, L92 `s.state in [connecting, up]`) test STATE, not elapsed time.
There is no `took < N` assertion anywhere in the file. KOSMOS_TEST_TIME_SCALE only EXTENDS the
`eventually` budget (3000ms -> up to 12000ms at scale 4); the tunnel starts at a fixed ~200ms
(`AGENT_WORKFORCE_TUNNEL_ENSURE_MS = '200'`, unscaled), so a larger budget can only ever make a slow
tick MORE likely to be caught, never tighten anything. Scale 4 cannot red this test for a timing reason.

## Polarity audit (Liu m5040) -- positive, zero negative
The poll waits for a condition to BECOME true (the resting sentence to clear) and the following asserts
check exactly that. Not wrapped in assert.rejects or catch-as-success; does not expect a timeout. ZERO
negative waits kept hand-rolled because there are none in this file.

## File-overlap
`server.remote-tick.test.js` has no active sibling worktree. Per Liu m5247 this is the last of the three
(connections-4451 #6128 merged, provider-accounts-3296 #6145 merged, remote-tick this one).

## Rebase note (honest)
The branch was first cut off origin/main 7569bb150; by the time the RBT finished, main had advanced 224
commits. `server.remote-tick.test.js` and `test-support/eventually.js` were byte-identical across that
span, but `server.js` (a runtime import: `require('./server')` + `start(0)`) changed (+65/-24), so after
rebasing onto dacb944f7 I RE-RAN the full run-before-trust against the shipping server.js rather than
trust the orphaned pre-rebase run.

## Validation (Mortals, node v26.8.1), run-before-trust -- 5 legs, rebased branch
`unset KOSMOS_AGENT_TOKEN && bash tools/queued-heavy.sh "..." node --test server.remote-tick.test.js`
(full-claim lane, who-has-the-box checked first), per Liu m5247 care point 3 (scale 1 AND scale 4, twice each, plus a pristine baseline):
- baseline (origin/main content, pre-migration, via git stash): 2 tests, 2 pass, 0 fail, 0 cancelled, 0 not-ok, 0 timed-out.
- branch scale 1 run 1: 2 / 2 / 0, 0 not-ok, 0 timed-out.
- branch scale 1 run 2: 2 / 2 / 0, 0 not-ok, 0 timed-out.
- branch KOSMOS_TEST_TIME_SCALE=4 run 1: 2 / 2 / 0, 0 not-ok, 0 timed-out.
- branch KOSMOS_TEST_TIME_SCALE=4 run 2: 2 / 2 / 0, 0 not-ok, 0 timed-out.
All five identical; "restored (expect 1)? 1" confirms the stash popped the migration back cleanly.
CI re-runs the whole suite on the head as the authoritative green-by-name gate.
