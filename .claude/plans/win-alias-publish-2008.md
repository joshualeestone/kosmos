# #2008: a stable unversioned Windows alias, so the download button never serves a stale build

## Problem

The Windows download button points at a VERSIONED filename (`kosmos-0.6.24-win-x64.zip`), so it
goes stale on every new Windows build -- the way the Mac button avoids by using the unversioned
`/dist/Kosmos.pkg`. The failure is not a broken link: the stale link keeps returning **200 with
a valid, runnable zip**, so new users silently download an OLD build and file bugs against
something nobody is looking at (a working link to the wrong thing).

## Three facts that shaped the fix (measured; PigeonPete's #1732 investigation, confirmed)

1. `tools/build-kosmos-windows.sh:255` already emits the unversioned name `kosmos-win-$ARCH.zip`.
   The served `kosmos-0.6.24-win-x64.zip` is a hand-rename at publish time, not what the build makes.
2. The release path does NOT publish a Windows zip at all -- `tools/lib/site-deploy.sh` carries
   only `dist/*.tar.gz` and the `Kosmos.pkg` triple. The Windows artifact reaches `/dist` out of band.
3. `tools/verify-served.sh` has zero Windows coverage (PigeonPete owns adding a Windows arm, #1732,
   AFTER the alias exists -- it cannot precede it or it just reds).

## Ownership split (from PigeonPete's #2008 comment)

- **Publish tooling (this PR, mine):** stage the built zip under the stable alias + a versioned copy.
- **Button (Mona Lisa):** point "Download (64-BIT)" at `/dist/kosmos-win-x64.zip`.
- **Served-verify (PigeonPete, #1732):** a Windows arm to verify-served.sh, after the alias is published.

## This PR: the publish tooling

`tools/publish-kosmos-windows.sh <built-zip> [<version>]` stages into the SITE checkout's `dist/`:
- `kosmos-win-<arch>.zip` -- the STABLE ALIAS the button fetches (like Kosmos.pkg for Mac).
- `kosmos-<version>-win-<arch>.zip` -- a versioned copy, for naming an exact build in a bug report.
- a `.sha256` sidecar for each, verified IN PLACE (a pair that cannot verify itself is a refusal).
- `latest-win.json` -- mirrors latest.json (`version`, `sha256`, `artifact`=alias, `versioned`, `arch`),
  so a consumer discovers the current Windows build without hardcoding a name -- which removes
  deploy-site.sh's `KOSMOS_WIN_ZIP` hardcode (#2014).

Key decision: the version is read from the ZIP's OWN `app/package.json` (what the build baked in),
never the repo's current package.json -- so the versioned name and manifest name the artifact that
was actually built, not whatever the tree is now.

## Deliberately NOT in this PR

- **No deploy.** The script stages into the site checkout; the next site deploy (the release cut,
  or tools/deploy-site.sh) carries what is there. Serving the alias is gated on the download button
  going live -- which needed the #2007 launcher token fix (now MERGED) and this alias. There is no
  live button yet, so no rush, and a publish-staging step has no reason to own a production deploy.
- **No button change** (Mona Lisa's lane) and **no verify-served arm** (PigeonPete's #1732, after
  the alias is served).

## Weakest premise

That the arch is x64 only (`KOSMOS_WIN_ARCH`, default x64) -- Windows on ARM would need a second
alias. The build already parameterises ARCH, and the alias name carries it, so a second arch is a
second invocation, not a redesign.

## Test

`node --test tools.publish-windows-2008.test.js` (3 arms, all green): stages the full set and
verifies the sha sidecars name their own files; the version comes from the ZIP not the repo (the
discriminating control -- a fixture at 3.2.1, which differs from the repo version); and it refuses
a missing zip and a zip with no baked version rather than staging a mislabelled artifact. The
script only stages files, so the test RUNS it against a fixture rather than reading its source.
