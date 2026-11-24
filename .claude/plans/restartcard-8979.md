# restartcard-8979: a Windows agent's card says when and why its process restarted (kosmos#8979)

**Posture:** production

**Finished looks like:** after a Windows Claude agent's process dies and the supervisor starts it again, its card
reads "Restarted at <local time>: <plain reason>." until a turn on the new process ends without an error; a clean
stop or a stop with no restart shows nothing; the reason comes from the exit code / signal and the last error result
#8972 already reads (is_error, never the subtype).

## Change
- engine/win32streamstate.js
  - `restartWhy({ code, signal, errEvent })`: plain words. Sign-in error result (signInAfterEvent) -> "Claude is not
    signed in."; usage limit (limitAfterEvent) -> "Claude reached its usage limit."; any other error result ->
    "Claude stopped on an error: <its text, clipped>."; else a nonzero code -> "Claude stopped unexpectedly (exit code
    N[ = 0xXXXXXXXX])."; a signal -> "Claude was ended (signal S)."; else "Claude stopped without saying why."
  - publisher `restarting({ at, why })`: kept as the NEXT process's record (like #8951's lostOnStop), so `started()`
    puts it on `current.restarted`, written to the state file as `restarted: { at, why }`. A second death before a
    good turn replaces it (the newest restart is the one to show). Cleared by a result with no is_error and no
    api_error after the turn reached the model (the same "good turn" rule that clears auth and limit).
  - `restartedFor(name)`: { at, why } from a live process's file, else null (as unstartedFor).
- engine/win32supervisor.js: `attach` also keeps the parsed error event beside `stdoutSaid`; `finish` calls
  `stream.restarting(...)` only when the dead child was current AND the loop is still running (a restart follows).
- engine/status.js: pane card field `restarted` (Windows Claude pane only, else null); paneless card `restarted: null`.
- web/index.html stateReason: "Restarted at HH:MM: <why>" for an idle or working card, after the crash-loop, stuck
  error, unsent, and delivery-stall sentences (they matter more), before the plain state sentences.
- docs/browser-checks/fixtures/agent-card.json: `"restarted": null`.

## Rejected
- Parsing the `died` task-log `because` string for the reason: lossy (joined, clipped), and it would read the subtype.
- Showing it on the Mac (bin/agent-supervisor.sh) in this change: the card says Windows first; the Mac supervisor
  has no stream publisher. Follow-up card.
- Folding it into deliveryStall: a restart is not a delivery stall; separate field keeps both readers simple.

## Weakest premise
That a successful result is the right clearer: a restarted agent that is never sent anything keeps the line for
good. That is the card's ask ("until the next turn succeeds"), and stale only while nothing happens.

## Tests
New engine/win32streamstate.restart-8979.test.js and supervisor cases: words for each reason; record carried to
the next process; cleared by a good turn, not by an error turn; replaced by a second death; no record on a clean
stop; restartedFor on a dead pid is null; stateReason renders the sentence.
