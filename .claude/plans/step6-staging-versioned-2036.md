# Plan: release.sh step 6 reads the versioned artifact (staging #2036 gap)

## Why
A full 0.6.29 STAGING cut aborted at step 6 ("what we are about to publish says $V"):
`tar -xzOf "$SITE/dist/kosmos-arm64.tar.gz" app/package.json` read the UNVERSIONED alias.
My #2036 change deliberately leaves that prod alias at the prior PROD version on a staging
cut (only a prod cut / the promote refreshes it), so step 6 read 0.6.28 and refused a correct
0.6.29 staging build. Found by a real end-to-end cut; the #2036 unit/shell tests never run a
full cut through release.sh, so they missed it.

## What
- `tools/release.sh` step 6: read `kosmos-$V-arm64.tar.gz` (the versioned artifact the channel
  pointer names) instead of the alias. Correct for BOTH channels (the versioned artifact always
  carries $V's bytes; a prod cut also has it). One line + a why comment.
- `tools/test-staging-wire-2036.sh`: source guards — step 6 reads the versioned artifact, and no
  longer reads the unversioned alias.

## Decisions / rejected
- Rejected: making step 6 channel-aware (read alias for prod, versioned for staging) — unnecessary;
  the versioned artifact is correct for both, simpler, and less to drift.
- Only line 803's `$SITE/dist/kosmos-arm64.tar.gz` is the bug; the step-4b reads at lines 680/694
  use `$REPO/dist/kosmos-arm64.tar.gz` (the fresh BUILD output alias, = the new version), so they
  are correct and untouched.

## Weakest premise
The guard is a source-drift assertion, not a full end-to-end staging cut in CI (CI cannot run a
live cut). The real end-to-end proof is the re-cut of 0.6.29 after this merges.
