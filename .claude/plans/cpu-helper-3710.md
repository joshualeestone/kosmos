# cpu-helper-3710: feedbacksend.test.js uses the shared CPU-time helper

Follow-up to #3710 / #3715 (owed to Ice Cream Kitty, who asked for it). #3715 added
`test-support/cpu-time.js` and moved five backtracking guards onto it; `engine/feedbacksend.test.js`
kept its own private copy of `cpuMillisecondsOf` and a units control for that copy.

## What
- `engine/feedbacksend.test.js` requires `cpuMillisecondsOf` from `../test-support/cpu-time`.
- The private copy, its units control test and the control's band constants are removed. The helper's
  own test (`test-support.cpu-time.test.js`, run by the root `*.test.js` glob) checks milliseconds,
  CPU-not-wall, and refuses an async function.

## Decided
- Delete the local control instead of keeping a second copy: it tested the private function, which no
  longer exists, and two controls of one helper drift. The bound (`SCRUB_CPU_BOUND_MS`, 3000) is unchanged.

## Weakest premise
- The shared helper throws on an async function; both scrub calls are synchronous, so this changes nothing
  today.

## Verification
- `engine/feedbacksend.test.js` + `test-support.cpu-time.test.js`: 55/55 pass.
- Mutation: the shared helper made to throw turns both scrub timing tests RED, so the file really uses it.
