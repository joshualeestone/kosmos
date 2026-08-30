# #1548: an aborted cut must not leave a publishable tarball in the site working tree

## Problem
`tools/release.sh` writes the served UNVERSIONED pointer (`dist/kosmos-arm64.tar.gz`
plus its `.sha256`) into the site checkout just before the deploy step, overwriting the
previously-served copy. If the cut aborts anywhere between that overwrite and a
successful deploy, the abandoned build's pointer is left sitting in the site checkout.
The next site deploy then publishes that abandoned build against the stale committed
`latest.json` -- which is exactly how 0.6.06 shipped mislabelled (#1565).

The versioned artifacts were already handled by `release_site_restore` (it restores
`latest.json` / `setup.sha256` and removes version-named files the cut created). The
UNVERSIONED pointer was the gap.

## Approach
1. **Before** the overwrite, back the pre-cut pointer pair up.
2. On abort, the EXIT trap's `release_site_restore` restores that backup, so the site
   keeps pointing at the version it actually served. If the pointer did not pre-exist
   (a fresh site clone, `had_ptr=0`), remove the one this cut created instead.
3. On success (`DEPLOYED=1`), the deploy has carried the new pointer, so the backup is
   discarded.

## Key decision: the backup lives under BUILD_ROOT, not in the site checkout
The first cut of this fix backed the pointer up as `dist/*.precut` beside the served
file, inside the site checkout. That is wrong: the site checkout is **shared and
deployable**, so an untracked `.precut` sitting there for the whole cut window could be
staged into a deploy by a stray `git add -A` from another agent -- the same #1548 bug by
a different door. The backup was therefore moved **out of the site checkout entirely**,
under `$BUILD_ROOT/precut/`. `BUILD_ROOT` is the cut's own temp tree, removed by the
same EXIT trap on every path, so the backup:
- can never be committed or deployed by anyone;
- needs no separate success-path cleanup (it goes with `rm -rf "$BUILD_ROOT"`);
- is read by `release_site_restore` before that removal (trap order guarantees it).

`release_site_restore` takes the backup root as a 5th argument; the pre-existing 3-arg
callers pass nothing, so `${4:-1}` / `${5:-}` make the pointer logic a no-op for them.

## What must NOT change
- The versioned-pair restore logic (`had`) and the `latest.json` / `setup.sha256`
  restore are untouched.
- `versions.html` is still never touched by the trap (its entry is hand-written and a
  re-cut needs it).

## Tests
`tools/test-site-restore-1548.sh`, wired into `test:shell`: three arms (restore /
remove-on-fresh-clone / leave-served-intact), each with a control that can return the
dangerous answer, asserting both the `.tar.gz` and its `.sha256`. Plus the existing
`test-release-detached.sh` 3-arg-caller regression stays green.
