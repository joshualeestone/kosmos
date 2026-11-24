# homer-diedcode-8967: a Windows agent's death says how it ended (kosmos#8967)

**Posture:** production

On 11-23 the Windows orchestrator's claude.exe died three times, about 0.6 s after a message was written to it.
The task log read only `homer died`. Two reasons it could say nothing:

1. `gone(code)` put the exit code on the `died` event, but `main()`'s task-log formatter printed only
   `time name action -- because`, so the code never reached the log.
2. The only reason a death carried was the stderr tail. Claude in `-p --output-format stream-json` mode reports a
   fatal error (a usage or auth failure, a turn error) as a `result` event on stdout, which nothing kept.

The replay on the box (three exact texts to a throwaway agent) did not reproduce, and there was no app-crash event for
claude.exe, so the next occurrence has to explain itself. This change is diagnostic: the loop's own behaviour (when it
restarts, what it resumes, what it retires, what state it publishes) is unchanged. The one visible difference outside
the log: a death is now written up to 500 ms later (the drain below), so the restart that follows it starts up to
500 ms later too.

## Change (engine/win32supervisor.js)
- `exit` passes `(code, signal)` to `gone`; the `died` event carries `signal` beside `code`.
- `stdoutError(e, line)`: the last error `result` (is_error, or an `error...` subtype: the subtype plus its text) or a
  line that is not a stream event ("a line that was not an event: ...": not JSON, or JSON that is not an object; labelled as such, not called an error), clipped to 300
  characters with whitespace collapsed. The text comes from `errors: string[]` (the shape `saysNothingToResume` already
  reads), joined with ` | `, and falls back to `result`. A successful result is the agent's own reply and is never
  kept. A successful result or a new turn (`system/init`) clears an earlier error, so an old error never rides on an
  unrelated death. The record is the child's own, kept even after the child is replaced.
- The `died` reason joins `it said: <stderr tail>` and `its stdout said: <...>` with `; `.
- `taskLogLine(at, name, e)` builds every supervisor-event line (`onEvent`; the few lines `main()` writes by hand for its own conditions, such as host-gone or channel-refused, are untouched); only a `died` line adds `(exit code N)` (with
  `= 0xXXXXXXXX` for a Windows code past 255 or below 0, an NTSTATUS) or `(signal S)`. A death with neither reads as
  before. Every other line is byte-identical to before.
- The death waits for stdout to end (`end` or `close`), at most `STDOUT_DRAIN_MS` = 500 ms (option `stdoutDrainMs`
  for tests): measured on the box, a child's last stdout line arrived AFTER `exit` in 40 of 40 runs (stderr before
  it, 40 of 40), so without the wait the error that explains the death would almost never be on its line. The
  single-handler guard is set at once. Only a stream that says it is still open (`readableEnded === false`) is waited
  on (and not one already destroyed or closed). The drain uses the real clock on purpose (the injected timer is a no-op
  in tests, and a death must never wait on it forever), is not unref'd (it is bounded, and an unref'd one could let the
  process leave before the line is written), and is spent inside `HOST_GONE_GRACE_MS` (noted there).
- Everything about the process is still settled at `exit`, exactly as before: the token is retired, `child` is
  cleared and the state is published stopped at once. So every `child === x` check (send, its flush callback, the
  rekey retry, the registration check, the stdout publisher) treats the dead child as gone during the wait, and a line
  read while it drains only feeds the death's reason and publishes nothing, as before #8967 when such lines were
  dropped. Only the reason gathering, the `died` line and the restart decision wait.

## Tests (engine/win32supervisor.test.js)
Fourteen `#8967` tests: code and signal on the event; error vs successful result vs non-event line on the reason, and an
old error cleared by a success and by a new turn; the death waiting for stdout in the real-world order (exit first);
the drain bound when stdout never ends, a death released by close alone, and no wait for a stdout already destroyed or closed; process state settled at exit (stopped at once, a late flush not counted); a late line publishing nothing; a send during the drain; stdoutError (including a 16 MB line in bounded time) and
taskLogLine directly. Each was run against the code before its fix and failed there (control runs on the box).

## Follow-ups, not here
- A final stdout line with no trailing newline is never emitted by `win32streamstate.lineReader` (no flush on `end`),
  so a CLI error printed without a newline just before exit is missed. A change to the shared reader, its own card.
- The #2726 "no conversation" detector (`saysNothingToResume`) reads only lines that arrive before `exit`; by the
  measurement above its line usually arrives after, so it likely misses. Fixing it changes the loop's restart
  behaviour, so it is its own card, not part of this diagnostic change.

## Not in scope
Finding the cause of the three deaths (that needs the next occurrence with this logging, or a repro); the codex
supervisor (win32codexsup.js) has its own death path.
