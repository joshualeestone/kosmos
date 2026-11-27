# kosmos#8720 (remaining ask): retire agents idle for N days, opt-in, off by default

Routed by Splinter 11-27 12:08 (card comment "Splitting the rest out"). Homer finished the Windows asks on 11-18.
Design decided on the card (comment 7225269552).

## Measured on main (11-27)
- Remove: engine/remove.js remove(name) / restore(name). Nothing on disk is deleted; a record goes in removed.json; the
  job is disabled and the session stopped per platform (launchctl/tmux, systemctl/tmux, schtasks/taskkill). PARTIAL
  when a stop fails. Put back from GET /api/removed + POST /api/agent/:name/restore. So retiring through remove() is
  reversible on all three platforms with no new platform code.
- Last ran: engine/liveness.js, beaten by every authenticated POST /api/report (Claude hooks on all three platforms,
  the Codex/Gemini/Grok/Antigravity bridges, Muse). read() has three answers; forget() runs at remove, create and
  delete-leftover, so a restored or recreated agent has NO record until it reports.
- #5957 slice 3 already says "Has not run in N days" on a stopped agent at 14 days and removes nothing (that slice's
  scope call, in its own plan; not a ruling).
- Settings pattern: engine/recommender-setting.js (off by default, store.ROOT file, never throws).
- Daily sweep pattern: server.js feedbacknudge (10-minute tick, once a day kept on disk, inert under node --test and
  before live execution).
- No person-facing notice channel exists for a background job; the retirements are kept on disk and shown in the same
  Settings section, and each also appears in Removed agents.

## Shape
- engine/idleretire.js: the setting ({ on: false, days: 30 }, days one of 14/30/60/90) in <ROOT>/idleretire.json,
  assess(rows, readers, now) -> one verdict per agent, and makeTick(deps) for the daily sweep, with its own record
  (<ROOT>/idleretire-log.json: the last day it ran, the last 50 retirements).
- Verdicts: retire (measured idle >= days, nothing protecting it); keep (with the reason); unknown (no liveness record).
- Protected, listed with the reason, never retired: the setup guide (row.isGuide); latest self-report needs_you or
  blocked; an open task with it as who; a member of a project that is not archived.
- Routes: GET /api/idle-retire (setting + verdicts + recent retirements), PUT /api/idle-retire (on, days).
- Settings: a section with the switch, the days, and the lists.

## Changed from the card's design (decided while building)
- Second source dropped: I wrote that message and chat dates would back up liveness. Both are written during a turn,
  and every turn reports, so they cannot be newer than liveness unless the hook is broken, which is the weakest
  premise itself. Reading messages.jsonl daily would cost a full scan for no measured gain.

## Tests
- assess: each verdict and each protection, with a control for each that removes the protection and sees retire.
- unknown is never retired; a restored agent (no record) is never retired.
- makeTick: off does nothing; on retires once a day (a second tick the same day does nothing); a REFUSED or PARTIAL
  remove is recorded as such, not as retired; inert when not allowed.
- setting: off by default, corrupt file reads off, days outside the set refused.

## Decided during review (2026-11-27)
- **PUT /api/idle-retire keeps the advisory isViaScreen gate, accepted knowingly.** Two blind reviewers flagged that a
  local process forging a browser header can arm it. Kept because: it is the gate on every Settings switch, and a
  no-token caller with the same header can already DELETE /api/agent/<name> directly, so this opens no path that does
  not exist; an agent's own token is refused; the switch is off by default and every retirement is reversible
  (Restore). What would change it: a person-only proof landing for the Remove route itself, then use it here too.
- **Idle counts running days**, not calendar days (review 1): the board writes liveness on a report, so a closed board
  cannot beat. A board that has just upgraded has no running days yet, so nobody is retired for N days after the
  upgrade. Accepted as the safe direction.
- **The guide is marked with isSetupGuide** (review 2): safeRoster rows carry no isGuide; markGuide marks only
  /api/status's copies. Covered by a route test through a real roster row, perturbed red.
- **At most 3 removals per hourly tick**, each name tried once a day (review 1): remove() is synchronous.
