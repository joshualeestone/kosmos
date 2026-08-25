# build-smoke-sandbox: the bundle build's smoke test sandboxes every root the app's gate names

## Finished looks like
`bash tools/build-kosmos-bundle.sh dist` exits 0 on main again and packs the tarball: its
smoke test sets all four directories the gate (#634, engine/sandbox.js) audits plus an
inert tmux (AGENT_WORKFORCE_DRY_RUN=1). tools/test-build-smoke-sandbox.sh (in test:shell)
runs the gate's own audit over the environment read from the build script, with a control
per root (remove it, the gate refuses), so the build and the gate cannot drift again.

## Why
#715 (77fa120, merged 2026-08-24 evening) made a half-sandboxed board refuse to start. The
smoke test set three of the four directories and no tmux stub, so the build failed at its
own smoke test with the release's step 4 behind it: the next cut could not ship. Found
while building the staged trees for #624. The gate was right; the build was the
half-sandbox it exists to catch.

## Not in this change
tools/test-install.sh's own sandboxed board (checked separately under #624).
