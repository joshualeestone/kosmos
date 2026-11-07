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
