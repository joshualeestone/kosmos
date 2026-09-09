# worldconfirmed-2569: install-gate EXPECTED_ADDS must include .world-confirmed.json

## Problem (0.6.51 cut-blocker)

The 0.6.51 staging cut refused at step 4b, the #624 sandboxed-install gate in
`tools/test-install.sh`. That gate does a real install of the just-built bundle,
boots the installed board, and asserts the install added EXACTLY the files in
`EXPECTED_ADDS` and nothing more. The fresh install now also produces
`./Kosmos/.world-confirmed.json`, which `EXPECTED_ADDS` did not list, so the gate
refused (correctly, before anything was served).

Cause: #2569 (the #2528 world-lockout fast-follow) reworked
`engine/worldbootguard.js`. The board writes the set-once marker
`.world-confirmed.json` from `server.js` `onListening` -> `markConfirmed` the
first time it actually serves its default world. The install gate boots the
board, so a fresh install legitimately gains that file. Author (Angel) confirmed
in source it is intended, not a bug; Splinter authorized the cutter to land the
one-line gate update. This is the same class as #2210 (the #2066 source-channel
install file), which the file's own comment predicted ("THERE WILL BE A FOURTH
FILE ... ADD IT HERE IN THE SAME COMMIT").

## The call

Add `./Kosmos/.world-confirmed.json` to `EXPECTED_ADDS`.

The load-bearing detail: `EXPECTED_ADDS` is compared to `$ADDED` by LITERAL
STRING EQUALITY, and `$ADDED` is built from `find . -type f | sort`. So
`EXPECTED_ADDS` must be written in sort order. `.world-confirmed.json` sorts
FIRST (its leading `.` at 0x2E collates before `bin` at 0x62), so it leads the
list, not trails it. Verified by reproducing `find | sort` over the exact five
paths: the printf order now matches byte-for-byte. Also extended the file's
comment to cover board-boot markers (not only installSupervisor files, which is
the gap that let this drift), and named the marker in the `chk` description.

## Rejected / deferred

- Rejected: fixing this in `worldbootguard.js` (making the board not write the
  marker during a fresh install). That would be wrong; the marker-on-first-serve
  is the intended core of the #2528 recovery, and the author confirmed it.
- Deferred (pre-existing, cosmetic): the `chk` description string also omits
  `engine-path` (it named 3 of 4 files before this change; now 4 of 5). Label
  only, does not affect the assertion, not introduced here; a separate cleanup.

## Weakest premise

That the marker's path, relative form, and sort position exactly match what the
gate's `find | sort` + `comm -13` pipeline emits. If the install ever wrote the
marker under a subdir or with a different prefix, the string compare would red
again. Verified against `worldbootguard.js` (`path.join(base, '.world-confirmed.json')`
at the install base, same base as the sibling `./Kosmos/...` entries) and by
reproducing the pipeline. What would change my mind: the marker path moving.

## Files

- `tools/test-install.sh` - add the file to `EXPECTED_ADDS` in sort order,
  extend the comment, name it in the `chk` description.
