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
- Staging: the versioned zip, its sidecar, then latest-win-staging.json last. The versioned name is
  immutable, and the launcher's Authenticode signature is checked.
- Promote: the gates of promote-channel.sh --family win. The approved version and sha must equal
  the served staging pointer, the approval ref is logged before any write, and a passing
  verification record is validated through win-staging-record.js. Then a server-side copy to the
  alias, the alias sidecar, and latest-win.json last as the staging pointer's bytes verbatim.
- Every write is read back through installkosmos.com.
- tools/windows/RELEASING.md is the runbook.
- tools/test-publish-r2-3725.sh covers parse, pointer byte parity with write-latest-win-pointer.js,
  and the offline refusals. It is wired into test:shell.

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
