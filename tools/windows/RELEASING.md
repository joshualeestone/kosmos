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

3. **The signed release manifest (#6466), once.** Installs from the first build that carries
   #6466 refuse any update without a release manifest signed by the Kosmos release key (the same
   ed25519 key, `kosmos-manifest-signing`, that signs the Mac's manifest, pinned in
   `engine/manifest-verify.js`). Two things must be true before such a build is staged:
   - **installkosmos.com serves the manifest names.** Installs fetch
     `/dist/kosmos-<v>-win-x64.manifest.json` and `.manifest.json.sig` from installkosmos.com, like the
     zip. Its `/dist` redirect to R2 covers the zip and `.zip.sha256` names only (measured 2026-10-19:
     both manifest names answer 404). The site's `vercel.json` needs the same 307 for these two names
     (`/dist/kosmos-:v-win-x64.manifest.json` and `/dist/kosmos-:v-win-x64.manifest.json.sig` to
     `https://dl.chaoskosmos.com/...`). `publish-r2.ps1` reads both back through the site before it
     moves the staging pointer, so a missing redirect stops the stage instead of stranding installs.
     A promote reads them back again before prod moves. `tools/deploy-site.sh`'s served-redirect
     checks do not cover these two names yet, so a site deploy that drops the redirect is caught only
     at the next stage or promote (installs fail closed meanwhile: they refuse updates, nothing breaks).
   - **Baron signs, on a fleet Mac.** The private key (secrets map target `kosmos-manifest-signing`)
     never comes to the Windows PC (decided 2026-10-19). Baron signs each Windows manifest after
     `-ForSigning` has put it up (the per-release order below).

## Each release, in order (#6466)

1. **Build** (step 1 below). It writes `dist/kosmos-win-x64.zip` and
   `dist/kosmos-<v>-win-x64.manifest.json`.
2. **Put it up for signing**, which moves no pointer:
   `pwsh tools\windows\publish-r2.ps1 -Zip dist\kosmos-win-x64.zip -ForSigning`.
   It runs the stage's checks on the zip, checks the manifest describes the zip file for file,
   uploads only the versioned zip, its `.sha256` and the manifest, reads them back (the manifest from
   `dl.chaoskosmos.com` while installkosmos.com does not redirect it yet, and it says so), and
   prints the version and the manifest's sha256.
3. **Send Baron the version and the manifest sha256** (via Splinter, or kosmos #1050). He fetches
   `kosmos-<v>-win-x64.manifest.json` from `dl.chaoskosmos.com`, checks its sha256 and version
   against what you sent, checks that the zip sha256 it names equals the SERVED zip's, signs it with
   `tools/lib/manifest-sign.js sign`, and uploads `kosmos-<v>-win-x64.manifest.json.sig` beside it,
   or sends you the file.
4. **Wait for the .sig.** Then **stage** (step 2 below): the stage takes the `.sig` from `-Sig <file>`
   when Baron sent a file, else from beside the zip, else from the bucket, and refuses if it does not
   verify against this zip and manifest.
5. **Verify** on this PC (step 3), **ask Josh** (step 4), and **promote** only on his go (step 5).

A rebuild after step 2 makes a new zip and a new manifest: put it up for signing again, and have it
signed again (an old `.sig` no longer verifies, and the stage refuses it).

## Each release, step by step

1. **Build** from a clean checkout of `main`. A dirty tree is flagged in the zip's manifest, and
   `win-staging-verify.js` refuses to verify it.

   **What's new (#4928).** `web/whats-new.json` is built on main from `release/whats-new-pool.json`
   (#5711, see docs/releasing.md); the `"also"` edit below is the only change made to it by hand.
   The build checks that `web/whats-new.json` is for the version it builds
   (`package.json`), as the Mac cut does, and stops otherwise. When this Windows number is the same
   release as the Mac's, add it to the file's `"also"` list (`{"version":"0.7.16","also":["0.7.13"],...}`)
   and COMMIT that on the release branch, beside the version bump, before building (an uncommitted edit
   makes the tree dirty). Add it even when an earlier Windows number already shows these highlights: the
   board does not open the same words twice, and the check stays on. A hotfix with nothing
   to announce: `KOSMOS_CUT_NO_WHATS_NEW=1 bash tools/build-kosmos-windows.sh`. A highlight tagged
   `"platforms": ["mac"]` is not shown on Windows (#5224); if every highlight is Mac-only, this
   build stops: tag one for Windows, or set `KOSMOS_CUT_NO_WHATS_NEW=1`.

   ```
   bash tools/build-kosmos-windows.sh
   ```

   This produces `dist/kosmos-win-x64.zip`. The launcher inside it is the committed, signed
   `tools/windows/Kosmos.exe` (#3677).

   The build also needs the Plus connector (kosmos#4597), signed, with its two sidecars. Build
   it first in a kosmos-relay checkout on an up-to-date `main`:

   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-tunnel-release-windows.ps1 -Sign <the signing script>
   ```

   That writes `dist\kosmos-tunnel.exe` with `.commit` and `.sha256` beside it. The Kosmos build
   reads it from `~/work/kosmos-relay/dist/kosmos-tunnel.exe`, or from `KOSMOS_TUNNEL_BIN`, and
   refuses one that is missing, unsigned, or does not match its sidecars.

1b. **The release manifest (#6466).** The build also writes
   `dist/kosmos-<v>-win-x64.manifest.json` (every file in the zip with its sha256, the zip's sha256,
   the version; the Mac manifest's format plus `"platform": "win32"`). Baron signs it on a fleet Mac
   with the Mac's own step and key, unchanged (`node tools/lib/manifest-sign.js sign <key> <manifest>
   <manifest>.sig`), after `-ForSigning` has put it up: see the order above. The build's
   `KOSMOS_MANIFEST_KEY` switch (sign during the build) is for a computer that holds the key; it is
   not used on the Windows PC. The manifest must be the one written by the same build as the zip.

2. **Stage.** This checks that the zip's `Kosmos.exe` is byte for byte the committed launcher (and,
   on Windows, that its Authenticode signature is Valid), then uploads the versioned zip, its sidecar, and `latest-win-staging.json`
   **last**, and reads every file back through installkosmos.com. Prod does not move. It also checks
   the manifest beside the zip and its `.sig` (from `-Sig`, beside the zip, or the bucket) against the
   zip, file for file, uploads them before the pointer (a `.sig` already in the bucket is not
   rewritten), and confirms installkosmos.com serves both. A build whose updater checks
   signed manifests is refused without one; an older build without one is staged with a NOTICE. Everything
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
   requires. First prove the launcher in it came from its source (#6512): the build's own check reads
   only the order of commits, and CI does not compare the bytes.

   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File tools\windows\verify-launcher.ps1
   ```

   It must end `OK:`. Then:

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
   then does it write `latest-win.json`, as the staging pointer's bytes verbatim, and read the alias, both sidecars, the versioned zip and
   latest-win.json back as users are served them. If anything fails after `latest-win.json` is written, the
   refusal says so; re-run the same command to finish.

   ```
   pwsh tools\windows\publish-r2.ps1 -Promote -ApprovedVersion <v> -ApprovedSha <sha> -ApprovalRef '<Slack ts or permalink>' -DryRun
   pwsh tools\windows\publish-r2.ps1 -Promote -ApprovedVersion <v> -ApprovedSha <sha> -ApprovalRef '<Slack ts or permalink>'
   ```

## What the installed copy checks before an update runs (#6466)

The in-app update (`engine/win32update.js`, run by the INSTALLED copy) reads the pointer, then the
signed manifest and its `.sig`, and checks them against the release key the installed copy pins,
before it downloads the zip: the signature, the version (the pointer's, and not older than the
installed one), and that the manifest names this platform, arch, versioned zip and the pointer's
sha256. A missing, unsigned or mismatched manifest is refused, never waved through, as the Mac's
installed copy does (#6468). After the unpack, every file (`runtime\node.exe`, `app\`, `bin\`, the
connector, the zip's own `manifest.json`, `Kosmos.exe`) must be exactly the manifest's, by sha256,
before anything in it runs. Then `Kosmos.exe`'s Authenticode signature is checked: Valid, the whole
validated subject (`CN="Kosmos Agent Manager, Inc.", O="Kosmos Agent Manager, Inc.", L=Mckinney,
S=Texas, C=US`), the Code Signing EKU, and a chain that builds through Microsoft's ID Verified CA to
the pinned root. No leaf thumbprint is pinned: the certificates rotate every few days.

Not covered, written down: an update installed from a folder the person extracted (`--from`) runs
the NEW copy's own code, so it is trusted the way a fresh install is (the person ran that
`Kosmos.exe`); it is checked for links and its `Kosmos.exe` signature only. The staged tree and a
kept rollback build are not re-checked between the check and the swap. A fresh install
(`setup.ps1`) checks the zip's checksums and the launcher's signature, not the manifest.

**Rotating the key.** `engine/manifest-verify.js` KEYS is a list: ship a release that pins the new
key beside the old one, signed with the old one, before signing with the new one. Losing every
pinned private key means installs refuse updates until Kosmos is installed afresh.

## Records and guarantees

- **One run at a time.** Every stage, replace and promote takes `publish.lock` in the bucket
  (a create with `If-None-Match: *`) before it reads anything it decides on, refreshes it
  before every write (a `touched=` time, pinned to its own copy: if the lock is no longer its
  own, it stops; an undo's restores check it the same way and are skipped, and reported, rather
  than written blind), and removes it when it finishes or refuses. A run killed outright (Ctrl+C,
  closing the window) leaves its lock. A second run meanwhile refuses with the lock's contents
  (which run, which mode, when, which PC). `-BreakLock` removes a lock last touched more than
  35 minutes ago (every request times out at 30), saying whose it was and how old; it refuses
  a younger one. Remove a lock by hand only when you know no run is active. The script still
  detects and undoes a concurrent write, as a second line behind the lock.

- **Josh's go is logged on the PC that promotes**, in `%USERPROFILE%\.claude\logs\win-promote-approvals.log`
  (or `KOSMOS_WIN_PROMOTE_LOG`), in `promote-channel.sh`'s line format with `path=promote-r2`
  (not `path=promote`) plus `bucket=` and `prefix=`, so a self-test never reads as a real promote.
  A Windows promote from the PC is therefore NOT in the Mac's log. The durable record of the go
  is his message itself, which the log line names by `approval_ref`.
- **R2 enforces the three conditional writes this script relies on** (measured 2026-09-25 against
  the real bucket): a create with `If-None-Match: *` over an existing key, and a copy with a
  stale `x-amz-copy-source-if-match`, and a PUT with a stale `If-Match`, all fail with
  PreconditionFailed and change nothing. The PUT pin guards these overwrites: a
  `-ReplaceVersioned` and its put-back, a same-bytes re-stage (when the bucket gives an ETag),
  the alias sidecar, the prod pointer, and the undo's put-backs. NOT pinned: the versioned
  sidecar and latest-win-staging.json on a stage (two stagings of one version at once can
  interleave; the run's served checks catch a mismatch). R2 IGNORES `If-Match` on a DELETE and
  on a COPY's destination (also measured), so the undo's DELETE and COPY check the object with
  a HEAD first and then act, with a moment between the two; the promote's forward alias COPY is
  unpinned at its destination and is read back instead. An R2 ETag is a hash of the bytes, so a byte-identical write by
  someone else reads as this run's own. `-DryRun` issues none of them.
- **Overwritten objects are stored `Cache-Control: no-cache`** (the pointers, the alias and its
  sidecar), so a cache honouring the header revalidates them. That does NOT evict bytes a
  cache already holds from before the header was set: after the first promote from this script
  (the alias was uploaded by hand, without it) and after any -ReplaceVersioned, check that the
  served bytes are the new ones (the script's own served checks do) and purge the cache if not. A versioned zip
  carries no such header, except one replaced with `-ReplaceVersioned`, which is no-cache. Every
  versioned `.sha256` sidecar is no-cache, always (a replace rewrites it; it is a few bytes).

- **`TEST TRANSPORT` in the output means nothing was published**: `KOSMOS_PUBLISH_R2_FAKE_DIR` is
  set (the offline test uses it). `Remove-Item Env:KOSMOS_PUBLISH_R2_FAKE_DIR` and run again.

- **Run these from a PowerShell prompt**, not Command Prompt: cmd.exe keeps single quotes as
  part of the value and splits a command at `&`.
- **Quote the approval ref.** Unquoted at a PowerShell prompt, a Slack ts is read as a number
  and rounded, and a permalink containing `&` becomes a background job. The script refuses a ts
  that is not exactly 10 digits, a dot and 6 digits, and anything else that is not `https://`.
  That is stricter than the Mac side's check (tools/lib/win-approval.sh accepts any string of
  the allowed characters) on purpose: a rounded ts looks plausible there.

## The pointer shape

Both pointers have exactly this shape, the one `tools/lib/write-latest-win-pointer.js` writes:

```
{"version":"<v>","sha256":"<sha>","artifact":"kosmos-win-x64.zip","versioned":"kosmos-<v>-win-x64.zip","arch":"x64"}
```

`artifact` is **always the alias**, even in the staging pointer. That is what lets a promote copy the
staging pointer onto prod byte for byte. A staging pointer whose `artifact` is the versioned name
is refused by both promotes. The hand-staged 0.6.94 pointer (2026-09-25) had that shape, so
re-stage it with `publish-r2.ps1` before promoting it.
