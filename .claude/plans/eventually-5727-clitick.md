# Plan: eventually-5727-clitick (#5727 follow-up 1, Group-A cli.* tick waiters)

## Scope
Six root `cli.*.test.js` files, each with one COUNT-based for-tick waiter of the identical shape
`for (let i = 0; i < 100 && <not-yet>; i += 1) { await sleep(50); }` inside a helper
(`send`/`drive`/`report`/`react`/`reply`). The loop waits for a stub to record the CLI's request
(`seen`/`seen[which]` grows), then a post-loop assertion judges what landed. Files:
`cli.agent-token-verbs-4491`, `cli.presents-board-token-1968`, `cli.presents-token`,
`cli.react-2255`, `cli.reply-token-3769`, `cli.token-off-argv-1970`.

This is the first Group-A batch under the precedent Liu accepted on #6069 (m5040): a COUNT-based
helper may migrate to the wall-clock `eventually()` because every call site is positive and the
budget is bounded.

## Change
Each loop becomes `await eventually(probe, (v) => v, { timeoutMs: 5000, stepMs: 50 }).catch(() => {})`,
plus one `const { eventually } = require('./test-support/eventually');` (root path). The probe is the
negation of the old loop guard (continue-while -> stop-when):
- `seen.length === before`        -> `() => seen.length !== before`
- `seen[which].length === before` -> `() => seen[which].length !== before`
- `seen.length === 0`             -> `() => seen.length !== 0`
timeoutMs 5000 = the old 100 iterations x 50ms; stepMs 50 preserved.

## Why the `.catch(() => {})` swallow (unlike the remote.test.js batch)
The old for-tick loops do NOT throw: they exit silently after 100 ticks and let the FOLLOWING
assertion (`assert.equal(seen.length, before + 1, ...)`, or the caller's assertion for `react`) be
the failure check. `eventually` throws on timeout, so swallowing its rejection preserves that exact
no-throw behaviour: on success the wait returns early (request landed); on a genuine timeout the
assertion below fires with its own specific message, exactly as before. This is the batch-3
hookwiring precedent for a non-throwing loop. (remote.test.js's `until` DID throw via `assert.fail`,
so that batch did not swallow; these differ.)

## Equivalence: count -> wall-clock, same accepted precedent
Same as #6069's `until`: the old loop was COUNT-based (100 iterations), so its real duration
stretched with per-iteration lag (accidentally load-adaptive, unbounded); `eventually` makes the
deadline explicit and bounded by KOSMOS_TEST_TIME_SCALE (runner-computed, capped 4x). At scale 1 on
an unloaded box the real durations match (~5000ms); under the runner the scaled budget tracks load;
stricter than the old count loop only under a bare `node --test` scale-1 on a loaded box (the
targeted scenario). Both probe at t=0 (the old loop checks its guard before the first sleep), so no
cadence shift; 50ms step preserved.

## Polarity audit (per Liu m5040) -- every call site POSITIVE, zero negative
Each helper waits for the stub to record the request (`seen`/`seen[which]` grows), then the test
asserts on what was recorded; the stub records an entry for every request that reaches the route
(the entry's token field is what the token-drop cases check, so `seen` grows even for a dropped
token). None of the six expects the wait to time out, none is wrapped in `assert.rejects` or a
catch-as-success. `cli.presents-token`'s own comment says it best: "Polling for the count makes the
test assert delivery rather than process exit." So no call site is kept hand-rolled; if a future
negative use is added to any of these helpers it must keep its own loop (Liu's standing rule).

## counts-before-and-after
Before: 6 count-based for-tick loops, 0 `eventually` require. After: 6 `eventually().catch()` calls,
6 `eventually` requires; no test added or removed, so the per-file test counts are unchanged by
construction and the proof verifies the same totals pass before and after at scale 1.

## What "done" looks like
- All six files pass at scale 1 (identical totals to the stash baseline) and at a forced scale;
  whole suite green by name on CI; Sonya or Liu reviews.

## Weakest part (named)
1. The swallow changes nothing on the success path and keeps the same RED on the failure path (the
   assertion), just reached after the scaled budget instead of the fixed 5000ms. The only behavioural
   shift is the count->wall-clock one Liu already accepted, bounded by the scale.
2. The equivalence rests on all six being positive. I audited each helper and its caller; the blind
   pass re-audits. A missed negative use would be made stricter by eventually's extra probe, but
   these helpers are delivery-waiters with a post-wait assertion, never timeout-expecters.
