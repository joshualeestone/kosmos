# win-setup-ps1: the Windows one-line install

Asked by Josh, 2026-09-29: the site's "Or install from the terminal" box says "Coming soon" for
Windows. He wants `irm https://installkosmos.com/setup.ps1 | iex` to end with Kosmos installed and
open, the same as downloading the zip and running Kosmos.exe.

## Finished looks like

- `tools/windows/setup.ps1`, ready for the site to serve at /setup.ps1 (the site repo is separate).
- Under `irm | iex` in Windows PowerShell 5.1 and PowerShell 7, as a normal user: read
  latest-win.json (latest-win-staging.json under KOSMOS_UPDATE_CHANNEL=staging, the variable
  install/setup.sh reads), download the versioned zip through the site's redirect with TLS 1.2
  allowed, refuse unless its SHA-256 equals the pointer's AND the sidecar's (sidecar decoded from
  bytes, it is served as octet-stream), extract under %TEMP%, refuse unless Kosmos.exe is Valid
  and signed by Kosmos Agent Manager, Inc., run it.
- Plain sentences on every failure, "nothing was installed", no error records, non-zero
  $LASTEXITCODE, never `exit` under iex. Nothing downloaded is left on failure.

## Decisions

- No reimplementation of install or update. KosmosLauncher.cs RunInstallerDuties already treats
  a copy under %TEMP% as a temporary place: it installs itself to %LOCALAPPDATA%\Programs\Kosmos
  (win32relocate.js --move, which copies), updates a stale install through win32update.js
  --apply --from (which copies into its own staging folder), or hands off to the installed copy
  when that is the same or newer. So the extracted folder is not needed once the launcher exits
  having handed over. The script waits for the launcher, then removes the folder unless the
  engine pointer names it or a process runs from it (the launcher's fallback of running in place).
- KOSMOS_RELEASE_BASE is the override the tests use, matching install/setup.sh and
  engine/update.js, rather than a new test-only variable. The signature check still guards a
  host override.
- KOSMOS_SETUP_TEST_NO_LAUNCH=1 is the one test-only seam: every check and the extraction run,
  then the script stops before Kosmos.exe and cleans up.
- The checksums share the zip's origin (the limit install/setup.sh states); the Authenticode
  check is the one that does not.

## Tests

`tools.win-setup-ps1.test.js` (selected by tools/windows-tests.js as `tools.win-*`), Windows
only except the two static checks: good path under powershell.exe and pwsh when present, pointer
sha mismatch, sidecar mismatch, missing sidecar, missing pointer, pointer name outside the
published shape, unsigned exe, exe signed by someone else, staging channel, no session leak under
iex, exit 1 as a file, ASCII only, `exit` only in the run-as-file branch.

## Review round 1 (Pete, 2026-09-29)

- Blocker fixed: once the launcher has started, the extracted folder is kept unless a hand-over
  check positively finds it free (pointer read and naming elsewhere, process list read and nothing
  running from it). An unreadable pointer, an unreadable process list or any error keeps it.
- A test-only stand-in launcher (KOSMOS_SETUP_TEST_LAUNCHER) covers the launch step: handed over,
  process still running, pointer naming the folder, pointer naming it while the launcher stays,
  pointer held open, launcher failing.
- Signer: CN plus a chain through "Microsoft ID Verified Code Signing PCA <year>" to Microsoft
  Identity Verification Root CA 2020 (root matched by thumbprint). No leaf pin: Artifact Signing
  certs live about three days. Weakest part: that chain is shared by every Artifact Signing
  customer (node.exe uses it), so the CN is what names Kosmos; the chain only says Microsoft
  verified that name.
- TLS: SystemDefault is left alone (OR-ing Tls12 into 0 meant TLS 1.2 only); an explicit list
  gains Tls12. Regexes end in \z. The zip download times out after 15 minutes.

## Not done here

- Serving /setup.ps1 is the site team's job.
- The real launch was not run on the orchestrator box: Kosmos is installed there and runs the
  fleet, and a launch can trigger an in-place update.
