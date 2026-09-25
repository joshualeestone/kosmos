# cpu-guards-3715: the backtracking guards bound CPU time, not wall time

Card: kosmos#3715, the follow-up to #3710 (Ice Cream Kitty, scrub-cpu-3710, open).

## What
- `test-support/cpu-time.js`: `cpuMillisecondsOf(fn)`, user + system from `process.cpuUsage()`, in milliseconds.
  The same name and arithmetic as the in-file helper on #3710's branch, so feedbacksend can move to it later.
- The ten guards the card lists now measure CPU time with it, with their bounds unchanged: feedguard (4),
  store-indent-3679 (3), web.list-depth-3679 (1), web.quoteb (2).
- `test-support.cpu-time.test.js`: a units control (a 40ms spin reads between 1 and 3000) and a kind control
  (200ms asleep reads under 100, while the wall clock shows the sleep happened).

## Not changed
`test-support.board-child.test.js` times how long we wait on a child process, which is genuinely wall time
(the card says so). `engine/feedbacksend.test.js` is #3710's, still open; not touched here, so the two branches
do not collide. Pointing it at the shared helper is a two-line follow-up once both are merged (Kitty agreed,
and asked me to do it).
Three other linear-time guards stay on wall time because this helper cannot measure them:
`cli.post-stdin-2909.test.js` (two) times a child process (`runCli`), whose CPU is not this process's, and
`tools.windows-kosmos-cli-570.test.js` wraps an async `run`. The helper refuses async work.

## Measured
- The four files plus the helper test: 113 pass.
- Mutation, the helper returning 1e9: all ten guards and both helper tests red (12).
- A real plant: `trimSpacesEnd` replaced with the quadratic `/ +$/` trim. The store-indent guard still
  trips on CPU time: 27,201ms against its 3,000ms bound.

## Weakest premise
CPU time leaves out time spent waiting to be scheduled, so a loaded machine inflates it far less than wall
time, and a guard is laxer than before under load. It can exceed wall time through other threads in the process
(GC), which only makes a guard stricter. A real backtracking regression is far over the bound (the planted one,
9x), so it still trips.
Only one guard was checked with a real plant (store-indent); the other nine are shown to read the helper
by the mutation, not by planting a backtracking pattern in each.
