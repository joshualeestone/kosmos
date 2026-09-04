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

## Challenge-loop iteration 1 (blind review: bless justified + accurate, no blockers)
- [NIT, FIXED] header said served_matches checks "against what was deployed"; strictly it compares
  against the LOCAL verified copy (the $EXPORT deployed is rm'd), which equals the deployed bytes
  absent a concurrent cut. Reworded to say so.
- [WARNING, RECORDED for the Windows publish, NOT a bless defect] deploy-site.sh's `WINZIP` default
  is `kosmos-0.6.24-win-x64.zip`. The Windows zip is TRACKED (git-archived, not fetched), and the
  honest-marker check + served_200 key off `$WINZIP`. So my 0.6.27 Windows `--publish` will safe-
  refuse UNLESS (a) the 0.6.27 zip is committed into chaoskosmos-site/dist AND (b) `KOSMOS_WIN_ZIP`
  is exported to name it. => Windows-publish preconditions, on top of the bless: after
  publish-kosmos-windows.sh stages the zip, `git add` it in the site repo (it is tracked, unlike the
  gitignored Mac tarballs), and run `KOSMOS_WIN_ZIP=<the-name> tools/deploy-site.sh --publish`. The
  bless is a genuine prerequisite for the Windows publish, just not the ONLY step.
- [NIT, DEFERRED, pre-existing] deploy-site.sh:233 `grep -q "\"$ART\""` treats the dots in $ART as
  regex; `grep -Fq` would be exact. Vanishingly low risk; not introduced by this diff; out of scope
  for a comment-only bless (kept the PR comment-only, which the reviewer verified). Worth a follow-up.
- [NIT, DEFERRED, pre-existing] the `verify-served.sh must exist` precondition (line 63/73) is dead
  weight since the deploy path deliberately never invokes it. Pre-existing; a tidy-up, not this PR.
