# publish-atomic-3073b: post-deploy /setup <-> /setup.sha256 edge-consistency check

**Branch:** `publish-atomic-3073b` (off origin/main) · **Lane:** deploy-site.sh publish-atomicity
hardening (my #3073 lane; Splinter's theory-a task). PR-for-Baron-review, NOT auto-merge (Baron owns
the #2014-blessed release/deploy pipeline).

## The problem this closes

The .pkg postinstall fetches BOTH `/setup` and `/setup.sha256` and REFUSES the install (the #1666
"installation failed" surface) when they do not agree. deploy-site.sh's post-deploy served-verify
already sha-checks the tarball/pkg/tmux + sidecars and (on --promote) pins the committed latest.json
sha to the served bytes, but `/setup` was only `served_verify_asset_ok` (a 200 + non-html
content-type) at deploy-site.sh:522 -- it was NOT verified against its own `/setup.sha256`. So a
half-published or half-warmed-CDN state where the edge serves a mismatched (setup, setup.sha256)
pair would pass deploy-site's certification while every client hits "installation failed".

## The change (deploy-site.sh, right after the /setup 200-check at :522)

Post-deploy, re-fetch the served `/setup` and served `/setup.sha256` from the edge (Cache-Control:
no-cache), and refuse to certify unless `shasum(served /setup) == advertised /setup.sha256`. Two
refusal branches: the sidecar is unreachable (the postinstall refuses when it cannot fetch it), and
the pair mismatches. This is the exact pair the postinstall verifies -- it makes deploy-site refuse
the same state a client would refuse, instead of certifying it.

## Tests (tools/test-deploy-site-exit0-2791.sh)

- B1 (success) still passes -- fixture now publishes a matching `$live/setup.sha256` (the sibling-fixture
  gap: without it the new check 404s the happy path -- the #3073-shaped trap where new safety code
  breaks sibling tests). Same fixture fix applied to test-deploy-site-promote.sh's two scenarios.
- **B3-CONTROL (new):** a served /setup whose /setup.sha256 advertises a DIFFERENT hash REFUSES
  (rc!=0). Proves the sha-comparison branch is not vacuous.
- **B4-CONTROL (new):** an UNREACHABLE /setup.sha256 REFUSES (rc!=0). Proves the fetch-fail branch
  fires, distinct from B3.
- All four deploy-site test files pass (branch-guard-3073, exit0-2791, promote, winderive); `sh -n`
  clean; em-dash clean.

## Scope decisions (decide-and-continue; documented rather than silently dropped)

The original scope note listed three sub-parts. I am shipping ONE and deferring two, with reasons:

1. **SHIP: /setup <-> /setup.sha256 edge-check.** Highest value -- it is the exact pair the .pkg
   postinstall verifies, the direct #1666 belt-and-suspenders. Additive (a new post-deploy refusal,
   same shape as the existing served-verify block); changes no deploy behavior on the happy path.

2. **DEFER: latest.json-sha vs served-tarball on the NON-PROMOTE path.** Redundant there: the
   non-promote (site-copy) path is gated by the CJ==LJ committed-vs-live guard (:304), so the pointer
   does not move and the served latest.json already equals live with its sha already describing served
   bytes. The --promote path already pins committed-sha to fetched bytes (:313-315). Marginal
   additional coverage for real added surface; not worth expanding this PR under the P0 clock.

3. **DEFER to a Baron follow-up: CDN purge+warm of /setup + /setup.sha256 after the alias swap.**
   This is a real behavior change to Baron's blessed release script and needs his input on the
   mechanism (static vs @vercel/blob) -- exactly the "coordinate with Baron" item. I raise it as a
   follow-up question in the PR rather than bolt an unreviewed purge mechanism onto the release path.

## Weakest premise

That the edge-check belongs in deploy-site.sh's post-deploy block at all when Baron's P0 re-serve
path (site_deploy_export + vercel --prod directly) BYPASSES this block. It does -- so for the P0
re-serve the manual verify checklist is the safety net (co-signed with Baron at prod-promote time).
This hardening is for the NORMAL deploy-site path, where it makes the tool refuse a mismatched-edge
state it currently certifies. The two are complementary, not redundant: one hardens the tool, the
other covers the one deploy that skips the tool.
