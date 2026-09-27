# doorflight-4066: the doorflight test waits for arrival, not a fixed 150 ms (kosmos#4066)

Card: kosmos#4066. `server.doorflight-1618.test.js` "two callers asking for the shelf at once verify each door ONCE" failed three times under a load average of 60 to 75, and passes alone.

## Cause (inferred from the code, not from a recorded failure value)

The test fired two requests, slept a fixed 150 ms, then asserted the held verifier had exactly one entry. The gate holds the first verifier call, so a shared second read adds nothing; the count can be 2 only on a real regression, and 0 whenever the first request has not reached the verifier within 150 ms. April's hits did not record the number, so "it read 0" is the weakest part of this.

The next test (`forget() observes its OWN write...`) had the same fixed 150 ms before `entries() >= 2`.

## Change (test only)

- `until(ready, what, ms)`: polls every 10 ms up to `ARRIVAL_MS` (10 s), failing with its own message.
- Test 1 counts `/api/connections` requests from the server's own `request` event and waits until both have ARRIVED, then waits for the first verifier entry, then keeps a 150 ms settle before asserting `=== 1`. Waiting on arrival rather than time means load cannot hide an unshared second read.
- Test 2 records the entries `connect()` itself made (it calls the verifier twice: `verify`, then its closing `state()`) and waits for one more. **Iteration 1 caught that my first version waited for `>= 2`, which setup already satisfied, so the read was never held and the test could not fail.**
- Test 2 bounds `forget()` by `ARRIVAL_MS`: if it shares the held read it used to hang the file; now it fails with its own message.
- Each `finally` releases the gate first, so a timeout cannot leave a fetch blocked.

## Controls (run, both arms, product restored after each)

- The file: 4 tests, 4 pass.
- A, sharing broken (`inflight.collapse` removed from `readConnectionsShelf` in `server.js`): test 1 red, "verified this door 2 times".
- B, arrival forced to fail with `ARRIVAL_MS = 0`: red, "no shelf read reached the verifier (waited 0 ms)".
- C, `state()` collapsed inside `engine/tokendoor.js` (the regression test 2 guards): test 2 red, "forget() waited on a shelf read that began before its write". Before the bound it hung instead.
