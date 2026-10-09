# enrollgate-5670: the board's company refresh waits for live execution (kosmos#5670)

## Finished looks like
`orgEnrollRefresh` (server.js) returns before anything is read or sent unless `liveExecution.liveExecutionAllowed()`, like the rollup tick (#5532). (Review 1: not every background send is gated on live execution. The feedback and community sends have their own under-test gate, and the federated-seat sweep has none; that is #5671.)

## Built
- server.js: the gate as the first statement of `orgEnrollRefresh`; the function is exported for its test (the file's pattern).
- server.orgenroll-5531.test.js: an enrolled fixture refreshes nothing without live execution, and refreshes with it (control). Removing the gate turns it red.

## Decided
- Measured on main: the real start path arms live execution before `start()` on every supported platform (darwin, win32, linux; engine/platform.js SUPPORTED). So the gate changes nothing in production. A pending Leave is still sent at the first refresh after start, and at each later one.
- Weakest premise: a future start path that calls `start()` before arming live execution would skip the at-start refresh, until the next daily pass or the two-minute follow-up. What would change it: such a path. The fix would be to arm first, as today.
- On a platform where live execution is never armed (platformGate.isSupported false), a pressed Leave would never be resent by the refresh. That cannot happen today: SUPPORTED is darwin, win32 and linux. The rollup is gated the same way, so no data flows there either.

## Review 2 (Sonnet) and what changed
- The enrolled arm now has its own positive control: the same fixture, with live execution on, refreshes.
- The start order this relies on is pinned: in the real start, `allowLiveExecution()` comes before `start()` (lines of code only, not comments). Moving the arming after `start()` turns it red.
- The code comment keeps only the why; the start-order fact lives here and in the pin.
- Plan file name: the PR hook requires `<branch>.md`, a known conflict with CLAUDE.md that lives in the org's shared setup.
