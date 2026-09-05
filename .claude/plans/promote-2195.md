# Plan: #2195 - `deploy-site.sh --promote` (guarded pointer-move prod deploy)

## Problem
There is no standalone tool for a POINTER-ONLY prod deploy (a "promote"). `deploy-site.sh` is a
site-COPY tool: its committed-vs-live pointer guard (#2014) correctly REFUSES a pointer-move ("a
site-copy deploy must never move the installer pointer"). But a promote intentionally moves it. The
first prod promote (0.6.30, 2026-09-04) was done by running `release.sh` step-8 machinery by hand.
`promote-channel.sh` (#2036) already does the guarded LOCAL pointer move + alias refresh + the
experience/agent-spawn gates, but it does NOT deploy. The missing piece is a guarded DEPLOY that
accepts a moved pointer.

## Approach
Add a `--promote` mode to `tools/deploy-site.sh` (reuses all its existing guards + helpers), rather
than a new script. `--promote` implies `--publish` (a promote deploys). Three surgical changes;
every other guard stays.

1. **Flag parse.** `--promote` -> `PUBLISH=1; PROMOTE=1`. Default `PROMOTE=0`. Unknown args still
   fall through to a dry run (no behaviour change for existing callers).
2. **Artifact source + committed-vs-live guard.** For `--promote`, derive the artifact from the
   COMMITTED pointer (the version being promoted TO), not live (still the prior prod version until
   this deploy). The committed-vs-live guard is SKIPPED (the pointer moved on purpose) and replaced
   by a stronger check: fetch + sha-verify the versioned artifact from live (proving the promoted
   bytes are really served - the staging cut published them, which is what makes a promote a
   pointer-only move) AND assert the committed pointer's advertised sha equals those bytes (guards a
   hand-edited/stale pointer). Also refuse when committed == live (nothing to promote). The
   site-copy path is unchanged and STILL fires the committed-vs-live guard.
3. **Unversioned alias.** For `--promote`, DERIVE `kosmos-arm64.tar.gz` from the just-verified
   versioned artifact (`cp` + `sha256_publish_as`), not fetch the live one - the live alias is still
   the PRIOR prod version until this deploy (a staging cut leaves it there; the promote moves it, per
   `promote-channel.sh` #2036). Fetching it would ship a stale fallback (the #1669 shape). `tmux` is
   version-independent and fetched live in both modes.

Kept unchanged for `--promote`: the honest-marker export check, the `.vercelignore` guard, the
post-deploy served-by-content verify (#1669). `Kosmos.pkg` is version-independent (promote-channel
deliberately never touches it), so `--promote` carries the live pkg unchanged. NOT keyed to
`latest-staging.json` on purpose - a rollback promotes a PRIOR committed pointer and must still work.

## Docs
Fix `docs/staging-channel.md` step 5: name `deploy-site.sh --promote` as the go-live, demote the
manual `release.sh` step-8 heredoc to a documented fallback.

## Tests (red-capable)
`tools/test-deploy-site-promote.sh`: stub `curl` (serves a fake LIVE dir) + stub `vercel`
(publishes the export into LIVE). Cases: --promote deploys a moved pointer; site-copy --publish
STILL refuses a moved pointer (the load-bearing control); the alias is derived from the promoted
bytes; the committed-sha mismatch is refused; nothing-to-promote is refused; the no-flag dry run is
unchanged. Both core behaviors (guard-skip, alias-derive) proven red-capable by breaking the code.

## Workflow for a promote
1. `promote-channel.sh <site> <port>` (runs the gates, moves the pointer + alias LOCALLY).
2. commit `latest.json` + push.
3. `deploy-site.sh --promote` (this change) - the guarded deploy.
4. verify SERVED prod by content.
