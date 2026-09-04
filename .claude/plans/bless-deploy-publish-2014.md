# Plan: #2014 — bless deploy-site.sh's --publish (Baron, the designated reviewer)

## Context
`tools/deploy-site.sh` (the standalone site deploy that decouples installkosmos.com web
deploys from release cuts) merged (#2046), but its header carried a REVIEW GATE: "Baron owns
the release/deploy pipeline. Do NOT run --publish until he has reviewed this script." The #2014
comment (2026-09-03 14:58) requested my bless on --publish after my prior review feedback was
addressed. Lifting the gate is my call by designation (the gate names me) and by the
reversibility test (a header-comment change, re-addable).

Blessing it also UNBLOCKS my own stalled Windows 0.6.27 /dist publish: I deploy the Windows zip
with `deploy-site.sh --publish`, which this same gate forbade until I reviewed it.

## What I verified (so "blessed" means genuinely sound, not just "it ran")
- **Pre-deploy guards, exercised** by a hands-on dry run (green): fetch + per-artifact sha-verify
  of the live gitignored artifacts into dist, the export build, and the .vercelignore guard all
  pass. The export carried Kosmos.pkg, kosmos-0.6.27-arm64.tar.gz, tmux-arm64, the unversioned
  alias, the Windows zip, and an honest .kosmos-release-export marker.
- **Post-deploy served verification, reviewed** (only runs under --publish, after a real deploy):
  `served_matches` sha-checks each installer artifact AND its .sha256 sidecar against what was
  deployed; the served latest.json is name-checked for the current artifact; the Windows zip +
  /setup are 200-checked. It deliberately avoids verify-served.sh (the #2014 version-skew BLOCKER
  I flagged: it keys to agent-workforce's package.json, routinely ahead of the site's released
  version in this between-release window) and references the SITE's own version instead. Sound.
- My prior review feedback is in (Decision-1 blocker: tmux + the alias now fetched/verified/
  required; the pkg-inputs.sh sourcing bug for the .vercelignore guard).

## The change
Replace the "🛑 REVIEW GATE ... Do NOT run --publish until reviewed" header with a
"✅ --publish REVIEWED AND BLESSED (Baron, 2026-09-03)" block that records what was verified and
KEEPS the coordination caveat: --publish is a live vercel deploy --prod, so do not run it
concurrent with a release cut on the same dist/, and coordinate with the release owner. The dry
run stays the safe default. Advisory comment only; nothing enforced changes.

## Verification
- `bash -n` and `sh -n` clean.
- No test pins the review-gate header text (grep confirms), so no test regression.
- The --publish path itself is unchanged (only the header comment).
