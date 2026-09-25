# win-publish-r2-3725: Homer publishes Windows builds to R2 from the Windows PC

Addresses #3725.

## Problem
installkosmos.com 307s every Windows name (versioned zips, sidecars, alias, latest-win.json,
latest-win-staging.json) to the public R2 bucket kosmos-dist-win. publish-kosmos-windows.sh and
promote-channel.sh --family win only write a site checkout's dist/, and nothing in the repo uploads
to R2, so every Windows release was a hand upload. Josh ruled 2026-09-25 that Homer releases Windows
independently.

## Decision
tools/windows/publish-r2.ps1, PowerShell 5.1 and 7, SigV4 over R2's S3 API with no AWS tooling.
- Every read that decides a write is a SIGNED read of the bucket (only a 404 means absent); the
  public URL is read only after writing, to confirm what users get.
- Staging: the versioned zip (created with If-None-Match: *), its sidecar, then
  latest-win-staging.json last. Versioned names are immutable; the zip's Kosmos.exe must equal
  the committed launcher byte for byte; -Version must match the version baked into the zip.
- Promote: the gates of promote-channel.sh --family win, case-sensitive. The staging pointer must
  name the approved version and sha in canonical bytes; the staged zip and its sidecar are
  checked; a passing verification record is validated through win-staging-record.js; the staging
  snapshot is re-checked; the go is logged before any write. Then the alias copy (pinned by
  ETag), the alias sidecar (both read back), latest-win.json last as the staging bytes verbatim,
  and a re-check of the versioned zip and sidecar.
- tools/windows/RELEASING.md is the runbook.
- tools/test-publish-r2-3725.sh: parse, the signer against AWS's published SigV4 example,
  pointer byte parity, offline refusals, and the gates and write order through the script's
  test transport (a local directory as the bucket). Wired into test:shell.

## Rejected
- Porting the whole build to PowerShell: the build already runs from Git Bash on the PC (Homer
  built 0.6.94 there). Out of scope.
- Reusing aws-cli on the PC: an extra install for three PUTs and a copy.
- Giving Homer the existing account-wide R2 token: he needs least privilege. A bucket-scoped
  Object Read & Write token is Josh's to create; the clicks are on #3725.

## Weakest premise
The script was measured on macOS pwsh 7, not on Windows PowerShell 5.1. HttpClient, the
Authenticode check and %LOCALAPPDATA% paths are first exercised on Homer's PC. The -DryRun
first-run step in RELEASING.md exists for that reason.
