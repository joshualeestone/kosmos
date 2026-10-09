# enrollgate-5670: the board's company refresh waits for live execution (kosmos#5670)

## Finished looks like
`orgEnrollRefresh` (server.js) returns before anything is read or sent unless `liveExecution.liveExecutionAllowed()`, like the rollup tick (#5532) and the board's other background sends (repo convention 3).

## Built
- server.js: the gate as the first statement of `orgEnrollRefresh`; the function is exported for its test (the file's pattern).
- server.orgenroll-5531.test.js: an enrolled fixture refreshes nothing without live execution, and refreshes with it (control). Removing the gate turns it red.

## Decided
- Measured on main: the real start path arms live execution before `start()` on every supported platform (darwin, win32, linux; engine/platform.js SUPPORTED). So the gate changes nothing in production. A pending Leave is still sent at the first refresh after start, and at each later one.
- Weakest premise: a future start path that calls `start()` before arming live execution would skip the at-start refresh, until the next daily pass or the two-minute follow-up. What would change it: such a path. The fix would be to arm first, as today.
