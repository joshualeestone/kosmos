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

## C1 built (22:3x) and review 1 (22:3x): 0 blockers, 6 warnings, 3 nits, all handled
Built: tools/lib/release-linux.sh (decide / check_manifest / publish / site_paths), release.sh steps 1d-linux, 4,
publish, 6, _site_paths, the post-commit cleanup and step 8; release_site_restore's Linux arms; write-latest-pointer's
optional `versioned`. Test tools/test-release-linux-7281.sh: 55 checks, the lib against a fake site with a stub signer
in a temp copy (no seam in shipped code), plus structural checks that release.sh wires each call.
- W1 FIXED: after 7b the Linux manifest, .sig and a first Linux pointer stayed untracked in the shared checkout, so the
  next pull refused. Removed like the Mac manifest (checked by its loop; mutant red).
- W2 FIXED (half): step 8 refuses an export without kosmos-$V-linux-x64.tar.gz and a verifying .sha256 (mutant red).
  The other half, a LATER deploy from a checkout without the Linux tarball, is C3's (deploy-site refetches the live
  Linux pair as it does the Mac's $ART).
- W3 FIXED: the Linux versioned files are removed on abort only on the Linux pair's own record (_linux_pair_had, a 7th
  release_site_restore argument defaulting to 1 = never remove); a served Linux tarball on a checkout without the Mac
  tarball survives (tested both ways; mutant red).
- W4 FIXED: a prod Linux cut is refused until C2 makes the promote move the Linux pointer too
  (RELEASE_LINUX_PROMOTE_LOCKSTEP=1, which C2 sets in release.sh when it lands). Staging-only meanwhile (mutant red).
- W5 FIXED: structural checks for every call site and its refusal (each removal red).
- W6 FIXED: the manifest's version must equal V (mutant red).
- NITs FIXED: manifest immutability (mutant red); a note when KOSMOS_ALLOW_STALE_TUNNEL also covers the Linux
  connector; the signer-refusal test has its control.

## C1 review 2 (22:4x): 0 blockers, 2 warnings, 1 nit, all fixed
- W1 FIXED: the prod guard was an environment variable an operator could set by hand before C2. It is now read from
  promote-channel.sh itself (`release_linux_promote_in_lockstep`: does it name latest-linux.json?), so it cannot be
  bypassed and C2 lifts it by landing. Tested: refused today, a variable does not lift it, a promote-channel.sh that
  names the Linux pointer does; the shipped one does not yet (mutant red).
- W2 FIXED: tools/publish-staging-pointer.sh re-pointed latest-staging.json alone. It now refuses while the staging
  channel publishes the Linux family (pointer on disk or on origin/main): a cut moves both (tested with a control).
- NIT FIXED: step 8 also requires the committed Linux pointer's sha256 to equal the exported tarball's .sha256.
- Reviewer checked: _linux_pair_had is defined before the full trap on every path (set -u safe), recorded before any
  Linux write to the site; step 8 cannot pass on another version's tarball; the cleanup precedes the ff-merge and
  removes exactly what would block it. Existing tests for every touched file: 12 files, all rc 0.

## C1 review 3 (22:5x): 0 blockers, 1 warning, 3 nits, all fixed. CONVERGED.
- WARNING FIXED: the prod guard grepped promote-channel.sh for any mention of latest-linux.json, so a comment would
  lift it. It now needs one exact line, `PROMOTE_MOVES_LINUX=1` (grep -x), which C2 adds beside the code that moves
  the Linux pointer. Tested: a comment naming the file keeps prod refused; the marker lifts it; the shipped file has
  none (mutant back to the mention grep: red).
- NIT FIXED: step 8's check moved into the lib as release_linux_export_ok and is tested on behaviour (pass; pointer
  naming other bytes; missing pointer; missing tarball; tarball not matching its .sha256). Mutants: the tie off, the
  wrong JSON field: red.
- NIT FIXED: publish-staging-pointer's origin/main arm is tested (mutant red).
- NIT RECORDED: the guard reads the checkout's promote-channel.sh, not the frozen tree's. Behind main it refuses
  (safe); AHEAD of main (C2 local, unmerged) it would lift while the frozen cut lacks C2. release.sh step 1 requires
  the checkout to carry what ships, and C2 is one PR; accepted.
Test: 67 checks.
