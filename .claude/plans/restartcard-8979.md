# restartcard-8979: a Windows agent's card says when and why its process restarted (kosmos#8979)

**Posture:** production

**Finished looks like:** after a Windows Claude agent's process dies and the supervisor starts it again, its card
reads "Restarted at <local time>: <plain reason>." until a turn on the new process ends without an error; a clean
stop or a stop with no restart shows nothing; the reason comes from the exit code / signal and the last error result
#8972 already reads (is_error, never the subtype).

## Change
- engine/win32streamstate.js
  - `restartWhy({ code, signal, errEvent, authRefused, limited })`: plain words, in this order: a refused sign-in in the
    dying turn (or an error result signInAfterEvent reads as one) -> "Claude is not signed in."; a refused
    rate_limit_event in the dying turn -> "Claude reached its usage limit."; any other error result (is_error, or an
    `error...` subtype; never by a `success` subtype) -> "Claude stopped on an error: <its text, clipped>."; a signal ->
    "Claude was ended (signal S)."; a nonzero code -> "Claude stopped unexpectedly (exit code N[ = 0xXXXXXXXX])."; else
    "Claude stopped without saying why."
  - `exitCodeText(code)`: the one spelling of an exit code, shared with the supervisor's task-log `exitWords`.
  - publisher `restarting(d)`: keeps { why } for the next process; `started()` puts `restarted: { at, why }` on that
    process's state file, `at` being when it started. A turn that reached the model and ended without an error clears
    it. `stopped()` carries an uncleared record to the next process (so a resume that fails keeps the first reason);
    a newer `restarting()` replaces it.
  - `restartedFor(name)`: { at, why } from a live process's file, else null (as unstartedFor).
- engine/win32supervisor.js: the stdout reader keeps the dying turn's limit and sign-in refusals itself (`turnLimited`,
  `turnAuthRefused`, reset by a new turn or a good result), because a death's last lines arrive after 'exit', when the
  publisher no longer hears them (#8967). `finish` calls `stream.restarting(...)` only when the dead child was current,
  the loop is still running, and the death was not a resume finding no conversation (Kosmos's own restart failing).
- engine/status.js: pane card field `restarted` (restartedOf: Windows Claude pane only, else null); paneless `restarted: null`.
- web/index.html stateReason: "Restarted at <time>: <why>" (a weekday when not today, a date when 6 days or more ago) for
  an idle or working card, after the crash-loop, stuck error, unsent and unstarted sentences, before #7368's step.
- docs/browser-checks/render-restarted-8979.js: the pill's hover and hidden text in Chromium and WebKit, desktop and
  phone, with a negative arm.
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
engine/restartcard-8979.test.js: words for each reason; record carried to
the next process; cleared by a good turn, not by an error turn; replaced by a second death; no record on a clean
stop; restartedFor on a dead pid is null; stateReason renders the sentence; a limit whose lines arrive after exit names the
death; an earlier turn's limit or sign-in does not; a failed resume keeps the first reason.
