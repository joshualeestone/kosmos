# bridge-signal-5580: runBridge names what killed the child (#5580)

## Card
#5580, split from #5513's CI investigation. The #4417 launch-event test
(`engine/agyseed-4417.test.js`) fails in CI on macos-latest at the first assertion
`assert.equal(r.code, 0)` with actual `null`. A null close code means the spawned bridge
child was KILLED BY A SIGNAL (e.g. SIGKILL under memory pressure), not that it ran slow;
the bare assertion only prints "actual: null", which reads like a timing flake.

## Change (diagnostics only, no behaviour change)
- `runBridge` (a test helper in that file) captures the child's close SIGNAL (the 2nd arg
  of the `close` event) and its stderr, and resolves `{ code, signal, out, stderr }`
  (was `{ code, out }`).
- The `assert.equal(r.code, 0)` assertion carries a message naming code/signal/stderr, so a
  recurrence reads as "killed by <signal>" with any stderr instead of a bare "actual: null".

## Scope / non-goals
- NO behaviour change: the assertion passes/fails on exactly the same condition; the message
  only appears on failure. `runBridge` has one caller, which reads only `r.code`.
- Does NOT fix the underlying signal-kill of the child under CI memory pressure. That is a
  separate follow-up, informed by the signal this change surfaces.

## Verification
- Normal gates: challenge-loop + full suite. No browser-checks (test-only, no rendering change).
