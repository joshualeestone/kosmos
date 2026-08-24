# ship-pkg: the installer .pkg is guarded by ALL its inputs, and the release ships it

## Finished looks like
1. `pkg_input_sha` covers everything Baron's build consumes: pkg-scripts, pkg-resources
   (Welcome/Conclusion) and the build script (the distribution.xml template and the
   identifier live in it). Editing any of them changes the sha, and a same-length edit,
   an mtime touch, a version bump and a dotfile are each proven to do what they should
   (controls in tools/test-pkg-input-guard.sh); a missing or unreadable input refuses
   rather than hashing less.
2. release.sh (step 3c, after the suite and page gate, BEFORE step 4 copies the cache-immutable
   versioned tarball, so a notarisation flake never costs a version bump) builds,
   signs, notarises and publishes Kosmos.pkg + .sha256 + .inputs whenever the SITE DIST's
   copy (what the next deploy will serve) is missing, has no sidecar, was built from
   other inputs, disagrees with its checksum, or has a sidecar vouching for other bytes;
   otherwise it says why not. Step 9c then reads the SERVED host, six reads, and names
   the fact that failed. verify-served.sh checks the served pkg's inputs, checksum,
   signature, staple, and that the sidecar vouches for the served bytes. The sidecar is
   two lines: the input sha and the pkg's own sha256. Baron's hand-publishes are the last.
   Until the next release publishes the first sidecar, `verify-served` is red on the
   pkg lines by design (the served pkg predates the guard); that first red is not an
   outage.

## Why
The pkg is payload-free and rebuilt only when its inputs change, so it goes stale
silently (Splinter's B ruling, #638). The first guard hashed pkg-scripts only; Baron's
#665 made the pkg a Distribution package with screens (#662/#663) and a template inside
the build script, none of which the guard could see. And release.sh has no pkg step at
all: Baron's installer fixes reach nobody unless someone hand-publishes.

## Changes
- tools/lib/pkg-inputs.sh: three paths (the identifier rides inside the build script), sectioned,
  framed, all-or-nothing (unreadable file, unsearchable directory or symlink refuses).
- tools/test-pkg-input-guard.sh: controls for each new input and each refusal.
- tools/release.sh: step 3c (before the bundle build) publishes the triple into the site dist when
  needed and evaluates .vercelignore with git; 9c verifies the served host after the deploy.
- tools/verify-served.sh: the served pkg's sha256 and inputs.
- tools/build-installer-pkg.sh: emits Kosmos.pkg.inputs from the shared function (already
  on this branch).

## Not in this change
Anything about what the pkg's postinstall does (Baron's), or the site's download button.
