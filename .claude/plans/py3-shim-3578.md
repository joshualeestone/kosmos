# Plan: #3578 (test-tool arm), stop hard-coding /usr/bin/python3 in three test scripts

## Problem
`tools/test-served-verify.sh`, `tools/test-served-verify-head-3073.sh` and
`tools/test-pkg-checksum-1670.sh` call `/usr/bin/python3` by absolute path. That is Apple's shim.
On agent1 Xcode 27.0 is installed with its license never accepted, so the shim prints the license
text and exits 69, and `tools/run-tests.sh` goes red locally on a tree nobody changed (measured
2026-09-24 on two unrelated branches). CI (macos-latest, license accepted) is unaffected, which is
why it stayed local.

## Change
Call `python3` from PATH, as sibling scripts already do (test-pkg-arch-gate-1562.sh,
test-site-push-race-2276.sh, test-permission-acceptance.sh, test-data-root-1511.sh,
test-scan-hatch-symlink-2125b.sh). After this, no script under tools/ hard-codes /usr/bin/python3.

**Scope, stated plainly:** this fixes the local red only where a non-shim python3 comes BEFORE
/usr/bin on the PATH of whatever runs the suite (true for agent1's interactive shells: Homebrew's
python3 first). A context whose PATH lacks /opt/homebrew/bin still gets the shim and still fails the
same way. It is never worse than today (without Homebrew, python3 IS /usr/bin/python3), but the
machine-level fix is still #3592's license acceptance. Also note that local run-tests.sh stays red
on agent1 for a separate shim, swiftc in test-floor-gate-tree.sh (#3592).

## Rejected
- `export DEVELOPER_DIR=/Library/Developer/CommandLineTools` in each script: it works (measured for
  git in the fleet-drift arm of the same card), but it assumes the CLT are installed and changes the
  toolchain for everything the script runs. The PATH lookup is the smaller change and matches the
  repo's existing convention.
- `sudo xcodebuild -license accept`: fixes the machine, not the scripts, and accepting a license on
  Josh's behalf is his call (the card says so).

## Weakest premise
That no script relies on the SYSTEM python specifically (e.g. a stdlib-version quirk). The six call
sites (four in test-pkg-checksum-1670.sh, one in each of the other two) are http.server servers,
one `re`-based extraction, and plain stdlib heredocs, which every python3 carries.

## Tests
Both arms per script, on agent1: normal PATH -> rc=0; PATH with a `python3` symlinked to the
`/usr/bin` shim first -> rc=1 with the license text (the control reproduces the original failure).
Full `tools/run-tests.sh` on agent1 (committed tree, 2026-09-24): node suite 8612 tests / 0 fail;
test-served-verify.sh now passes ("local server listening"); the suite still exits 69 at
tools/test-floor-gate-tree.sh, whose swiftc is the same unaccepted-license shim (#3592, out of scope
here). CI on macos-latest is the authoritative full run.
