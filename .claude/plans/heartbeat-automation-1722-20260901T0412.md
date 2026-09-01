# Plan: Settings > Automation, product heartbeat with correct working/stopped detection (kosmos#1722)

Written at ctx 95% as the build spec, so a post-compaction me (or a restart) builds
from this rather than re-deriving. Card #1722, claimed by Baron Draxum. Companions:
#1723 (recommender, research-first), #1724 (Mona took instead), both claimed.

## The corrected scope (Splinter 2026-08-31 23:05 -- do NOT build the original bullet)

Josh (22:37): a Settings control to turn the heartbeat on/off and make its interval
adjustable. The heartbeat "checks which agents are working and prompts to chase anyone
stopped."

🛑 It is a PRODUCT feature over the USER's own agents, NOT a control over the dev-fleet
job. Hard constraints:
- MUST NOT read or write `~/.claude/bin`, our launchd jobs, or any dev-fleet infra.
- Do NOT test against the live fleet heartbeat (`com.stonesyndicate.builder-progress`,
  StartInterval 1020) -- it is keeping the overnight run moving; touching it is a live hazard.
- The fleet job is the REFERENCE implementation, not the thing Settings controls.

## Three parts, in build order (Mona Lisa's ordering: detection is the expensive half)

### 1. Agent working/stopped DETECTION (the hard, historically-buggy half) -- BUILD FIRST

Port the two-arm UNION design from the reference `~/.claude/bin/builder-progress-check.sh`
into the product (agent-workforce). An agent is WORKING if EITHER arm fires; STOPPED only
if NEITHER does (bias toward working: a false stop is a harmless nudge; a genuinely stopped
agent fires neither and is caught).

- Arm A -- SPINNER regex on the pane capture. The live Claude spinner carries an elapsed
  timer AND a streaming token count (e.g. `(12s · 1.2k tokens)` and a LONGER variant).
  🛑 Match the elapsed-timer/spinner form ONLY. Do NOT use `ctx [0-9]+%.*active` -- that
  matched the IDLE status footer `... ctx 83%        /rc active` and scored stopped agents
  as working (3 of 6 panes, the fleet bug). 🛑 Do NOT anchor on `tokens)` -- the spinner has
  a longer variant; the anchored form false-passed a 12-pane control as 3/9.
- Arm B -- short PANE DELTA. Capture the pane, wait ~6s, capture again; changed => working.
  (Use `-e` capture per the ghost-text bulletin if reading status content; a busy composer /
  wrapped line can false-read, so key on a short distinctive token, not a phrase.)
- REJECT the file-mtime arm: it read 0 for all known-working panes and would report the
  whole fleet idle.
- VALIDATE like the reference: against known-truth agent states, with a negative control
  (a pane that cannot exist -> stopped) and a positive control (a synthetic working pane ->
  working). This validation is the whole point of the card -- a toggle over a detector that
  cannot tell working from stopped is a control for a lie.

Where in the product: the product tracks the user's agents (server.js; panes via tmux).
The detection reads the user's agent panes ONLY -- never the dev-fleet panes. Find how the
product enumerates the user's agents/panes (server.js agent registry + AGENT_WORKFORCE_TMUX_BIN
seam used by tests, e.g. test-support/fake-tmux.sh) and detect over THAT set.

### 2. Periodic check-and-notify in the PRODUCT (does not exist today)

`HEARTBEAT_MS` (engine/connect.js:286, 5 min) is LIVENESS (a record stamped while alive),
NOT a periodic check-and-notify. Build the new periodic job: on an interval, run the
detection over the user's agents and notify about anyone stopped. It lives in the product's
own runtime (the board/server), configurable, and installs/controls its OWN schedule -- NOT
a `~/.claude` launchd job. Confirm how the product already schedules periodic work (poll
loops in server.js / the board) and follow that, machine-scoped (interval belongs to the
machine, not a project).

### 3. Settings > Automation UI (the small part)

web/index.html Settings (`#pj-settings-view`, the Settings list ~line 407). New "Automation"
section, first control the heartbeat:
- On/off toggle, distinct from the interval.
- Interval selector: Off / 5 min / 10 min / 17 min (current default) / 60 min.
- Show the interval actually IN FORCE, read from the live product job, not the stored pref,
  so a failed write is visible rather than silent.

## Testing (must not touch the live fleet heartbeat)

- Unit-test the detector with SYNTHETIC pane captures: a spinner string -> working; the idle
  `/rc active` footer -> stopped (the exact regression); a pane delta -> working; a static
  pane -> stopped. Negative/positive controls. This is red-capable for the historical bug.
- Test the Settings row drives the product interval and displays the LIVE value.
- NEVER read/spawn the real dev-fleet job or panes.

## Status / next actions for a post-compaction me

- Worktree: ~/work/agent-workforce-heartbeat-automation-1722 (branch heartbeat-automation-1722).
- Claimed on the card. Handoff at ~/.cache/claude-handoffs/BaronDraxum-2026-08-31-night.md.
- START with part 1 (detection) + its synthetic-pane test. Then part 2, then part 3.
- Run the FULL `yarn test` before any merge (a UI/detection change can break pinned tests).
- Challenge-loop + proof + PR. This is a product feature (not high-blast-radius infra), so it
  can merge on the Kosmos beta norm once green -- but confirm with Splinter given its size.

## INTEGRATION POINT (found 23:14, before compaction) -- start the detector HERE

The product ALREADY enumerates the user's agents and reads their pane content:
- `safeRoster()` in server.js (~4866, 5005) = one `list-panes` + a `capture-pane` PER agent.
- `snapshot()` (server.js ~6582) fans out a real tmux `capture-pane` over the roster.
- Tests drive pane content via the `AGENT_WORKFORCE_FAKE_PANES` / `test-support/fake-tmux.sh`
  seam (see server.connections-refresh-1649.test.js:71, server.projects.test.js:1025), and
  `AGENT_WORKFORCE_FAKE_SCREEN` for a pane's screen. This is the synthetic-pane seam for the
  detector's unit tests -- NO real tmux, NO dev-fleet panes.

⇒ The detector does NOT build pane-reading. It is a pure classifier over a pane capture
string, applied to what safeRoster/snapshot already capture:
- `detectWorking(paneText)` -- Arm A: the spinner regex (elapsed timer + token count form
  ONLY; must NOT match `... /rc active` idle footer; must NOT anchor on `tokens)`).
- Arm B (pane delta) needs TWO captures ~6s apart, so it lives in the periodic job (part 2),
  not the pure classifier: capture, wait, capture, changed => working. The classifier (Arm A)
  is pure and unit-testable now.

NEXT CONCRETE STEP for a post-compaction me:
1. Write the pure `detectWorking(paneText)` (Arm A spinner regex) as a small module, with a
   unit test: a spinner string -> working; the `barondraxum · Opus 4.8 · ctx 83%   /rc active`
   idle footer -> stopped (the exact regression, red-capable); a plain prompt -> stopped.
2. Then the periodic job (part 2) composes Arm A over the roster + Arm B (the 6s delta) and
   notifies about stopped agents, on the configurable interval, machine-scoped, in the
   product runtime -- NOT ~/.claude, NOT launchd of the dev fleet.
3. Then Settings > Automation (part 3).
