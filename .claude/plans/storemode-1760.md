# storemode-1760: the data root is owner-only and the message log is created 0600 (kosmos#1760)

Revived from the stranded branch `store-mode-hardening` (7e8ce8f2c, 09-12) during the #7551 triage. It was rebuilt on
main rather than rebased, because main rewrote messages.js since.

## Why now
Outside macOS (whose ~/Library is already 0700), the data root is made under the account's umask and can come out
0755, readable by any other local account. That covers a default Linux install and one with AGENT_WORKFORCE_DATA set
by install/setup.sh (non-default KOSMOS_HOME), a Kosmos Cloud box included.

## What
- engine/store.js `secureRoot()`: chmod `root()` (the value every writer uses as store.ROOT, so a test process
  tightens its own throwaway root) to 0700, best-effort. `ensure()` calls it, and so does the board at start.
- engine/messages.js: `appendLog` creates the log 0600. `secureLog()` tightens an existing log (an upgraded install)
  at board start, and leaves a symlink alone. Spill files are already 0600 on main (securewrite).
- server.js: a real board (boardAuthState.on, as removal.reapplyAtBoardStart) calls both at start.
- Not changed: the seven other places that mkdir the root directly. The board-start call covers a running install,
  and ensure() covers the store's own writers (see Known limits).

## Tests
engine/store.mode-hardening-1760.test.js (POSIX only): ensure() and secureRoot() tighten a 0755 root; the log is
created 0600 under umask 022 (through the real `logHeldDropped`); secureLog tightens an existing 0644 log and leaves a
link's target alone; a source check that the board-start block makes both calls. Each behaviour test was shown red
with its own change removed.

## Weakest premise
A data root that someone loosens on purpose (group-readable) is closed again at the next board start, or by the next
separate process that writes to the store. Nothing in Kosmos shares that folder: the chmod is on the app's own folder
inside AGENT_WORKFORCE_DATA, never the folder a person names.

## Known limits
- The board-start test is a source check: it proves both calls sit in the gated block, not that they run.
- A process that creates the root through appendLog or one of the direct `mkdirSync(store.ROOT)` sites, before any
  ensure(), leaves it at the umask until the next ensure() or board start. A fresh board makes the root 0700 itself
  (boardauth.ensureToken).
- ensure() tries a root once per process, so a root removed and made again inside one long-lived process waits for
  the next board start.
