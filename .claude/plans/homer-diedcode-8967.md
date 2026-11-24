# homer-diedcode-8967: a Windows agent's death says how it ended (kosmos#8967)

**Posture:** production

On 11-23 the Windows orchestrator's claude.exe died three times, about 0.6 s after a message was written to it.
The task log read only `homer died`. Two reasons it could say nothing:

1. `gone(code)` put the exit code on the `died` event, but `main()`'s task-log formatter printed only
   `time name action -- because`, so the code never reached the log.
2. The only reason a death carried was the stderr tail. Claude in `-p --output-format stream-json` mode reports a
   fatal error (a usage or auth failure, a turn error) as a `result` event on stdout, which nothing kept.

The replay on the box (three exact texts to a throwaway agent) did not reproduce, and there was no app-crash event for
claude.exe, so the next occurrence has to explain itself. This change is diagnostic only: no behaviour of the loop
changes (when it restarts, what it resumes, what it retires).

## Change (engine/win32supervisor.js)
- `exit` passes `(code, signal)` to `gone`; the `died` event carries `signal` beside `code`.
- `stdoutError(e, line)`: the last error `result` (is_error, or an `error...` subtype: subtype plus its text) or a
  line that is not a stream event ("not a stream event: ...": not JSON, or JSON that is not an object), clipped to 300
  characters with whitespace collapsed. A successful result is the agent's own reply and is never kept, and it clears
  an earlier error, so an old error turn never rides on an unrelated death. Kept per child even after it is replaced
  (the record is the child's own).
- The death waits for stdout to end (`end` or `close`), at most `STDOUT_DRAIN_MS` = 500 ms: measured on the box, a
  child's last stdout line arrived AFTER `exit` in 40 of 40 runs (stderr before it, 40 of 40), so without the wait the
  error that explains the death would almost never be on its line. The single-handler guard is set at once. Only a
  stream that says it is still open (`readableEnded === false`) is waited on. The drain uses the real clock on purpose
  (the injected timer is a no-op in tests, and a death must never wait on it forever), and it is spent inside
  `HOST_GONE_GRACE_MS` (noted there). During the wait the loop still holds the dead child, but it is marked exited,
  so a `send()` in that half second is a definite "not running", never an unsure.
- An error result's text is read from `errors: string[]` (the shape `saysNothingToResume` already reads), joined with
  ` | `; `result` is the fallback.

## Follow-up, not here
A final stdout line with no trailing newline is never emitted by `win32streamstate.lineReader` (no flush on `end`), so a
CLI error printed without a newline just before exit is missed. That is a change to the shared reader, its own card.
- The `died` reason joins `it said: <stderr tail>` and `its last error on stdout: <...>` with `; `.
- `taskLogLine(at, name, e)` builds every task-log line; only a `died` line adds `(exit code N)` (with
  `= 0xXXXXXXXX` for a Windows code past 255 or below 0, an NTSTATUS) or `(signal S)`. A death with neither reads as
  before. Every other line is byte-identical to before.

## Tests (engine/win32supervisor.test.js)
Code and signal on the event; error result vs successful result vs non-JSON line on the reason; stdoutError and
taskLogLine directly. All four new tests fail on main's supervisor and pass here (control run on the box).

## Not in scope
Finding the cause of the three deaths (that needs the next occurrence with this logging, or a repro); the codex
supervisor (win32codexsup.js) has its own death path.
