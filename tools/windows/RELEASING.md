# Releasing Kosmos for Windows from the Windows PC

Josh ruled on 2026-09-25 that Homer releases Windows builds on his own, with no Mac step (#3725).
This page covers the whole path. Every step runs on the Windows PC. Prod still moves only on Josh's go.

## Where users are served from

installkosmos.com answers every Windows name under `/dist/` with a 307 redirect to the public R2
bucket `kosmos-dist-win`. That covers the versioned zips and their `.sha256` files, the alias
`kosmos-win-x64.zip` and its sidecar, `latest-win.json` and `latest-win-staging.json`. **Publishing
means writing to that bucket.** No site deploy is involved, because the site's wildcard redirects
already cover every version.

`publish-kosmos-windows.sh` and `promote-channel.sh --family win` only write a site checkout's
`dist/`, which users never see for these names. They stay as the reference for the file set and the
gates. `publish-r2.ps1` produces the same files with the same gates, directly in R2.

## One-time setup

1. **The R2 key.** Use the existing R2 API token `kosmos-windows-deploy`. It should have
   **Object Read & Write** on the one bucket `kosmos-dist-win` and nothing else. If it has
   wider scope, ask the Cloudflare account owner for a bucket-scoped one (the steps are on
   #3725). An R2 token comes with an S3 Access Key ID and Secret Access Key, and those two,
   plus the account id, are what this script uses. Save the three values to
   `%LOCALAPPDATA%\Kosmos\release-secrets\r2-dist-win.env`:

   ```
   R2_ACCOUNT_ID=<32 hex>
   R2_ACCESS_KEY_ID=<access key id>
   R2_SECRET_ACCESS_KEY=<secret access key>
   ```

   Then restrict the folder to your own user:
   `icacls "$env:LOCALAPPDATA\Kosmos\release-secrets" /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F"`
   in PowerShell (in Command Prompt the same line uses `%LOCALAPPDATA%` and `%USERNAME%`).
   The script never prints the secret.
2. **Tools.** Git for Windows (bash, curl, unzip), node, and PowerShell (5.1 or 7). The build also
   needs `zip` and `shasum` on the bash PATH. Git for Windows ships `shasum` but not `zip`.

   The commands below use `pwsh` (PowerShell 7). With only Windows PowerShell 5.1, whose default
   execution policy blocks scripts, run them as
   `powershell -ExecutionPolicy Bypass -File tools\windows\publish-r2.ps1 <the same arguments>`.

## Each release

1. **Build** from a clean checkout of `main`. A dirty tree is flagged in the zip's manifest, and
   `win-staging-verify.js` refuses to verify it.

   ```
   bash tools/build-kosmos-windows.sh
   ```

   This produces `dist/kosmos-win-x64.zip`. The launcher inside it is the committed, signed
   `tools/windows/Kosmos.exe` (#3677).

2. **Stage.** This checks that the zip's `Kosmos.exe` is byte for byte the committed launcher (and
   Authenticode Valid), then uploads the versioned zip, its sidecar, and `latest-win-staging.json`
   **last**, and reads every file back through installkosmos.com. Prod does not move. Everything
   that decides whether to write is read from the bucket itself with the key, so a slow or
   challenging edge produces a refusal, never a wrong write.

   ```
   pwsh tools\windows\publish-r2.ps1 -Zip dist\kosmos-win-x64.zip -DryRun   # reads and checks only
   pwsh tools\windows\publish-r2.ps1 -Zip dist\kosmos-win-x64.zip
   ```

   A versioned name is immutable. Re-staging the same bytes uploads them again unchanged and
   rewrites `latest-win-staging.json` to name them, so re-staging an OLDER build moves staging
   back to it. Different bytes under a published version are refused: bump the version instead.
   `-ReplaceVersioned` overrides that only for a staged build nobody was told about, and never for
   the version prod names. Windows builds are x64 and versions are x.y.z; nothing else is accepted.

3. **Verify** the staged build on this PC. This writes the verification record that the promote
   requires.

   ```
   node tools/win-staging-verify.js
   node tools/win-staging-verify.js --yes --for-sha <sha> --attest install=pass ...   # as it prints
   ```

4. **Ask Josh** for a go on that exact version and sha256.

5. **Promote, only on his go.** The script refuses unless all of these hold:
   - the staging pointer names exactly this version and sha, in the canonical shape below, and the
     staged zip and its sidecar hold exactly those bytes (all read from the bucket, case-sensitive),
   - his message reference is well formed, and it is logged before any write,
   - this PC holds a passing verification record for that sha.

   It then copies the staged zip to the alias `kosmos-win-x64.zip` inside R2, pinned to the exact
   object it just checked, rewrites the alias sidecar, and reads both back from the bucket. Only
   then does it write `latest-win.json`, as the staging pointer's bytes verbatim, and read all
   three back as users are served them. If anything fails after `latest-win.json` is written, the
   refusal says so; re-run the same command to finish.

   ```
   pwsh tools\windows\publish-r2.ps1 -Promote -ApprovedVersion <v> -ApprovedSha <sha> -ApprovalRef <Slack ts or permalink> -DryRun
   pwsh tools\windows\publish-r2.ps1 -Promote -ApprovedVersion <v> -ApprovedSha <sha> -ApprovalRef <Slack ts or permalink>
   ```

## Records and guarantees

- **Josh's go is logged on the PC that promotes**, in `%USERPROFILE%\.claude\logs\win-promote-approvals.log`
  (or `KOSMOS_WIN_PROMOTE_LOG`), in `promote-channel.sh`'s line format with `path=promote-r2`
  (not `path=promote`) plus `bucket=` and `prefix=`, so a self-test never reads as a real promote.
  A Windows promote from the PC is therefore NOT in the Mac's log. The durable record of the go
  is his message itself, which the log line names by `approval_ref`.
- **R2 enforces the two conditional writes this script relies on** (measured 2026-09-25 against
  the real bucket): a create with `If-None-Match: *` over an existing key, and a copy with a
  stale `x-amz-copy-source-if-match`, both fail with PreconditionFailed and change nothing.
  `-DryRun` does not issue them.
- **Overwritten objects are stored `Cache-Control: no-cache`** (the pointers, the alias and its
  sidecar), so nothing between R2 and a user keeps serving the previous bytes. Versioned zips
  never change, so they carry no such header.

## The pointer shape

Both pointers have exactly this shape, the one `tools/lib/write-latest-win-pointer.js` writes:

```
{"version":"<v>","sha256":"<sha>","artifact":"kosmos-win-x64.zip","versioned":"kosmos-<v>-win-x64.zip","arch":"x64"}
```

`artifact` is **always the alias**, even in the staging pointer. That is what lets a promote copy the
staging pointer onto prod byte for byte. A staging pointer whose `artifact` is the versioned name
is refused by both promotes. The hand-staged 0.6.94 pointer (2026-09-25) had that shape, so
re-stage it with `publish-r2.ps1` before promoting it.
