# keepflake-6529: the keep-call bound test is deterministic

Card: kosmos#6529 (flaky on #6499 and #6526, both unrelated PRs).

## Finished looks like
`engine/kosmos-report-hook.keepcopy-5812.test.js` cannot fail because real time passed during the run, and a test
in the same file fails if that guarantee is ever removed.

## Cause (measured)
`main` checks the board before the keep call (`proven`), times that check with `Date.now()`, and gives the keep call
what is left of 3000 ms. The test mocked only `setTimeout`, so the real clock still ran. When the check's single async
hop crossed a millisecond (a loaded CI runner, or a GC pause), the keep call's timer was set to 2999 ms or less, and
the mocked `tick(2999)` had already given it up: "still waiting at 2999 ms".

## Change (test only; the hook is unchanged)
- The test body becomes `boundIs3s(t, { slowCheckMs })`, with `t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })`.
- The original test calls it as before.
- A new arm passes a `proveBoard` that spends 15 ms of real time inside the timed window: the flake made certain.

## Rejected
- Giving the hook a clock option: a product change to fix a test, and `Date` mocking already exists for this.
- Loosening the assertion to 2990 ms: it would hide a real shrink of the bound.

## Weakest premise
That `performance.now()` is not mocked by the `Date` api (the busy-wait would never end). Measured: the arm finishes
in about 16 ms on Node 26, the version CI pins.

## Verify
- Control: the same file with only `setTimeout` mocked fails the new arm with "still waiting at 2999 ms", the CI message.
- With the fix: the file passes 50 runs out of 50.
