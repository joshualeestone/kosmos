# retirebound-6140: #5422 'finishing an unfinished earlier sign-in keeps the device key' reds under load

Card: kosmos#6140. Test-only change: engine/remote.test.js.

## Cause (measured, not only reasoned)
- The test sets AGENT_WORKFORCE_RETIRE_TIMEOUT_MS=1500 before the register it expects to succeed. engine/remote.js
  bounds the retire of the half identity by it (retireHere -> setupRun(..., retireTimeoutMs())). A retire that does not
  answer in time is transient (RETIRE_TRANSIENT matches "did not answer in time"), so clearHalfIdentity KEEPS the half
  identity and signinRegister answers ok:false (KEPT_HALF): exactly the card's red at line 1958.
- Reproduced: with the bound squeezed to 1 ms the test fails at remote.test.js:1958 with `actual: false`, the card's
  reading. At 50 ms it passes, so the fake retire takes between 1 and 50 ms alone; on a box at load 3.4 the spawn of the
  tunnel program can exceed 1.5 s.

## Change
- The retire bound is raised to 20000 ms (the register's) in every arm where the retire must ANSWER: the four that
  expect it to succeed (#5422 finishing an unfinished sign-in; #3827 Forget retires a half register; #3827 a register
  after one cut off; #3827 the Settings setup retires first) and the three that expect a quick refusal or a 502 answer
  (#3827 "already in use" after a refused retire; the Settings setup's stranded-name answer; the Settings setup keeps a
  half identity whose retire got a 502), whose assertions on a refusal a timeout would break. A timed-out retire is kept, not refused; in "already in use" that
  breaks the refusedThenFree, retired and retry checks (the stranded wording alone would still match).
- Kept at 1500 ms: the hung retire in #3827 "a half identity whose retire gets no answer is kept", whose timeout is
  what it tests. The retry after it must answer, so it gets 20000 ms (review 1).
- #4824's CONTROL (a refusal that is not a timeout, under the arm's 400 ms bound) gets 20000 ms for its refusal
  (review 1): on a loaded box the refusal would become the timeout the first half tests, which removeAnswer reads as
  removed.

## Review 3 (opus)
- Each kill step (ten, in the arms above and the slow-retire arm) now asserts it left a half identity (key and id, no
  certificate): the kill shares the load problem one step earlier, and a kill landing before the fake writes them made
  a later precondition red with the wrong cause. The stranded-name arm's second half sets its retire bound itself.

## Review 5 (opus)
- The kill steps themselves were still bounded at 1.5 s: the fake must start, read the token and write key and id
  before the kill, so a loaded box could still red there (now named by halfHere()). KILL_BOUND_MS = 5000 for the ten
  kills: the fake hangs 15 s after the write, so a 5 s kill still lands after it. Cost: about 3.5 s per kill on every
  run.

## Decided, not missed
- engine/remote.js is unchanged: a 60 s retire bound in production is right; the 1.5 s was a test speed choice.
- Cost: a hung retire in a raised arm now ends at 20 s instead of 1.5 s, only on a failing run.
- Weakest premise: that load is the only way the retire exceeds 1.5 s here. The fake tunnel's retire answers at once;
  nothing else in the test waits on it.

## Note
- A filtered run (`--test-name-pattern='4824|3827|5422'`) reds '#3827 an in-app sign-in from a switched-off computer'
  at remote.test.js:1645 on origin/main too (measured): an ordering dependence of filtered runs, not this change. The
  whole file passes.

## Tests
- The squeeze reproduction above (1 ms reds at 1958; the raised bound passes).
- engine/remote.test.js in full, alone.
