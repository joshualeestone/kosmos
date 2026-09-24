# Plan: #3578 (test-tool arm), stop hard-coding /usr/bin/python3 in three test scripts

## Problem
`tools/test-served-verify.sh`, `tools/test-served-verify-head-3073.sh` and
`tools/test-pkg-checksum-1670.sh` call `/usr/bin/python3` by absolute path. That is Apple's shim.
On agent1 Xcode 27.0 is installed with its license never accepted, so the shim prints the license
text and exits 69, and `tools/run-tests.sh` goes red locally on a tree nobody changed (measured
2026-09-24 on two unrelated branches). CI (macos-latest, license accepted) is unaffected, which is
why it stayed local.

## Change (revised after CI)
Each script picks its interpreter once, near `set -u`:
`PY3=/usr/bin/python3; "$PY3" -c '' >/dev/null 2>&1 || PY3=python3`, and every call site uses "$PY3".
So wherever the system python runs (CI, any Mac with the license accepted) behaviour is EXACTLY as
before, and only a Mac whose shim cannot run falls back to python3 on PATH.

**Why revised:** the first version (bare `python3` from PATH everywhere) went red on CI (PR #3601,
run 36022095028): test-served-verify.sh "local server did not start" with an EMPTY server log, so the
runner's PATH python3 produced no PORT line inside the script's 5s poll where /usr/bin/python3 did.
Root cause on the runner is NOT established (a slow first start of the toolcache python is a guess).
The prefer-system form makes that question moot: CI keeps the interpreter it always used.

**Scope:** fixes the local red on agent1 for these three scripts. Local run-tests.sh stays red on
agent1 for a separate shim, swiftc in tools/test-floor-gate-tree.sh (#3592).

## Rejected
- `export DEVELOPER_DIR=/Library/Developer/CommandLineTools` in each script: it works (measured for
  git in the fleet-drift arm of the same card), but it assumes the CLT are installed and changes the
  toolchain for everything the script runs. The PATH lookup is the smaller change and matches the
  repo's existing convention.
- `sudo xcodebuild -license accept`: fixes the machine, not the scripts, and accepting a license on
  Josh's behalf is his call (the card says so).

## Weakest premise
That `"$PY3" -c ''` succeeding means the system python is fully usable (it proves the shim runs, not
every stdlib module). And, for the fallback arm only, that no script relies on the SYSTEM python specifically (e.g. a stdlib-version quirk). The six call
sites (four in test-pkg-checksum-1670.sh, one in each of the other two) are http.server servers,
one `re`-based extraction, and plain stdlib heredocs, which every python3 carries.

## Tests
Both arms per script on agent1:
- fallback arm (as-is: /usr/bin/python3 shim exits 69, so PY3=python3): all three rc=0.
- system arm (DEVELOPER_DIR=CommandLineTools makes /usr/bin/python3 3.9.6 run, so PY3=/usr/bin/python3,
  the CI path): all three rc=0.
Selection verified directly in each arm (prints python3 vs /usr/bin/python3).
CI (macos-latest) is the authoritative run for the system arm.
