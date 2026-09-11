# win32-configdir-2614 - restore-refuse safety check must cover Windows agents

Card: kosmos#2614 (follow-up to #2609/#2613, flagged by PigeonPete).

## Problem

The #2609 account-dir restore-refuse check (`engine/remove.js`
`restoreBlockedByMissingAccountDir`) refuses a restore when the agent's account
directory (its `CLAUDE_CONFIG_DIR`) is gone, so a removed agent cannot be
restored into the #1659 blank-agent state. It reads that directory from the
launchd plist via `create.readJob`. A win32 agent has no plist - it carries a
registered Scheduled Task - so `remove.js` hardcoded `launched = null` on win32
and the check was skipped there. A Windows agent whose account was deleted could
still be restored into the blank-agent state.

## Prior hold, and why it lifted

This card was held on #570 (the Windows substrate) while the task argv format was
still in flux. Un-held once the format proved stable: `taskExec`'s argv gained a
sixth field (`claudeBin`) append-only, with `configDir` unmoved at position 4,
and #2601/#2661/#2266 landed the delivery substrate. The consumer
(remove.js account-dir check) already exists and the author's own comment says to
add win32 "when a win32 substrate exists". It exists.

## Fix

Add `win32job.configDirFor(name)`: the win32 analogue of `create.readJob(...).configDir`.
- Query the task definition: `schtasks /Query /TN <task> /XML`, through the
  mockable `run()` seam (so it is testable from a Mac).
- Unescape the `<Arguments>` element and split its quoted tokens. Those tokens
  are node's `process.argv`, because `taskXml` wraps the command as a headless
  conhost (`--headless "<node>" "<supervisor>" "<name>" "<cwd>" ...`), so
  `tokens.slice(2)` reconstructs exactly the `process.argv.slice(2)` that
  `win32supervisor.main` consumes.
- Hand that to the ONE canonical parser, `win32supervisor.specFromArgv`, rather
  than re-deriving the positions (engine convention #5: no second derivation of
  one fact). `slice(2)` is append-safe - a new trailing argv field cannot move
  `configDir` off index 3.
- Self-check: the reconstructed `spec.name` must equal the queried name
  (`taskExec` writes it at argv[0]). A mismatch means the leading wrapper is not
  the shape we assumed, so return `known: false` rather than guessing a configDir
  from a misparsed line.
- Return shape mirrors `presence`: `{ known: false, because }` when schtasks
  cannot be read or the line is unrecognized; `{ known: true, configDir }`
  otherwise, `configDir` null for a default-account agent ('-' -> null).

Then in `remove.js`, on win32, build `{ configDir: configDirFor(clean) ... }`
instead of `null`, so the one existing gone-configDir check runs on both
platforms.

## Files

- `engine/win32job.js` - `configDirFor`, plus an `xmlUnescape` helper.
- `engine/remove.js` - the win32 branch of `restoreBlockedByMissingAccountDir`.
- `engine/win32job.test.js` - configDirFor unit tests.
- `engine/remove.win32-job-570.test.js` - restore-refuse-on-win32 integration tests.

## Tests

Asserted from a Mac by round-tripping `taskXml` through a mocked `schtasks`
(the cross-platform-from-either posture the win32 suites already use). configDirFor:
recovers the configDir, unescapes an XML metacharacter, maps default-account '-'
to null, distinguishes absent from unreadable, and reuses specFromArgv. remove.js:
restore refused on win32 when the account dir is gone, not blocked when present or
default-account, fail-safe (not blocked) on an unreadable task.

## Weakest premise

That real Windows `schtasks /Query /XML` returns the same task-definition XML
`taskXml` wrote. Mitigated by round-tripping our own writer's output and by the
name self-check (a shape we do not recognize returns `known: false` rather than a
wrong dir). Live-Windows verification joins the QA (ready-to-test) loop, like any
win32 change.

## Not in scope

Porting the launchd/tmux-shaped remove.test.js fixtures to Windows (a much larger
piece; the win32 dispatch is asserted directly instead, per this file's sibling
test).
