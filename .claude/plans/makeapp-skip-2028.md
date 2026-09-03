# Plan: makeapp-skip-2028

Addresses **kosmos#2028** (split out of #2023 at my recommendation): a skipped
`make_app` leaves a stale `Kosmos.app` across every later update, silently.

## The defect

`make_app` (which `rm -rf`s and rebuilds the bundle) is called at `install/setup.sh`
:2993 and is NOT gated on `FRESH_INSTALL`, so in the normal case an update DOES
replace the bundle. But the replace is skipped when `APP_SKIP_ICON=yes` (the home and
system Applications folders alias, or are unresolvable) or diverted
(`APP_HOME_FOREIGN`) or fails. On an UPDATE that leaves the PREVIOUS bundle in place.
That was latent until board-token enforcement (#1946/#1972) shipped `tokenizedBoardURL`
in the same commit: an app older than that cannot authenticate, so a machine that had
ever skipped `make_app` is locked out of its own board by an update it accepted.

Before this change the skip was reported only as "no icon", which reads as cosmetic,
and nothing recorded WHICH arm fired, so diagnosing an affected machine needed that
machine's live state (#2028's part 1).

## Scope decision (per Splinter, 2026-09-03)

The card's part 1 (determine which arm fired on Josh's machine) needs his machine's
state, which is not ours and which I will not ask him to look up. Splinter's guidance:
build the fix correct on BOTH arms rather than waiting to learn which one it was, since
a stale bundle across later updates is the defect either way and the diagnosis does not
change the remedy. This change is keyed on the GENERAL condition (`APP_MADE != yes` on
an update), not on any one arm, so it is correct whichever fired -- and the greppable
marker makes the "which arm" question answerable from the log next time WITHOUT the
machine.

Part 3 (whether the native app should refuse to open a board it cannot authenticate to)
is an app/frontend change, out of this setup.sh lane; not built here.

## The change (install/setup.sh only)

An additive block after the app-icon reporting chain (does not touch the tuned existing
messages, so it cannot regress them):

1. A greppable marker written to the LOG (not the terminal) on EVERY run:
   `app-bundle: made=... skip_icon=... skip_reason=... fresh_install=... sys_stale=...
   sys_failed=... home_foreign=...`. Direct append, grouped so a failed append-open is
   suppressed, `|| true` for errexit. This is the "make the skip visible" core.
2. On an UPDATE that did not rewrite the bundle (`FRESH_INSTALL=no && APP_MADE != yes`),
   one operator note routing to the reliable open path (browser / `kosmos open`), never
   "relaunch the app" -- aligned with #2023's standing measured-unreliable ruling. It
   never ASSERTS the app is stale (it may not be); it routes around the possibility, so
   it is correct on every not-made arm. Gated to updates: a fresh install has no
   previous bundle to be stale and its own open already fired.

## Why APP_MADE is the right key

`APP_MADE=yes` is set only at setup.sh:2994 (primary make_app success) and :3034 (the
home-folder retry). Every not-made path (APP_SKIP_ICON, APP_HOME_FOREIGN, make_app
failure) leaves it `no`. So `APP_MADE != yes` is exactly "the bundle was not written
this run", independent of which arm caused it.

## Test

`tools/test-app-bundle-status.sh` (wired into `test:shell`). setup.sh is served as a
single curl|sh file and sources nothing, so the block cannot live in a lib the test
sources; instead the test EXTRACTS the exact shipped bytes of the block from setup.sh
(the technique test-install.sh already uses for the default-port and derivation-formula
fragments) and drives it through every arm with a stubbed `info()` and a temp LOG:

- marker written on every run with the actual state (fresh made=yes, update made=yes);
- both APP_SKIP_ICON arms (same / unknown) on an update -> marker + note;
- the other not-made arms (home_foreign, make_app-failed) on an update -> marker + note;
- control: a FRESH install that did not make the bundle -> marker but NO note (the note
  is update-only);
- errexit safety: an unwritable LOG does not abort the block and the note still fires;
- an anchor-drift guard (the extraction must contain the marker + note or the whole test
  fails loudly rather than vacuously) and a negative control (proves the harness can
  fail).

18 assertions, pass under sh, bash, and system bash 3.2.57. `sh -n` + `bash -n` clean.

## Validation

- No `web/` change (no #1720 browser-check gate). No node engine change (the marker is a
  shell printf; no `.test.js`). setup.sh + a shell test + the package.json wiring.
- Full suite via GitHub CI.
