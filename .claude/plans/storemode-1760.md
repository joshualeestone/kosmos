# storemode-1760: the data root is owner-only and the message log is created 0600 (kosmos#1760)

Revived from the stranded branch `store-mode-hardening` (7e8ce8f2c, 09-12) during the #7551 triage. It was rebuilt on
main rather than rebased, because main rewrote messages.js since.

## Why now
A Linux install (a Kosmos Cloud box included) keeps its data outside ~/Library, so that folder is made under the
kosmos user's umask and can come out 0755. That makes conversations readable by any other local account.

## What
- engine/store.js `ensure()`: chmod the data root 0700, best-effort. It is resolved through `resolveDataRoot`
  (#5418), not the old branch's bare `dataRootFor`, so a test process tightens its own throwaway root and never the
  operator's real one, and no legacy migration runs from here.
- engine/messages.js `appendLog`: create the log with mode 0600. Spill files are already 0600 on main (securewrite).

## Tests
engine/store.mode-hardening-1760.test.js: ensure() tightens a root that starts at 0755; the message log is created
0600 under umask 022 (through the real `logHeldDropped`). Each was shown red with its own change removed.

## Weakest premise
A data root that someone shares on purpose (group-readable) gets closed. Nothing in Kosmos does that, and a person
who wants it shared sets its mode after the board runs, which ensure() would then undo on the next write.
