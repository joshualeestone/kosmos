# Fix docs/staging-channel.md step 5 + document the interim promote-deploy runbook

## Why

Split from #2195 (the durable guarded promote tool, deferred as a careful fresh build). The DOC is
safe + decoupled + independently valuable, so it ships now: a promote-before-#2195 must not be
re-derived from memory.

## The bug in the doc

docs/staging-channel.md step 5 said "Deploy the promoted pointer (the next `tools/deploy-site.sh
--publish` carries it)." That is WRONG. Discovered during the first-ever prod promote (0.6.30,
2026-09-04): `deploy-site.sh` is a site-COPY tool whose committed-vs-live pointer guard (#2014)
REFUSES a pointer-move by design ("a site-copy deploy must never move the installer pointer"). So it
cannot publish a promote at all.

## The fix (doc only)

Rewrite step 5 to:
- state that `promote-channel.sh` only rewrites `latest.json` LOCALLY (prod keeps serving the old
  version until a deploy),
- state that `deploy-site.sh --publish` does NOT promote (and why),
- give the INTERIM manual runbook: the proven `release.sh` step-8 machinery
  (`site_deploy_export` + `vercel deploy --prod`) that was actually run for 0.6.30, with the
  artifacts-must-be-local note (site_deploy_export carries, does not fetch) and the served-by-content
  verification (the control that returns the dangerous answer is "still `<old V>`"),
- point at #2195 as the durable guarded `--promote` mode that replaces the manual path.
Also fix step 6 (rollback) to re-deploy per step 5.

## Scope

Doc only (docs/staging-channel.md). No code, no tool. The tool is #2195 (deferred, designed). The
manual runbook is the interim until it lands.
