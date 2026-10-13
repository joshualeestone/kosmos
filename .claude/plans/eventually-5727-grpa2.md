# eventually-5727-grpa2 (#5727 follow-up 1, Group-A batch 2)

Second Group-A batch of the #5727 tail: migrate three more hand-rolled poll waiters onto the shared
`test-support/eventually.js` helper. Three distinct shapes, all POSITIVE liveness waits, zero
timeout-expecting (negative) waits, so none is kept hand-rolled (Liu's standing rule, m5040).

## Files and shapes

1. **server.startup.test.js** (#923) -- the startup-banner wait was a THROWING wall-clock while-loop
   (`while (!/Kosmos on http/.test(stdout)) { if (elapsed>15000) throw; sleep 50 }`). Migrated as a
   DIRECT delegate (no swallow): `eventually(() => /Kosmos on http/.test(stdout), v=>v, {timeoutMs:
   15000, stepMs: 50, describe: ...})`. eventually throws on timeout exactly as the original did (the
   remote.test.js precedent), and `describe` reproduces the original diagnostic (stdout). Positive.

2. **server.switch-arms-2238.test.js** (#2238) -- the `waitUntil(pred, ms)` helper was an
   already-wall-clock while-loop that RETURNS false on timeout. Its ONE caller (L89)
   `assert.equal(await waitUntil(() => selfRestartCalls === 1), true, ...)` asserts the result is
   true, so this is a positive wait (the false return feeds a positive assertion, it does not EXPECT a
   timeout). Migrated as a boolean-preserving delegate:
   `eventually(() => pred(), v=>v, {timeoutMs: ms, stepMs: 20}).then(()=>true).catch(()=>false)`. The
   boolean contract is unchanged, so the caller's assertion stays the failure check; the only shift is
   the deadline now scales with KOSMOS_TEST_TIME_SCALE (the intended #5727 refinement). Positive.

3. **cli.start-reclaim-4679.test.js** (#4679) -- the stub-listening wait was a COUNT-based for-tick
   loop (`for i<40 { ok=await connect-attempt; if(ok)break; sleep 100 }`, ~4000ms). The probe is an
   ASYNC connection attempt; eventually awaits async probes (`const value = await probe()`, eventually.js:53).
   Migrated to `eventually(<async connect probe>, v=>v, {timeoutMs:4000, stepMs:100}).then(()=>{listening=true}).catch(()=>{})`.
   The `.catch(()=>{})` swallow preserves the old no-throw behaviour (the loop fell through silently to
   leave listening=false); the following `assert.equal(listening, true, ...)` stays the real check with
   its original message. Count -> wall-clock is the accepted clitick/#6069 precedent (bounded by scale).
   Positive.

## Polarity audit (per Liu m5040)

All three waits are positive liveness waits: each waits for something to BECOME true (startup banner
present; the deferred self-restart fired; the stub is listening) and the test asserts on that. None is
wrapped in assert.rejects or catch-as-success, none expects the wait to time out. ZERO negative waits,
so no waiter is kept hand-rolled. (switch-arms's false return is mapped back exactly so its single
positive-assertion caller is byte-equivalent except for the scaled deadline.)

## File-overlap

Picked these three BECAUSE they have no active sibling worktree touching them. The other remaining
Group-A files were deferred: cli.sandbox-4636 and server.roomhold-idle-4624 have active sibling
branches modifying those exact files (sandbox-4636, sandbox-4636-rb, roomhold-4624), and
cli.busy-health-4466 is timing-sensitive (asserts time budgets, process-exit/socket logic) so it wants
its own run-before-trust batch.

## Validation (Mortals, node v26.8.1)

`unset KOSMOS_AGENT_TOKEN && node --test server.startup.test.js server.switch-arms-2238.test.js cli.start-reclaim-4679.test.js`:
- baseline (origin/main content, pre-migration): 6 tests, 6 pass, 0 fail, 0 cancelled, EXIT 0.
- branch, scale 1: 6 / 6 / 0, EXIT 0 (identical to baseline).
- branch, forced KOSMOS_TEST_TIME_SCALE=4: 6 / 6 / 0, EXIT 0.
Count = 6 = server.startup 2 + switch-arms 3 + start-reclaim 1. CI re-runs the whole suite on the head.
