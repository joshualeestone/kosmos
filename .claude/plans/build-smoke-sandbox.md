# build-smoke-sandbox: the bundle build's smoke test sandboxes every root the app's gate names

## Finished looks like
`bash tools/build-kosmos-bundle.sh dist` exits 0 on main again and packs the tarball: its
smoke test sets all four directories the gate (#634, engine/sandbox.js) audits plus an
inert tmux (AGENT_WORKFORCE_DRY_RUN=1). tools/test-install.sh exports the same four roots,
DRY_RUN=1, and the two roots the gate does not name (claude config, config root), so the
boards it installs start and never touch the operator's real config. tools/
test-build-smoke-sandbox.sh (in test:shell) runs the gate's own audit over the environment
read from each tool's source, with a control per root (remove it, the gate refuses) and a
sweep of the harness's later blocks for an unset or emptied root, so the tools and the gate
cannot drift again.

## Why
#715 (77fa120, merged 2026-08-24 evening) made a half-sandboxed board refuse to start. The
smoke test set three of the four directories and no tmux stub, so the build failed at its
own smoke test with the release's step 4 behind it: the next cut could not ship. Found
while building the staged trees for #624. The gate was right; the build was the
half-sandbox it exists to catch.

## Not in this change
The seven home-folder icon failures in tools/test-install.sh (the harness's seeded stale
bundles predate #664/#665's uid-baked launcher, so bundle_is_ours reads them as foreign):
Baron's fixtures. And install/kosmos's stale comment that "the harness sets TMUX_BIN".
