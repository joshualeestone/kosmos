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
  non-JSON stdout line ("not JSON: ..."), clipped to 300 characters with whitespace collapsed. A successful result is
  the agent's own reply and is never kept. Kept per child even after it is replaced (the record is the child's own).
  Best effort, like the stderr tail: a line arriving after `exit` misses the death's line.
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
