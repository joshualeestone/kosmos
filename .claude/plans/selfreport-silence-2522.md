# selfreport-silence-2522 -- detect when the fleet's self-report path goes silent

## Card
kosmos#2522 (follow-up to #2509). #2509 was a fleet-wide self-report + liveness outage that ran
~5 days UNDETECTED because nothing alarms when reports stop arriving. This builds the missing
detector (option b, standalone - confirmed non-colliding by PigeonPete + Splinter; the board-side
liveness-beat decoupling is option a, Pete's separate future lane).

## Design

Modelled on the existing monitors (`~/.local/libexec/kosmos-relay/coordinator-monitor.sh`, whose
source is `kosmos-relay:deploy/`): a scheduled check that REPORTS AND NEVER ACTS, posts to a durable
watched tracking issue when unhealthy, keeps the healthy path SILENT, and emits a periodic heartbeat
so a dead alert channel's own silence is a signal. Two properties carried over deliberately:
- **Report, never act.** There is no safe automatic remedy for a self-report outage (the #2509 fix
  was a board.token mirror + a restart, both judgement calls). The monitor shouts; a human fixes.
- **A `MONITOR_GH_CMD` / injected-clock seam**, because a PATH-based `gh` stub cannot test a monitor
  that re-exports PATH, and the alert branch is otherwise never exercised (coordinator-monitor.sh's
  own lesson: its alert branches were never tested because testing meant posting to the real issue).

### Placement: agent-workforce, NOT kosmos-relay (my call, overridable)
The existing monitors live in kosmos-relay. This one lives in agent-workforce anyway, because the
thing it watches - the selfreport store - is defined HERE (`engine/store.js` `root()`, the ONE
data-root derivation, #1848/#1856; `engine/selfreport.js` `DIR`). A relay-repo monitor hardcoding
`~/Library/Application Support/Kosmos/selfreports` would be a SECOND thing that breaks on the next
store rename - exactly the #2439 rename that CAUSED #2509. Living here, it reuses `store.root()` and
survives renames automatically. Splinter/Josh can move it to kosmos-relay if the co-located-with-
siblings tradeoff is preferred; the store-rename fragility is why I did not.

### The verdict is a PURE function (the testable core)
`engine/selfreport-freshness.js` exports `freshnessVerdict({ dir, nowMs, agentsRunning, staleAfterMs })`:
- reads the newest `at` across `dir`/*.jsonl (last non-blank line of each file; robust to a partial
  final line),
- returns `{ newestAtMs, ageMs, agentsRunning, stale }` where `stale === true` ONLY when
  `agentsRunning > 0` AND `ageMs > staleAfterMs` (and a `reason` when not stale: 'no-agents-running'
  / 'fresh' / 'no-reports-ever').
- Pure: no clock, no fs-walk baked into the decision; the caller injects `nowMs`, `agentsRunning`,
  and the `dir`. This is what the test drives.

### The false-alarm gate, and the threshold
`stale` requires `agentsRunning > 0`: a genuinely empty or stopped fleet writes no reports and MUST
NOT alarm (that is the expected state on a fresh install or overnight). Threshold default 45 min:
the historical store holds ~230 reports/hour fleet-wide (55k over ~10 days x 18 agents), so a
45-minute fleet-wide gap WITH agents running is wildly anomalous - orders of magnitude of margin, so
false alarms are near-impossible while a real outage (like #2509's 5 days) cannot hide past one
15-minute sample. Env-overridable (`SELFREPORT_STALE_MINUTES`).

### The loud half
- `tools/selfreport-silence-monitor.js` - resolves `dir` via the pure `store.dataRootFor`, resolves
  `agentsRunning` by filtering the process table (`ps -axo comm=`) through `isAgentCommand` - the
  CANONICAL rule (legacy `claude`/`claude.exe` OR a native version-string semver shape, issue #252;
  NOT bare `node`), because a bare `pgrep claude` reads 0 on the native-installer fleet and would
  suppress the alarm forever; seams `MONITOR_AGENT_COUNT` / `MONITOR_AGENT_COUNT_CMD`. Calls
  `freshnessVerdict`, and on `stale` posts
  to the tracking issue via `MONITOR_GH_CMD` (default `gh`); heartbeat every N days so a dead
  channel's own silence is a signal; healthy path silent; NEVER acts. A `--check` mode prints the
  verdict JSON and exits 0/1 without posting - manual/CI/test use.

### Wiring is a DEPLOY step (learned from the convention, not a committed plist)
I do NOT ship a plist. agent-workforce's launchd jobs are created by the INSTALLER (`install/setup.sh`),
and `deploy/install-board.sh` only REPOINTS an existing plist - there is no committed-plist or
standalone-generator convention here. Adding a new scheduled launchd job is therefore an installer
change that touches every fresh install: deploy-owned (Angel/Mona/Splinter), not mine. The PR ships
the tested MECHANISM; running it on a schedule is the deploy step. Recommended wiring, for whoever
does it: a LaunchAgent `com.kosmos.selfreport-silence-monitor`, ProgramArguments
`[/opt/homebrew/bin/node, <repo>/tools/selfreport-silence-monitor.js]`, `StartInterval 900`,
RunAtLoad true, logs under `~/Library/Logs/kosmos/` - the exact shape of the board + coordinator-monitor
jobs. #2522 stays OPEN until it is wired and observed alarming (mechanism built != behaviour measured).

## Weakest premises (named)
- **The "agents running" count is a proxy for "agents that SHOULD be reporting".** A running agent
  that legitimately has nothing to report for 45 min is possible but fleet-wide-implausible given the
  historical rate; the generous threshold absorbs it. If it ever false-alarms, raise the threshold,
  do not remove the gate (removing the gate re-introduces empty-fleet false alarms).
- **The monitor reuses the report store's freshness, not liveness.** Liveness froze WITH selfreports
  in #2509 (they share the report handler - see also (a), Pete's decoupling card), so it is not an
  independent clock yet; selfreport freshness is the signal available today. If (a) lands, a decoupled
  liveness beat is a better clock and this monitor can switch to it.
- Sampling (15 min) misses a sub-15-min blip, by design - the same trade coordinator-monitor.sh makes.

## Verification
`engine/selfreport-freshness.test.js`: fresh -> not stale; stale+agents -> stale; stale+NO agents ->
not stale (the false-alarm control); no-reports-ever -> not stale unless agents running; a partial
final line does not throw; the boundary at exactly staleAfterMs. The gh-post loud half is thin glue
over the tested verdict; its gh call uses the seam so a test can assert "posts on stale, silent on fresh"
without touching a real issue.
