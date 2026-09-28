# mktemp-4298: shell tests stop leaking tmp.* into the real TMPDIR

Card: #4298 (split from PigeonPete's #4273, slice 2). Assigned by Liu Kang (m2072).

## Finished means
- No script the shell suite runs creates a `tmp.*` (or any template-less mktemp entry) in the real
  per-user temp root: measured as a before/after count of new `tmp.*` there across one
  `yarn test:shell` run with TMPDIR set to a per-run root.
- A guard in test:shell fails if a template-less mktemp comes back anywhere in tools/, install/ or bin/
  shell scripts, with a negative control proving it finds each bare shape.
- `tmp` comes off `tools/test-leak-allowlist.txt` once #4273 (which adds that file) and this both land.

## Why
macOS `mktemp` ignores TMPDIR. `mktemp`, `mktemp -d` and `mktemp -t name` all create in the per-user
temp root, outside run-tests.sh's per-run root (`kt$$`, removed at exit), so a script that does not
remove its own dir leaves it there. A positional template `"${TMPDIR:-/tmp}/<script>.XXXXXXXXXX"`
lands under TMPDIR, and the name says which script left it.

## Measurement
| state | new tmp.* in real root per test:shell run |
|---|---|
| origin/main 44d2a0c | 13 (upper bound: shared box) |
| after tools/ templates (58ec009) | 7: 3 pkg postinstall, 4 foreign (s.db/k.log, no writer in this repo) |
| after 5bced4d | 0 of ours (postinstall's test alone: 0 in the real root, 3 in the given TMPDIR) |

## Decisions
- Template, do not trap: under run-tests.sh the per-run root removes everything. Standalone runs of a
  script already clean up where they did before; a leftover in the run root is named by script.
- Include non-test scripts the suite runs (release.sh, verify-served.sh, build scripts, the pkg
  postinstall): the measurement showed they leak during tests. The change is the location/name of a
  temp file only; in production it lands in the same real temp root as before.
- postinstall: template only. Its real leak (EXIT trap skipped by `exec /bin/sh`) is installer
  behaviour and a separate card; the block is a single-quoted sh -c arg, so no apostrophes added.
- Out of scope, noted on the card: shell embedded in JS (engine/reporthook.js, docs/browser-checks,
  three *.test.js).

## Mistake recorded
A `git stash` in the worktree during a measurement run swapped scripts mid-execution; that run was
discarded and re-run. Never stash or edit a tree a suite is executing.

## Tests
- tools/test-mktemp-template-4298.sh (first in test:shell): scope floor, tree clean, negative control
  of 9 bare shapes (incl. `/usr/bin/mktemp` and `mktemp 2>/dev/null`), templated calls/messages/comments
  not flagged. Red on origin/main (114 calls in tools/*.sh alone).
- test-postinstall-inline-quoting.sh and test-pkg-checksum-1670.sh pass with the postinstall change.
