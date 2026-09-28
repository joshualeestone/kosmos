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
  temp file only. With TMPDIR set (a terminal) they land in the same real temp root as before. With it
  unset (ssh, launchd, cron) they now land in the shared /tmp rather than the per-user dir a bare mktemp
  used; mktemp still makes files 0600 and dirs 0700, so nothing becomes readable by others. Only the
  postinstall, which always runs with TMPDIR stripped, gets the getconf fallback.
- postinstall: template only. Its real leak (EXIT trap skipped by `exec /bin/sh`) is installer
  behaviour and a separate card; the block is a single-quoted sh -c arg, so no apostrophes added.
  `sudo -u -H` strips TMPDIR in a real install, so the template falls back to
  `getconf DARWIN_USER_TEMP_DIR`, the same per-user dir a bare mktemp used (checked with TMPDIR
  empty and `mktemp -u`), not the shared /tmp. /tmp only if getconf fails. A TMPDIR that survives
  sudo (a sudoers env_keep) but is not writable retries in the getconf dir instead of aborting the install.
- build-tmux-from-source.sh: a short `bts.XXXXXX` name, because its smoke test puts tmux sockets
  under the dir and a socket path over 104 bytes fails (82 bytes under a run root).
- Out of scope, noted on the card: shell embedded in JS (engine/reporthook.js, docs/browser-checks,
  and install.reachable-1662.test.js, the one test file with a bare call), and ios/ scripts (run by
  iOS CI, not by test:shell).
- The matcher decides code vs text per character: quoted strings and comments are text, a `$(...)`
  or backtick inside double quotes is code, and a string handed to `-c` is code. On origin/main it
  finds 116 calls in tools/ and 1 in install/, the 117 this branch templates.

## Mistake recorded
A `git stash` in the worktree during a measurement run swapped scripts mid-execution; that run was
discarded and re-run. Never stash or edit a tree a suite is executing.

## Tests
- tools/test-mktemp-template-4298.sh (first in test:shell): scope floor, tree clean, negative control
  of 33 bare shapes asserted by line number (incl. `/usr/bin/mktemp`, `mktemp 2>/dev/null`,
  `command`/`env`/`sudo`/`nice`/`VAR=` prefixes, `if`/`{`/a `case` arm, `-dt`, a continued line,
  `bash -c`/`sh -ec`/`eval`/`trap` strings, including one that starts with mktemp, `timeout`,
  a quoted `"mktemp"`, `-t "$(basename "$0")"`, a template with no X run, `-t` beside a template (macOS then makes a second file in the per-user
  root), `\mktemp`, `caffeinate`/`arch` wrappers); the scope is every shell script git tracks under
  tools/, install/ and bin/ (git ls-files, by .sh or shell shebang), templated calls, messages,
  comments and `grep -c 'mktemp'` not flagged; and the installer's production arm (TMPDIR stripped:
  getconf dir; getconf failing under set -e: falls back, no abort).
- Leftovers in the per-run root, by name, fixed at the test: test-cut-parallel-region.sh (7
  `release`, the region keeps logs on red on purpose) exports TMPDIR=$WORK;
  test-versions-entry-gate.sh's `bash -c` clock probe makes its dir under $T. Both now leave 0.
- Deferred: `${TMPDIR:-/tmp}/` gives `//` when TMPDIR ends in `/` (macOS default). A valid path;
  no changed script compares these paths as strings (reviewed); #3594's string-compare case is
  already guarded in test-promote-channel-win.sh. Red on origin/main (114 calls in tools/*.sh alone).
- test-postinstall-inline-quoting.sh and test-pkg-checksum-1670.sh pass with the postinstall change.
