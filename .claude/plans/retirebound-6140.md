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
  expect it to succeed (1955, 2376, 2500, 2677) and the three that expect a quick refusal or a 502 answer (2614, 2863,
  3058), whose message assertions a timeout would break the same way.
- Kept at 1500 ms: the hung-retire arm (#3827 "a half identity whose retire gets no answer is kept"), whose timeout is
  what it tests; its comment says so.

## Decided, not missed
- engine/remote.js is unchanged: a 60 s retire bound in production is right; the 1.5 s was a test speed choice.
- Cost: a hung retire in a raised arm now ends at 20 s instead of 1.5 s, only on a failing run.
- Weakest premise: that load is the only way the retire exceeds 1.5 s here. The fake tunnel's retire answers at once;
  nothing else in the test waits on it.

## Tests
- The squeeze reproduction above (1 ms reds at 1958; the raised bound passes).
- engine/remote.test.js in full, alone.
