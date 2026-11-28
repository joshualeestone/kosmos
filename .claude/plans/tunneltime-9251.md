# tunneltime-9251 (kosmos#9251)

**Problem.** server.phonenotify-718's "a hung tunnel times out" test failed under load on Mortals: "a timed-out turn-on left later turn-ons stuck", 400 !== 200. The file alone is 52/52. The 500 ms request limit set for the hung half stayed set for the second "not stuck" call, so a healthy but slow tunnel timed out too.

**Change.** The limit is deleted before the second call (Baron's suggested fix). That call now goes to a healthy fake tunnel that answers no sooner than 700 ms after its gate timer is set, so the "not stuck" check runs against a slow tunnel every time, not only when the box is busy.

**Measured.**
- With a 700 ms healthy fake, the old test reds as on Mortals.
- Fixed: 52/52 three times.
- Still red with the limit carried over.
- Still red with a mutant whose turnOn never clears the in-flight turn-on (the real "stuck").

**Weakest premise.** A box slow beyond the normal 20 s limit could still give a 400. That is far beyond the measured load.
