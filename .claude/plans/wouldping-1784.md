# wouldping-1784: re-assert the log's dir/file mode on every write

## The defect (kosmos#1784)

`engine/wouldping.js` writes the would-ping diagnostic log. It asked for `0o600` on the
file and passed **no mode** on the directory. `mode:` on `mkdirSync`/`appendFileSync`
applies on **create only**, so:

- the `wouldping` directory landed at `0755` (any local account can list it), and
- a pre-existing log kept whatever mode it already had, so a log left loose once stayed
  loose through every later append.

Same mechanism as #1761/#1776. Measured on this Mac (umask 022): a planted 0644 file stayed
644 after an append; the mkdir landed 0755. Both controls (a fresh path) came out 600/700,
so the instrument sees the modes.

## The fix

One best-effort `secureAppend(line)` helper, routing both write sites (`announce()` and the
transition write in `saw()`) through it. It matches `engine/remote.js` `secureStateDir`:
`mkdirSync(dir, { recursive: true, mode: 0o700 })` plus a `chmodSync(dir, 0o700)` re-assert,
and a `chmodSync(file, 0o600)` re-assert after the append. The two chmods are each in their
own catch so a perms failure cannot break a board read (the module's standing contract: a
measurement must never throw). `mkdirSync`/`appendFileSync` remain unwrapped, so an inability
to create the dir still aborts the write, exactly as before, and both call sites already run
inside `saw()`'s outer try.

## Scope

Only `wouldping.js`. This is the one module #1763 (directory modes) and #1776 (sendertoken)
did not cover: it calls no `chmodSync` anywhere and does not even declare a directory mode.
It is not folded into #1763's class change because its shape differs (no declared dir mode to
enforce; a file that is appended to on a hot path, so no temp-then-rename).

## Tests

Each arm plants a PRE-EXISTING loose file/dir (a fresh-create arm passes without any fix,
because create honours the mode) and asserts it tightens on the next append. Proven: removing
`chmodSync(file, 0o600)` reddens the loose-log arm; removing `chmodSync(dir, 0o700)` reddens
the loose-dir arm; a fresh-create CONTROL stays green under both, so the arms test the
re-assert and not the create. The 15 pre-existing arms (boot-once, transition logging,
never-throws, sandbox) are unchanged and stay green.
