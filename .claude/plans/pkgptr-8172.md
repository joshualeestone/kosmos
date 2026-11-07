# pkgptr-8172: the pointer names its installer pkg (pkg_sha256), as it names its /setup (setup_sha256, #5032)

Card: kosmos#8172, the follow-up to #8167 (merged as #8175).

## Why

After #8167 a staging cut publishes `Kosmos-staging.pkg` and leaves `Kosmos.pkg` (the Download button's file) to the
promote. Nothing records which pkg belongs to which build, so:
- verify-served can only check `Kosmos.pkg` whole, signed and stapled while a staging pkg is served, never that it is
  the one prod should have;
- a named promote (`--version`, #7005) cannot carry its build's installer, so it leaves `Kosmos.pkg` alone;
- promote decides whether to copy by asking the host, which is a second source of truth.

## The change

1. `tools/lib/write-latest-pointer.js`: optional `KM_LJ_PKG_SHA` adds `pkg_sha256` (a lower-case sha256, refused
   otherwise), after `setup_sha256`. A pointer without it, which is every pointer before this change, reads as before.
2. `tools/release.sh`: the pointer the cut writes names the pkg that cut leaves for its channel: `Kosmos-staging.pkg`
   on a staging cut, `Kosmos.pkg` on a prod cut. Both are checked whole by 3c, so the sha is the one that serves.
3. `tools/publish-staging-pointer.sh`: a hand republish of the SAME build keeps `pkg_sha256`, as it keeps
   `setup_sha256`, and drops it for a different build.
4. `tools/promote-channel.sh`: when the promoted pointer names `pkg_sha256`, the copy onto `Kosmos.pkg` is decided by
   it. `Kosmos.pkg` already that sha: nothing to copy. `Kosmos-staging.pkg` that sha (and served, as now): copied.
   Neither: WARNING, `Kosmos.pkg` left. This works for a named promote too: its pointer is read from its own commit.
   A pointer with no field keeps #8167's behaviour.
5. `tools/verify-served.sh`: when the served `latest.json` names `pkg_sha256`, the served `Kosmos.pkg` must hash to
   it; when the served `latest-staging.json` names one, `Kosmos-staging.pkg` must hash to it.

## Not in this change

- `deploy-site.sh` refusing a `Kosmos.pkg` that is not the committed pointer's: verify-served reports it, and a
  refusal at deploy time needs its own first-deploy plan (a site holding an older pointer).
- The pkg sha in the signed manifest. The manifest describes the app tarball, and the pkg is payload-free.

## Weakest premise

That a pointer naming its pkg is right when the pkg did not change between two builds. Two consecutive pointers then
name the same sha, which is correct: the installer is the same file.

## Review round 1

- BLOCKER, fixed: a prod cut writes BOTH pkg names but only latest.json, so latest-staging.json keeps naming the older
  staging pkg, and verify-served would have failed the prod cut's step 9 after its deploy. verify-served now holds a
  served pkg to its pointer strictly only for the channel this run verifies (`KOSMOS_VERIFY_POINTER`, default
  latest.json); the other channel's mismatch is said, not failed.
- WARNING, fixed by the same rule: a promote that could not move the pkg leaves latest.json naming a pkg it does not
  serve; a later staging cut's verify no longer fails on it (a staging cut can neither cause nor repair it).
- WARNING, fixed: a same-build republish keeps pkg_sha256 only while dist/Kosmos-staging.pkg still hashes to it,
  because a prod cut also writes that file.
- WARNING, decided: a pointer freeze copies an older pointer over both channels and leaves Kosmos.pkg. If the frozen
  build's pkg differs, a prod verify now reds on Kosmos.pkg. That red is intended: it says the Download button is not
  serving the frozen build's installer, which is true, and the freeze tool already says to replace the pkg by hand.
- NITs, fixed: two stale comments; tests for the staging-pointer red arm and both cross-channel arms.

## Review round 2

- WARNING, fixed: a named promote compares the cut's commit with a later same-build republish ignoring only
  setup_sha256, so a republish that dropped pkg_sha256 would have been refused. pkg_sha256 is ignored there too; a
  test proves the pair still "points at the same build", and the nested-field refusal test still refuses.
- WARNING, fixed: both promote warnings that leave latest.json naming a pkg the Download button does not serve now
  say a prod verify will red until it is put right; the "neither" warning says "missing or broken".
- WARNING, settled by reading: a freeze cannot fail a cut's own verify, because no cut starts while the site is
  frozen (release.sh, kosmos#6620 block).
- CONVENTION, settled by reading: the pointer write (step 4) always runs after 3c in the one linear script; a re-run
  runs 3c again.
- NIT, settled by reading: the cut passes KOSMOS_VERIFY_POINTER="$POINTER_FILE" to verify-served (step 9).

## Review round 3

- WARNING, fixed: docs/staging-channel.md now gives promote's two rules (the pointer names its pkg, or it does not),
  including that a `--version` promote whose pointer names its pkg now carries it, and says how verify-served holds
  each pkg to its channel's pointer.
- NITs, fixed: verify-served's comment block (no longer claims nothing records prod's pkg) and its "names no pkg"
  message (also covers a hand republish); a comment on why an unreadable pointer fails on either channel; promote
  validates the pointer's pkg_sha256 shape and says so when it is malformed; a test arm checks its tool's exit code.
- NITs, deferred: verify-served fetches the channel pointer a second time instead of reusing its earlier read; a CDN
  disagreement between the two reads is absorbed by step 9's six-read retry. publish-staging-pointer.sh names
  `Kosmos-staging.pkg` literally because it does not load pkg-inputs.sh; it hashes the pkg bytes only, and
  verify-served checks the whole triple.
