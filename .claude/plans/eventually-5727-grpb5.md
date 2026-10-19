# eventually-5727-grpb5 (#5727 follow-up 1, Group-B batch 5)

Fifth Group-B batch: migrate the two BOTH-IN-FLIGHT concurrency-gate condition-polls in
`server.provider-accounts-3296.test.js` onto the shared `test-support/eventually.js` helper. Both
POSITIVE, non-throwing, zero timeout-expecting (negative) waits, so none is kept hand-rolled
(Liu m5040; Liu m5247 ordered provider-accounts-3296 SECOND, after connections-4451, before
remote-tick, with care point 2 about the both-in-flight waits).

## The two migratable waiters

A whole-file false-negative hunt (for / while / setTimeout / Date.now / setInterval / waitFor /
new Promise) finds two migratable condition-polls, each a concurrency gate that waits for N
requests to be simultaneously inside the provider live-check.

Migrated (both POSITIVE, non-throwing; the following CONTROL assert is the check -> `.catch(() => {})`):
- L215 `for (i < 100 && entered < 2) ... sleep(20)` -> `eventually(() => entered, (n) => n >= 2, { timeoutMs: 2000, stepMs: 20 }).catch(() => {})` (wait for both label-less gemini adds to be inside the live check at once).
- L311 `for (i < 100 && entered < 1) ... sleep(20)` -> `eventually(() => entered, (n) => n >= 1, { timeoutMs: 2000, stepMs: 20 }).catch(() => {})` (wait for the unnamed grok add to be inside its live check).

Each old loop was `for (i < 100) ... await sleep(20)` (100 x 20ms = 2000ms), so the budget/step are
byte-equal; each predicate is the old `!cond` un-negated (`entered < 2` -> `n >= 2`, `entered < 1`
-> `n >= 1`). The require was added after `const { start, server } = require('./server');`.

## Liu m5247 care point 2 (the non-vacuous proof)

Each migrated wait is IMMEDIATELY followed by its CONTROL assert:
- L215 -> `assert.equal(entered, 2, 'CONTROL: both requests must be inside the live check at once, or this proves nothing');`
- L311 -> `assert.equal(entered, 1, 'CONTROL: the unnamed add must be inside its live check');`

So the swallowed timeout is NOT vacuous: if the gate never reaches 2 (or 1), `eventually` times out,
`.catch` swallows, and the CONTROL assert on the very next line FAILS. The non-throwing `.catch`
swallow is therefore correct (no need to keep the wait throwing): the assert is the check, exactly
as the old non-throwing loop left it.

## No asserted time budget around these polls

Neither poll sits inside a `const at = Date.now(); ...; assert(took < X)` window (the
budget-internal-wait flag I sent Liu, accepted m5247: none of the three remaining files has a
migratable wait inside an asserted budget). These are setup gates feeding the CONTROL assert; after
each, the test releases the gate and inspects which slots the concurrent adds claimed. Scaling the
polls (up to 4x) changes no asserted value, confirmed by the scale-4 run below (23/23/0).

## Polarity audit (per Liu m5040) -- both positive, zero negative

Both wait for a counter to REACH a threshold (entered >= 2 / >= 1) and the following CONTROL assert
checks exactly that. Neither is wrapped in assert.rejects or catch-as-success; neither expects a
timeout. ZERO negative waits.

## Swallowed-throw note (honest)
The probe `() => entered` is a synchronous closure read of a test-local counter; it cannot throw.
A gate that never reaches the threshold does not throw either -- it times out, `.catch` swallows,
and the CONTROL assert on the next line fails. So `.catch` hides nothing.

## File-overlap
`server.provider-accounts-3296.test.js` has NO active sibling worktree touching it (the deferred
sibling files are cli.sandbox-4636, server.roomhold-idle-4624; orgchart-read-4559 skipped). Per
Liu m5247 the order is connections-4451 (done, #6128 merged), provider-accounts-3296 (this), then
remote-tick last.

## Validation (Mortals, node v26.8.1), run-before-trust via the full-claim queued-heavy lane
Box cleared after the 0.7.48 all-clear, so each leg ran uncontended under its own machine claim
(the light lane could not get a clean run during the freeze -- it refuses beside a release cut).
`unset KOSMOS_AGENT_TOKEN && node --test server.provider-accounts-3296.test.js`:
- baseline (origin/main content, pre-migration, via git stash): 23 tests, 23 pass, 0 fail, 0 cancelled, 0 not-ok, 0 timed-out.
- branch, scale 1: 23 / 23 / 0, 0 not-ok, 0 timed-out (identical count to baseline).
- branch, forced KOSMOS_TEST_TIME_SCALE=4: 23 / 23 / 0, 0 not-ok, 0 timed-out.
CI re-runs the whole suite on the head as the authoritative green-by-name gate.
