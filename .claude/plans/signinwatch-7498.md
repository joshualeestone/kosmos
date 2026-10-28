# #7498: turning on Start Kosmos when I sign in registers the crash-recovery watchdog

## Problem

On Windows the watchdog task (`Kosmos\board-watchdog`, #2988) is registered only at a boot that registered or
refreshed an ENABLED board task (`withWatchdog`). A person who turns the Settings switch on after a boot that left
it off, or after a boot whose watchdog `/Create` ran out of time, has nothing to restart a board that stops until
the next boot.

## Change (engine and route; the screen half is #7504)

- `engine/win32board.js`: `ensureWatchdog(opts)`, called from `setStartAtSignIn(true)` after the read-back says on,
  and on the already-on path (a repeat "on" heals a missing watchdog).
  - Present (its own query answers, or the label-free task list names it): left as it is, `action: 'present'`.
  - Missing (English not-found words, or known absent from the task list on any language): registered with a
    boot's spec (the anchor folder's `node.exe` and shim folder, the bundle as working folder, `machineEnv`),
    `action: 'registered'`.
  - Unreadable: nothing is created blind (#2973), and the answer says why.
  - No anchoring from a Settings request: anchoring rewrites the fleet pointer and boot shim and is the boot's job.
    No `node.exe` at the anchor yet means "registered the next time Kosmos starts".
  - Time: one schtasks budget for every call here (query, list, create), never past a request-wide deadline of two
    schtasks timeouts from the start of the request; under MIN_SCHTASKS_QUERY_MS left, nothing more is asked and
    the answer says there was no time left.
  - Source checkout (no bundle root): null, nothing registered, nothing reported. Switching off never touches it.
- `server.js`: the route returns `watchdog` when the engine gives one.

## Tests

`engine/win32board.start-at-sign-in.test.js`: registered (definition XML asserted), German not-found, already-on
heals with an anchorer that throws, source checkout, present control, unreadable, off untouched, German error but
listed is present, missing node.exe, slow watchdog query, list read inside the budget, the `/Create`'s own timeout,
the request-wide deadline. Every review fix was mutation-checked (mutant applied, test red, file restored from a
copy).

## Deferred, with reasons

- An older build serving Settings could rewrite a newer build's watchdog shim when the task is missing. It needs an
  older board actually serving Settings (the boot's hand-off normally prevents that) AND a missing watchdog; the
  next newer boot rewrites the shim. Follow-up if it is ever seen.
- The screen does not yet show `watchdog.because`: #7504 (needs-browser).
