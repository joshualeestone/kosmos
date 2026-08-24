# The update proves what landed, or it says it failed (the 0.5.13 wedge)

## What happened (Josh's machine, 2026-08-24 10:51)

The in-app update to 0.5.13 printed downloading 100%, installed to
~/.local/share/kosmos, and done; the disk still held 0.5.12, launchd's
board job was not running, and an unsupervised board kept serving
0.5.12. Three failures, each reported as success. install_kosmos dies
loudly at every internal failure point and the log shows no die, so the
swap returned success; the surviving explanations (stale bytes from an
edge cache on the unversioned artifact URL, or a failure shape we have
not reproduced) are both closed by the same discipline: the installer
must PROVE what landed, and every artifact URL must be tied to the
version the run set out to install.

## Changes (install/setup.sh)

- The run resolves the release pointer FIRST: latest.json, fetched with
  a cache-busting query, names the version this run intends to install.
  The log opens with that version and the time (the diary can finally
  answer which release a run was). Unreachable pointer: the run
  proceeds versionless, says so, and the read-back degrades to
  reporting rather than asserting.
- Artifact fetch prefers the VERSIONED name (kosmos-<v>-arm64.tar.gz)
  and falls back to the unversioned name carrying a cache-busting query
  tied to the version, so a stale edge can never satisfy the request
  with old bytes. The checksum fetch rides the same URL choice. tmux
  keeps its unversioned name with the same buster.
- POST-SWAP READ-BACK: after the renames, the installer reads
  app/package.json's version from the DESTINATION. If a target version
  is known and the two differ, it DIES naming both and the likely
  cache, and the update reports failure instead of success. This closes
  the whole installed-old-bytes class whatever its transport.
- The pause guard proves the old board GONE BY PORT: lsof on the port
  after kosmos stop, in addition to the existing body probe; a listener
  that survives is named by pid in the die. lsof missing degrades to
  the existing probe.
- The keep-running step stops printing done past a failure: the
  bootstrap arm's outcome is checked, and a failed registration prints
  the honest note instead of the success line.

## Changes (tools/release.sh)

- Publishes the versioned artifact names beside the unversioned ones
  (both tarballs and both .sha256), so old installers keep working and
  new installers can pin; republishing the same version with different
  bytes refuses (a versioned name is a promise of immutability).
  verify-served checks the versioned pair too.

## Review bound (stated before the loop)

Up to two blind iterations; the properties: the installer can never
report success while the destination holds a different version than the
run's target; no fetch can be satisfied by a cached artifact from
another release; a failed step never prints done. Findings against
these are fixed with pins; measured fix-layer findings continue; the
rest is carded.
