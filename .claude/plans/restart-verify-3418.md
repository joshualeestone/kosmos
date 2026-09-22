# Plan: #3418: restart reports RESTARTED even when the relaunch silently failed

## What "finished" looks like
`remove.restartInner` returns `RESTARTED` only when the agent's launch job was
actually relaunched AND is loaded; otherwise it returns `PARTIAL` with an honest
message. So the class-1 auto-handler cannot log a false "handled", and the
upcoming "Restart Agent" button cannot tell a person an agent is back when it is
not. Verified by: a test where bootstrap fails → PARTIAL, a test where bootstrap
returns 0 but the job never loads (Nora's exact case) → PARTIAL, the existing
happy-path restart test still returns RESTARTED, and the full suite green.

## Root cause (Alexandra's #3418 forensics + code)
`restartInner` runs `step('asked it to start again now', () => { ops.stopNow;
return ops.startNow })` and then returns `RESTARTED` UNCONDITIONALLY, the
`startNow` result is discarded. Two failure modes both read as success:
1. `startNow` (launchd `bootstrap`) returns false (bootstrap errored), ignored.
2. `bootstrap` returns 0 but the job never actually loads, never checked. This
   is exactly what happened to Nora: her job was "registered on disk but never
   loaded"; `launchctl list | grep nora` showed nothing.

The comment justified this as "a nudge, not the mechanism, KeepAlive brings it
back on its own." That premise is FALSE for the bootout+bootstrap sequence:
`stopNow` is `bootout`, which UNLOADS the job, so there is no loaded job for
KeepAlive to revive. `bootstrap` is required, not a nudge. When it fails, the
agent is DOWN with nothing to restart it, and `RESTARTED` is a lie.

## The change (engine/remove.js)
1. Add a `loaded(name, record)` op to `jobOps` (both platforms):
   - mac: `launchctl print gui/<uid>/<label>` exits non-zero for a label launchd
     does not hold loaded, the exact "is it loaded?" question, distinct from
     `startableGone`'s "is the plist on disk?". Synchronous (bootstrap is
     synchronous), so no polling/race.
   - win32: `win32job.status(...).registered === true` (the registered-state
     confirmation; `win32job.start`'s own `.ok` already signals the /Run outcome).
2. In `restartInner`, capture the relaunch step's result and verify loaded:
   `const relaunched = step(...); const loaded = relaunched && ops.loaded(...)`.
   Record `loaded` as its own step. If `!loaded`: `disruption.clear(clean)` (as
   the failed-kill path does, so a down agent is not left marked restarting) and
   return `PARTIAL` with an honest "could not start it again, its job did not
   reload" message. Else `RESTARTED` as before.
3. Rewrite the misleading "nudge, not mechanism" comment to state the real
   mechanism (bootout unloads → bootstrap is required → verify it took).

## Why the `loaded` verify short-circuits on `!relaunched`
`relaunched && ops.loaded(...)`, a dead relaunch is not chased with a
`launchctl print`. Keeps the failed-bootstrap path (mode 1) from making a
pointless call and keeps the test for mode 1 free of a `print` call.

## Tests (engine/remove.test.js)
- Existing happy-path restart test updated: the launchctl call sequence is now
  `['bootout', 'bootstrap', 'print']` (the added load confirmation), and the
  stale "KeepAlive revives it regardless" comment corrected.
- NEW: bootstrap fails → PARTIAL, message says not running / did not reload, and
  does NOT claim "starting again"/"is back".
- NEW: bootstrap returns 0 but `print` shows not-loaded (Nora) → PARTIAL, with an
  assertion that the `print` load-check actually ran (non-vacuity guard).
- The `world()` mock defaults unknown commands to `{ok:true}`, so a successful
  restart's `print` returns loaded, the happy path is unaffected beyond the one
  added call.

## Weakest premise (name it)
That `launchctl print <label>` exits non-zero iff the job is not loaded. Measured
behavior on macOS launchd: `print` on an unloaded/absent label exits non-zero;
on a loaded one, zero. If a future launchd changed that, the verify would need a
different primitive (e.g. `launchctl list <label>`), but the startNow-result
check (mode 1) still stands regardless.

## Plist-gone during restart (a narrow TOCTOU, handled)
`startNow` short-circuits `return true` when the plist is missing (no bootstrap
attempted), which the new `loaded` check then correctly reports as not loaded →
PARTIAL (an improvement over the old false RESTARTED). Reachability: `jobFor`
(remove.js:559) filters candidates to those whose plist EXISTS, so a
persistently-gone plist makes `jobFor` return null and restart REFUSES with a
clear "not started by Kosmos" message, it never reaches this PARTIAL path. The
only way to hit plist-gone in `restartInner` is the plist vanishing BETWEEN the
`jobFor` check and `startNow` (a TOCTOU race). For that race the generic "needs
another restart" advice is not actionable (a retry keeps no-opping), so the PARTIAL
message distinguishes it via `ops.startableGone` and says the launch file is gone
and has to be created again. Not unit-tested (simulating the race requires mocking
`fs` mid-call); documented here per the challenge review, with the actionable
message covering it.

## Out of scope
- The trust-prompt fix (#3417), separate PR (#3425).
- **A genuine win32 running-state verify** (follow-up). The mac `loaded` op is the real
  hardening (`launchctl print` confirms the loaded state that bootstrap's exit code does
  not). The win32 `loaded` returns `win32job.status().registered`, which confirms the task
  EXISTS, not that its process is running, win32job exposes no running state, so it cannot
  catch the win32 analog of Nora (a `/Run` that reports ok but whose process never comes up).
  win32 still relies on `win32job.start().ok` (the `relaunched` result), unchanged from before
  this fix. The incident was mac-only; a win32 running-state probe is its own card.
- A time-bounded verify that the tmux SESSION (not just the job) reappears a few
  seconds later. The job-loaded check catches Nora's exact symptom synchronously
  and without a race; a session-existence poll adds supervisor-startup latency and
  flakiness for a marginal additional guarantee. Noted as a possible follow-up.
