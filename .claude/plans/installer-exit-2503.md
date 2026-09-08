# Plan: installer-exit-2503 -- read the status file for the real installer code (#2503)

## The bug (pre-existing on main, confirmed by content)

`beginInstall` spawns (engine/update.js:562):

```
sh -c 'curl -fsSL "$1" | sh; code=$?; printf "%s %s\n" "$code" "$3" > "$2"; if [ "$4" != /dev/null ]; then rm -f "$4"; fi'
```

A shell exits with the status of its LAST command -- the trailing `if`, which in
production is true (`$4` is a real marker path) and exits with `rm`'s status (0). So a
FINISHED installer (success OR failure) makes the child exit 0, and the installer's real
code is only in the status file (`$2` = `installStatusFile()`).

`wireChild`'s exit listener (engine/update.js:484) is `if (code !== 0) { ...bookkeeping... }`,
so on the common failure path (child code 0) the whole block is dead:
- `installStarted` never released -> `alreadyInstalling()` stays true -> `/api/update`
  answers `already:true` to every retry (an overlay that reloads into the same toast).
- `noteAttemptEnd` never records -> `lastAttempt()` reports a perpetually in-flight attempt.
- `autoFailedAt` never stamped -> the unattended back-off never engages.
...until the board restarts.

## The fix

The status file already holds the real number, and `readStatusRaw()` (engine/update.js:352)
already parses it to `{code, startedAt, endedAt}`. So the exit listener should trust the
status file for THIS attempt and fall back to the child's own `code` only when no matching
status was written (a shell killed by a signal before its `printf`).

```js
child.on('exit', (code) => {
  const status = readStatusRaw();
  const startedAt = owner && owner.startedAt;
  const realCode = (status && status.startedAt === startedAt) ? status.code : code;
  if (realCode !== 0) { installStarted = false; noteAttemptEnd(owner, realCode, ...); if auto autoFailedAt = now; stderr; }
});
```

The `startedAt` match is load-bearing: it stops the listener acting on a STALE status file
left by a previous attempt when THIS child died before writing its own (in which case the
child's real non-zero code is used instead). Single-flight already prevents two live
installers, so the file at exit time is this attempt's whenever this attempt wrote one.

## The test (engine.installer-exit-2503.test.js, new, root-level so the suite glob runs it)

🛑 The card's named trap: the natural test makes the child exit non-zero and asserts the
block runs -- it passes while production never reaches the case, because production's child
exits 0. The arms MUST reproduce the masked shape.

Arms:
1. **Masked failure (the bug):** fake child, installedRoot set, write `logs/install.status`
   = `7 <lastAttempt.startedAt>`, emit `exit` with code **0**. Assert: `alreadyInstalling()`
   false, `lastAttempt().code === 7`, `endedAt` set. (Fails against the unfixed code -- proven
   non-vacuous.)
2. **Signal-kill fallback:** child exits **5** with NO status file. Assert the block still
   runs with code 5 (fallback to the child's own code).
3. **Stale-status guard:** child exits **0** with a status file whose `startedAt` does NOT
   match this attempt. Assert the block does NOT run (we never act on another attempt's status).
4. **Success:** child exits 0 with status code 0 (this attempt's startedAt). Assert the block
   does not run.

Non-vacuity: arm 1 is run against a reverted copy of the fix and must FAIL there.

## Acceptance

A masked installer failure (child exit 0, status file non-zero) releases the single-flight
flag, records the real code, and stamps the auto back-off; the signal-kill fallback still
works; a stale status file is ignored; validation green. Closes #2503.
