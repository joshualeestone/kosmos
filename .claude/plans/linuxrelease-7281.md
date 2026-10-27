# kosmos#7281 slice C: the release publishes the Linux family (branch linuxrelease-7281)

Design (Baron, 2026-10-26 22:3x), written before building so a restarted session can build it without re-deriving.
Slices merged or open: A builder (merged #7288, tools/build-kosmos-linux.sh), B setup.sh (#7292), D engine (built,
branch linuxengine-7281). Whole plan: card comment 6431703337.

## The rule that replaces the card's ordering rule (6432820964)
A board and the setup.sh it spawns disagree (offer X, install Y) only when the Mac pointer and the Linux pointer of a
channel name DIFFERENT versions: a board without slice D reads the Mac pointer, setup.sh with slice B reads the Linux
one. So: **the Linux pointer of a channel only ever moves in lockstep with the Mac pointer of that channel, to the
same version.** A cut writes both at V; a promote moves both. Then no board disagrees with its installer, whether or
not it has slice D, and slice D need not ship first. Weakest premise: a Linux-only or Mac-only hotfix breaks lockstep;
both tools refuse it rather than allow it (an override exists only to skip the Linux family ENTIRELY, see below).

## What to build
1. **release.sh step 4L (after step 4, same frozen tree):** `KOSMOS_TUNNEL_LINUX_BIN` defaults to the relay's
   `dist/kosmos-tunnel-linux-x86_64`; its `.commit` must equal the commit the Mac connector check (step 1d) accepted,
   or step 1d's same currency rule. Run `tools/build-kosmos-linux.sh dist`. Refuse a manifest with an `unchecked:`
   node sha or a connector glibc above 2.35 (slice A records both).
2. **Publish (beside the Mac copy step):** `kosmos-$V-linux-x64.tar.gz` (+ .sha256 via sha256_publish_as),
   `kosmos-$V-linux-x64.manifest.json` + `.sig` (manifest-sign.js, same key), the same immutability refusal as the Mac
   (`refusing to republish $V with different bytes`). Pointer `latest-linux.json` or `latest-linux-staging.json` by
   `$CUT_CHANNEL`, written by tools/lib/write-latest-pointer.js with an optional `KM_LJ_VERSIONED` (slice D reads
   `versioned` + `sha256`); setup_sha256 the same as the Mac pointer's (one setup.sh per cut).
3. **Restore on abort:** the Linux pointer joins the pre-cut backup/restore the Mac pointer has (release_site_restore).
4. **Step 6:** the Linux tarball's app/package.json says $V.
5. **Site commit:** the Linux pointer, manifest and .sig join `_site_paths`; the tarball stays untracked like the Mac's.
6. **promote-channel.sh:** `--family linux` (latest-linux-staging.json -> latest-linux.json, field `versioned`), and a
   Mac promote REFUSES when a Linux staging pointer exists naming another version than the Mac staging pointer, and
   otherwise moves it in the same promote (lockstep). A Linux-only promote is refused.
7. **deploy-site.sh:** the Linux pointers join the setup-floor loop (line ~387) and get the Windows-style
   committed-pointer-vs-bytes derive (the committed pointer's sha256 equals the committed/served tarball's).
8. **KOSMOS_CUT_LINUX=0** skips the Linux family entirely for a cut that cannot build it (no Linux connector yet), and
   says so; it is refused once a Linux pointer is already published on that channel (that would break lockstep).

## Split (each its own PR, in order)
- C1: items 1-5 + 8 (release.sh), tests in the style of tools/test-release-*.sh against a fake site.
- C2: item 6 (promote-channel.sh).
- C3: item 7 (deploy-site.sh).
C1 must not merge before C2 is ready to follow: a staging Linux pointer with no way to promote it is harmless (no
prod pointer), so C1 alone is safe; the lockstep refusal in C2 is what keeps prod consistent.

## Open questions decided here
- The Linux tarball is served from the site's /dist like the Mac's (about 45 MB), not R2 (card's weakest premise).
- No sandboxed install of the Linux bundle in the cut (the cut Mac cannot run it); slice E's CI on stock ubuntu:24.04
  is that check, run against the staging pointer after a staging cut.
