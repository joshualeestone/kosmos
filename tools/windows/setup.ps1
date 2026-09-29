# Kosmos for Windows: the one-line install.
#
#     irm https://installkosmos.com/setup.ps1 | iex
#
# The Windows twin of install/setup.sh (the Mac's `curl -fsSL .../setup | sh`). It ends where the
# site's download button ends: the signed Kosmos.exe from the published zip runs from a folder
# Windows cleans up, and the launcher does the rest. It installs itself into
# %LOCALAPPDATA%\Programs\Kosmos (KosmosLauncher.cs InstallFromTemporaryPlace), updates an older
# install through the in-app updater's own swap (UpdateInstalledCopy, engine/win32update.js
# --apply --from), or hands off to an installed copy that is the same or newer (never a
# downgrade). This script does not install anything itself and does not reimplement the updater:
# it only fetches, proves and extracts the exact bytes the release pointer names.
#
# WHAT IT CHECKS BEFORE ANYTHING RUNS:
#   1. the zip's SHA-256 equals the release pointer's sha256 (latest-win.json), AND
#   2. the same hash appears in the zip's .sha256 sidecar, AND
#   3. the extracted Kosmos.exe carries a Valid Authenticode signature from Kosmos Agent Manager, Inc.
# The two checksums travel from the same origin as the zip, so they catch corruption, truncation
# and a half-updated CDN, not a compromised origin (the same limit install/setup.sh states). The
# signature is the check that does not travel beside the artifact.
#
# HOW IT BEHAVES UNDER `iex`. The script text runs inside the person's own PowerShell session, so:
#   - everything lives inside one script block, so no variable or preference leaks into their session;
#   - `exit` would close their window, so a failure prints a sentence, sets $LASTEXITCODE to 1 and
#     returns. Run as a file (powershell -File setup.ps1) it exits 1 instead;
#   - no failure ever shows a PowerShell error record; each one says what went wrong and that
#     nothing was installed.
#
# SETTINGS, all from the environment because `irm | iex` cannot pass arguments:
#   KOSMOS_UPDATE_CHANNEL=staging   read latest-win-staging.json instead of latest-win.json (the same
#                                   variable and value install/setup.sh reads for latest-staging.json).
#   KOSMOS_RELEASE_BASE             the download host, default https://installkosmos.com/dist (the same
#                                   variable install/setup.sh and engine/update.js read). Tests point it
#                                   at a local server.
#   KOSMOS_SETUP_TEST_NO_LAUNCH=1   TEST ONLY: do every check and the extraction, then stop before
#                                   running Kosmos.exe and remove what was downloaded.
#
# Written for Windows PowerShell 5.1 (the Windows 11 default) and PowerShell 7 alike. ASCII only:
# 5.1 reads a BOM-less script as the ANSI code page, and `irm` hands `iex` whatever the server sends.

& {
  param([bool] $RunAsFile)

  Set-StrictMode -Version 2
  $ErrorActionPreference = 'Stop'
  # The progress bar makes Invoke-WebRequest many times slower on 5.1; this is local to this block.
  $ProgressPreference = 'SilentlyContinue'

  # The download host. Overridable exactly as install/setup.sh's KOSMOS_RELEASE_BASE is.
  $DEFAULT_RELEASE_BASE = 'https://installkosmos.com/dist'
  # The Authenticode signer every published Kosmos.exe carries (tools/windows/README.md, the
  # certificate subject's common name). Anything else, or no signature, is refused.
  $EXPECTED_SIGNER = 'Kosmos Agent Manager, Inc.'
  # The pointer and the sidecar are a few hundred bytes; a host that has not answered in this
  # long is not going to.
  $SMALL_FILE_TIMEOUT_SECONDS = 30
  # How long to wait for Kosmos.exe to finish installing or updating itself and hand over to the
  # installed copy. The launcher waits up to 15 minutes for another install to finish
  # (InstallLockWaitMs) and the updater up to 10 for its swap; past this, the extracted copy is
  # left in place in case it is still needed.
  $LAUNCHER_WAIT_SECONDS = 30 * 60

  function Say([string] $Text) { Write-Host "  $Text" }

  # A failure the person is told about in plain words. Thrown as a marked exception so the one
  # catch below can tell it from an unexpected error.
  function Refuse([string] $Why) {
    $e = New-Object System.Exception $Why
    $e.Data['KosmosRefusal'] = $true
    throw $e
  }

  function Get-KosmosDownload([string] $Url, [string] $OutFile, [string] $What, [int] $TimeoutSeconds) {
    $arguments = @{ Uri = $Url; OutFile = $OutFile; UseBasicParsing = $true; MaximumRedirection = 5 }
    if ($TimeoutSeconds -gt 0) { $arguments['TimeoutSec'] = $TimeoutSeconds }
    try { Invoke-WebRequest @arguments }
    catch {
      $reason = $_.Exception.Message
      $response = $null
      try { $response = $_.Exception.Response } catch { }
      if ($response) {
        try { $reason = "the server answered $([int]$response.StatusCode)" } catch { }
      }
      Refuse "could not download $What ($reason)."
    }
    if (-not (Test-Path -LiteralPath $OutFile -PathType Leaf)) { Refuse "could not download $What (nothing arrived)." }
  }

  # The bytes as text, whatever content type the host labelled them with: the .sha256 sidecar has
  # been served as application/octet-stream, which Invoke-WebRequest hands back as bytes, not text.
  # Reading the saved file's bytes and decoding them here is the same on 5.1 and 7.
  function Read-TextFile([string] $Path) {
    $text = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($Path))
    return $text.TrimStart([char]0xFEFF)
  }

  function Get-FileSha256([string] $Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

  function Remove-Folder([string] $Path) {
    for ($attempt = 1; $attempt -le 5; $attempt++) {
      if (-not (Test-Path -LiteralPath $Path)) { return $true }
      try { Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop } catch { Start-Sleep -Milliseconds 400 }
    }
    return -not (Test-Path -LiteralPath $Path)
  }

  function Test-IsInside([string] $Child, [string] $Parent) {
    if (-not $Child -or -not $Parent) { return $false }
    $c = $Child.TrimEnd('\', '/')
    $p = $Parent.TrimEnd('\', '/')
    return ($c -ieq $p) -or $c.StartsWith($p + '\', [System.StringComparison]::OrdinalIgnoreCase)
  }

  # Is anything still using the extracted copy? True when a process runs from it, or when Kosmos's
  # engine pointer (%LOCALAPPDATA%\Kosmos\runtime\engine-path, engine/win32anchor.js) names it,
  # which is what happens when the launcher could not install itself and runs Kosmos from here.
  function Test-ExtractedCopyInUse([string] $Folder) {
    $pointer = Join-Path $env:LOCALAPPDATA 'Kosmos\runtime\engine-path'
    if (Test-Path -LiteralPath $pointer -PathType Leaf) {
      $named = (Read-TextFile $pointer).Trim()
      if (Test-IsInside $named $Folder) { return $true }
    }
    foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
      $path = $null
      try { $path = $process.Path } catch { }
      if ($path -and (Test-IsInside $path $Folder)) { return $true }
    }
    return $false
  }

  # A property of a parsed JSON object, or $null when it has none (StrictMode throws on a missing one).
  function Get-Field($Object, [string] $Name) {
    if ($null -eq $Object -or -not ($Object.PSObject.Properties.Name -contains $Name)) { return $null }
    return $Object.$Name
  }

  # What the steps below share with the cleanup at the end. A hashtable, because a function
  # cannot assign to its caller's variables, and $script: under `iex` is the person's own session.
  $state = @{ Work = $null; KeepWork = $false; Launched = $false }

  function Install-Kosmos {
    Write-Host ''
    Say 'Installing Kosmos.'

    if ($env:OS -ne 'Windows_NT') {
      Refuse 'this installer is for Windows. On a Mac, paste this into Terminal instead: curl -fsSL https://installkosmos.com/setup | sh'
    }

    # Windows PowerShell 5.1 can still offer TLS 1.0 first, which the download host refuses. Added
    # to what is allowed, never replacing it, and put back as it was at the end.
    [System.Net.ServicePointManager]::SecurityProtocol = $originalProtocols -bor [System.Net.SecurityProtocolType]::Tls12

    $base = if ($env:KOSMOS_RELEASE_BASE) { $env:KOSMOS_RELEASE_BASE.TrimEnd('/') } else { $DEFAULT_RELEASE_BASE }
    $pointerName = if ($env:KOSMOS_UPDATE_CHANNEL -eq 'staging') { 'latest-win-staging.json' } else { 'latest-win.json' }
    if ($pointerName -ne 'latest-win.json') { Say "Using the staging channel ($pointerName)." }

    $work = Join-Path ([System.IO.Path]::GetTempPath()) ('kosmos-setup-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
    $state.Work = $work
    $downloads = Join-Path $work 'download'
    $extracted = Join-Path $work 'Kosmos'
    New-Item -ItemType Directory -Path $downloads -Force | Out-Null

    # 1. The release pointer. The query string defeats a stale cache in front of the host, as
    # install/setup.sh's ?nocache= does: an old pointer would quietly install an old build.
    Say 'Finding the latest version.'
    $pointerFile = Join-Path $downloads $pointerName
    Get-KosmosDownload "$base/$pointerName`?nocache=$([guid]::NewGuid().ToString('N'))" $pointerFile 'the release information' $SMALL_FILE_TIMEOUT_SECONDS
    try { $pointer = Read-TextFile $pointerFile | ConvertFrom-Json } catch { Refuse 'the release information could not be read.' }
    foreach ($field in 'version', 'sha256', 'versioned', 'arch') {
      $value = Get-Field $pointer $field
      if (-not ($value -is [string]) -or -not $value) { Refuse "the release information is missing its $field." }
    }
    $version = $pointer.version
    $wantSha = $pointer.sha256
    $arch = $pointer.arch
    $versioned = $pointer.versioned
    # The same shape tools/windows/publish-r2.ps1 writes: a lowercase 64-hex hash, and the versioned
    # name built from the version and arch. Checking the name also keeps it a plain file name.
    if ($wantSha -cnotmatch '^[0-9a-f]{64}$') { Refuse 'the release information has an unreadable checksum.' }
    if ($version -notmatch '^[0-9A-Za-z._-]+$' -or $arch -notmatch '^[0-9A-Za-z_]+$' -or $versioned -cne "kosmos-$version-win-$arch.zip") {
      Refuse 'the release information names a download in an unexpected form.'
    }

    # 2. The zip, and its checksum sidecar.
    Say "Downloading Kosmos $version."
    $zip = Join-Path $downloads $versioned
    Get-KosmosDownload "$base/$versioned" $zip "Kosmos $version" 0
    $sidecar = "$zip.sha256"
    Get-KosmosDownload "$base/$versioned.sha256" $sidecar 'the download''s checksum' $SMALL_FILE_TIMEOUT_SECONDS

    # 3. Both checksums, before anything is unpacked.
    Say 'Checking the download.'
    $gotSha = Get-FileSha256 $zip
    if ($gotSha -cne $wantSha) { Refuse 'the download did not arrive intact (its checksum does not match the release information). If this keeps happening, the download site may be mid-update: wait a minute and paste the line again.' }
    $sidecarSha = ((Read-TextFile $sidecar).Trim() -split '\s+')[0].ToLowerInvariant()
    if ($sidecarSha -cne $gotSha) { Refuse 'the download did not match its published checksum. If this keeps happening, the download site may be mid-update: wait a minute and paste the line again.' }

    # 4. Unpack to a fresh folder under %TEMP%. The launcher treats a temporary folder as a place
    # that gets cleaned up, so it copies itself into %LOCALAPPDATA%\Programs\Kosmos and runs from there.
    Say 'Unpacking.'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    try { [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $extracted) }
    catch { Refuse "the download could not be unpacked ($($_.Exception.Message))." }
    Remove-Item -LiteralPath $downloads -Recurse -Force -ErrorAction SilentlyContinue

    $exe = Join-Path $extracted 'Kosmos.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { Refuse 'the download has no Kosmos.exe in it.' }
    $manifestFile = Join-Path $extracted 'manifest.json'
    $manifest = $null
    if (Test-Path -LiteralPath $manifestFile -PathType Leaf) { try { $manifest = Read-TextFile $manifestFile | ConvertFrom-Json } catch { } }
    if ((Get-Field $manifest 'product') -ne 'kosmos' -or (Get-Field $manifest 'platform') -ne 'win32') { Refuse 'the download is not a Kosmos for Windows build.' }

    # 5. The signature, on the exact file that is about to run.
    $signature = Get-AuthenticodeSignature -LiteralPath $exe
    $signer = $null
    if ($signature.SignerCertificate) { $signer = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) }
    if ($signature.Status -ne 'Valid') { Refuse "Kosmos.exe is not validly signed (Windows says: $($signature.Status))." }
    if ($signer -ne $EXPECTED_SIGNER) { Refuse "Kosmos.exe is signed by '$signer', not by $EXPECTED_SIGNER." }
    Say "Checked: Kosmos.exe is signed by $EXPECTED_SIGNER, and the download matches both published checksums."

    # What the launcher is about to do, in words, when Kosmos is already here.
    $installedManifest = Join-Path $env:LOCALAPPDATA 'Programs\Kosmos\manifest.json'
    if (Test-Path -LiteralPath $installedManifest -PathType Leaf) {
      $installedVersion = $null
      try { $installedVersion = Get-Field (Read-TextFile $installedManifest | ConvertFrom-Json) 'version' } catch { }
      if ($installedVersion -and $installedVersion -eq $version) { Say "Kosmos $version is already installed. Opening it." }
      elseif ($installedVersion) { Say "Kosmos $installedVersion is installed. Kosmos checks which is newer, updates if this one is, and never goes back to an older version." }
    }

    if ($env:KOSMOS_SETUP_TEST_NO_LAUNCH -eq '1') {
      Say "Test mode: stopping before opening Kosmos. It would run $exe"
      return
    }

    # 6. Run it, as a double-click would. The launcher shows its own "Installing" window and message
    # boxes; this waits until it has handed over, so the temporary copy can be removed.
    Say 'Opening Kosmos. The first time, it installs itself; this can take a minute.'
    $state.Launched = $true
    $launcher = Start-Process -FilePath $exe -WorkingDirectory $extracted -PassThru
    $null = $launcher.Handle   # 5.1 reports no exit code for a Start-Process child unless its handle was taken
    if (-not $launcher.WaitForExit($LAUNCHER_WAIT_SECONDS * 1000)) {
      $state.KeepWork = $true
      Say "Kosmos is still starting. The copy it started from is left in $extracted in case it still needs it; Windows clears that folder in time."
      return
    }
    # Whatever the launcher decided, the extracted copy stays while anything uses it.
    if (Test-ExtractedCopyInUse $extracted) {
      $state.KeepWork = $true
      Say "Kosmos is running from $extracted for now; please leave that folder alone. It tries to install itself properly the next time you open it."
    }
    if ($launcher.ExitCode -ne 0) {
      Refuse "Kosmos.exe stopped with a problem (code $($launcher.ExitCode)); its own window said what."
    }
    if (-not $state.KeepWork) { Say 'Done. Kosmos is installed and opening. Next time, open it from the Start menu.' }
  }

  $failed = $false
  $originalProtocols = [System.Net.ServicePointManager]::SecurityProtocol
  try { Install-Kosmos }
  catch {
    $failed = $true
    $why = $_.Exception.Message
    if (-not $_.Exception.Data['KosmosRefusal']) { $why = "something unexpected went wrong ($why)." }
    Write-Host ''
    if ($state.Launched) {
      # Past this point the launcher has run, so "nothing was installed" might not be true.
      Write-Host "  Kosmos did not finish opening: $why" -ForegroundColor Red
    }
    else {
      Write-Host "  Kosmos was not installed: $why" -ForegroundColor Red
      Write-Host '  Nothing was installed, and anything downloaded has been removed.'
    }
    Write-Host ''
  }
  finally {
    [System.Net.ServicePointManager]::SecurityProtocol = $originalProtocols
    if ($state.Work -and -not $state.KeepWork) {
      if (-not (Remove-Folder $state.Work)) { Say "(Could not remove the temporary folder $($state.Work); Windows clears it in time.)" }
    }
  }

  if ($failed) {
    $global:LASTEXITCODE = 1
    if ($RunAsFile) { exit 1 }
  }
  else {
    $global:LASTEXITCODE = 0
  }
} ([bool] $PSCommandPath)
