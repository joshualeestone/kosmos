# ship-pkg: the installer .pkg is guarded by ALL its inputs, and the release ships it

## Finished looks like
1. `pkg_input_sha` covers everything Baron's build consumes: pkg-scripts, pkg-resources
   (Welcome/Conclusion), the build script (the distribution.xml template lives in it),
   and the identifier. Editing any of them changes the sha (controls in
   tools/test-pkg-input-guard.sh); a missing input refuses rather than hashing less.
2. release.sh builds, signs, notarises and publishes Kosmos.pkg (+ .sha256 + .inputs)
   whenever the served pkg's inputs differ from source or the sidecar is missing, BEFORE
   the site commit/deploy, and step 9c reds if the served sidecar does not match source
   after the deploy. verify-served.sh checks the served pkg against its own sha256 and
   its inputs sidecar against source. Baron's hand-publish of 16:36 is the last one.

## Why
The pkg is payload-free and rebuilt only when its inputs change, so it goes stale
silently (Splinter's B ruling, #638). The first guard hashed pkg-scripts only; Baron's
#665 made the pkg a Distribution package with screens (#662/#663) and a template inside
the build script, none of which the guard could see. And release.sh has no pkg step at
all: Baron's installer fixes reach nobody unless someone hand-publishes.

## Changes
- tools/lib/pkg-inputs.sh: four inputs, sectioned, all-or-nothing.
- tools/test-pkg-input-guard.sh: controls for each new input and each refusal.
- tools/release.sh: a pkg step between the bundle build and the site commit; 9c verifies.
- tools/verify-served.sh: the served pkg's sha256 and inputs.
- tools/build-installer-pkg.sh: emits Kosmos.pkg.inputs from the shared function (already
  on this branch).

## Not in this change
Anything about what the pkg's postinstall does (Baron's), or the site's download button.
