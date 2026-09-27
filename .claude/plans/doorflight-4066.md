# doorflight-4066: the doorflight test waits for arrival, not a fixed 150 ms (kosmos#4066)

Card: kosmos#4066. `server.doorflight-1618.test.js` "two callers asking for the shelf at once verify each door ONCE" failed three times under a load average of 60 to 75, and passes alone.

## Cause (inferred from the code, not from a recorded failure value)

The test fired two requests, slept a fixed 150 ms, then asserted the held verifier had exactly one entry. The gate holds the first verifier call, so a shared second read adds nothing; the count can be 2 only on a real regression, and 0 whenever the first request has not reached the verifier within 150 ms. April's hits did not record the number, so "it read 0" is the weakest part of this.

The next test (`forget() observes its OWN write...`) had the same fixed 150 ms before `entries() >= 2`.

## Change (test only)

- `until(ready, what, ms)`: polls every 10 ms up to `ARRIVAL_MS` (10 s), failing with its own message.
- Test 1 waits for the first entry, then keeps the 150 ms settle so an unshared second read still shows as 2. Load can only make that less sensitive, never fail it falsely.
- Test 2 waits for `entries() >= 2` instead of the fixed sleep.

## Controls (run, both arms)

- The file: 4 tests, 4 pass.
- Sharing broken in `server.js` (`inflight.collapse` removed from `readConnectionsShelf`): test 1 red, "verified this door 2 times". Restored.
- `ARRIVAL_MS = 0` with the ready condition forced false: red, "no shelf read reached the verifier (waited 0 ms)". Restored.
