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
# it only fetches, checks and extracts the exact bytes the release pointer names.
#
# WHAT IS TRUSTED, AND WHAT IS NOT:
#   - THE ORIGIN IS TRUSTED. The zip's SHA-256 must equal the release pointer's sha256
#     (latest-win.json) AND the zip's .sha256 sidecar. All three come from the same origin, the
#     download host over HTTPS (installkosmos.com, which redirects to the Kosmos R2 bucket), which
#     also served this very script. So the checksums catch corruption, truncation and a
#     half-updated CDN; they add nothing against a compromised origin. That is the same limit
#     install/setup.sh states for the Mac.
#   - THE SIGNATURE IS DEFENCE IN DEPTH, NOT A CHECK OF THE APP. Kosmos.exe must carry a Valid
#     Authenticode signature whose subject is "Kosmos Agent Manager, Inc." and whose chain runs
#     through Microsoft's ID Verified code-signing CA to Microsoft's Identity Verification root.
#     That proves the launcher came from Kosmos's signing account. It does NOT cover the app\
#     folder, runtime\node.exe's neighbours or anything else in the zip: those are covered only by
#     the checksums, i.e. by trust in the origin.
#   - NO CERTIFICATE THUMBPRINT IS PINNED FOR THE SIGNER. Kosmos signs through Azure Artifact
#     Signing (Trusted Signing), whose certificates last about three days and rotate constantly;
#     a pinned leaf thumbprint would break this installer within days. The name and the
#     Microsoft chain are what stay the same. (The ROOT's thumbprint is matched: that certificate
#     is Microsoft's, valid until 2045.)
#
# HOW IT BEHAVES UNDER `iex`. The script text runs inside the person's own PowerShell session, so:
#   - everything lives inside one script block, so no variable or preference leaks into their session;
#   - `exit` would close their window, so a failure prints a sentence, sets $LASTEXITCODE to 1 and
#     returns. Run as a file (powershell -File setup.ps1) it exits 1 instead;
#   - no failure ever shows a PowerShell error record; each one says what went wrong.
#
# SETTINGS, all from the environment because `irm | iex` cannot pass arguments:
#   KOSMOS_UPDATE_CHANNEL=staging   read latest-win-staging.json instead of latest-win.json (the same
#                                   variable and value install/setup.sh reads for latest-staging.json).
#   KOSMOS_RELEASE_BASE             the download host, default https://installkosmos.com/dist (the same
#                                   variable install/setup.sh and engine/update.js read). Tests point it
#                                   at a local server.
# TEST ONLY (tools.win-setup-ps1.test.js). The two that weaken a check are honoured only together
# with KOSMOS_SETUP_TEST_NO_LAUNCH=1, so they can never apply to a run that starts anything:
#   KOSMOS_SETUP_TEST_NO_LAUNCH=1           do every check and the extraction, then stop before
#                                           running Kosmos.exe and remove what was downloaded.
#   KOSMOS_SETUP_TEST_LAUNCHER=<file.ps1>   run this script (with the extracted folder as its one
#                                           argument) in place of Kosmos.exe, to test what happens
#                                           after the launch without installing anything.
#   KOSMOS_SETUP_TEST_EXPECTED_SIGNER=<cn>  (needs NO_LAUNCH) expect this signer instead.
#   KOSMOS_SETUP_TEST_ZIP_TIMEOUT_SECONDS   (needs NO_LAUNCH) a shorter zip download timeout.
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
  # The Authenticode signer every published Kosmos.exe carries (the certificate subject's common name).
  $EXPECTED_SIGNER = 'Kosmos Agent Manager, Inc.'
  # The chain Kosmos.exe's certificate was issued under, read off the real signature (2026-09-29):
  #   Kosmos Agent Manager, Inc.
  #     <- Microsoft ID Verified CS AOC CA 04            (an issuing CA; the number can change)
  #     <- Microsoft ID Verified Code Signing PCA 2021
  #     <- Microsoft Identity Verification Root Certificate Authority 2020 (thumbprint below, to 2045)
  # Required: the root, by thumbprint, and an intermediate issued to Microsoft's "ID Verified" CAs.
  $EXPECTED_ROOT_THUMBPRINT = 'F40042E2E5F7E8EF8189FED15519AECE42C3BFA2'
  $EXPECTED_INTERMEDIATE_PATTERN = '^CN=Microsoft ID Verified Code Signing PCA [0-9]{4}, O=Microsoft Corporation, C=US\z'
  # The pointer and the sidecar are a few hundred bytes; a host that has not answered in this
  # long is not going to.
  $SMALL_FILE_TIMEOUT_SECONDS = 30
  # The zip is about 39 MB. Fifteen minutes is that size at about 0.35 Mbit/s, slower than any
  # connection someone would install from, yet short enough that a stalled download ends with a
  # sentence instead of a window that hangs for ever. (PowerShell 7 applies it to the whole
  # download; 5.1 applies it to the wait for the server's answer and waits at most 5 minutes on
  # any one read of the body.)
  $ZIP_TIMEOUT_SECONDS = 15 * 60
  # How long to wait for Kosmos.exe to finish installing or updating itself and hand over to the
  # installed copy. The launcher waits up to 15 minutes for another install to finish
  # (InstallLockWaitMs) and the updater up to 10 for its swap; past this, the extracted copy is
  # left in place in case it is still needed.
  $LAUNCHER_WAIT_SECONDS = 30 * 60
  # How often, while waiting, to look for the launcher having settled on running from the extracted
  # copy. Reading one small file; quick enough that the window answers within a moment.
  $LAUNCHER_POLL_MILLISECONDS = 2000
  # A pointer the launcher is writing at that moment cannot be read. Retried this often, this far
  # apart, before the hand-over check gives up and keeps the folder.
  $POINTER_READ_ATTEMPTS = 5
  $POINTER_READ_RETRY_MILLISECONDS = 400

  $testNoLaunch = $env:KOSMOS_SETUP_TEST_NO_LAUNCH -eq '1'
  if ($testNoLaunch -and $env:KOSMOS_SETUP_TEST_EXPECTED_SIGNER) { $EXPECTED_SIGNER = $env:KOSMOS_SETUP_TEST_EXPECTED_SIGNER }
  if ($testNoLaunch -and $env:KOSMOS_SETUP_TEST_ZIP_TIMEOUT_SECONDS) { $ZIP_TIMEOUT_SECONDS = [int] $env:KOSMOS_SETUP_TEST_ZIP_TIMEOUT_SECONDS }

  function Say([string] $Text) { Write-Host "  $Text" }

  # A failure the person is told about in plain words. Thrown as a marked exception so the one
  # catch below can tell it from an unexpected error.
  function Refuse([string] $Why) {
    $e = New-Object System.Exception $Why
    $e.Data['KosmosRefusal'] = $true
    throw $e
  }

  function Test-IsTimeout($Exception) {
    for ($e = $Exception; $e; $e = $e.InnerException) {
      if ($e -is [System.TimeoutException] -or $e -is [System.OperationCanceledException]) { return $true }
      if ($e -is [System.Net.WebException] -and $e.Status -eq [System.Net.WebExceptionStatus]::Timeout) { return $true }
    }
    return $false
  }

  function Get-KosmosDownload([string] $Url, [string] $OutFile, [string] $What, [int] $TimeoutSeconds) {
    try { Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -MaximumRedirection 5 -TimeoutSec $TimeoutSeconds }
    catch {
      if (Test-IsTimeout $_.Exception) {
        $limit = if ($TimeoutSeconds -ge 120) { "$([math]::Round($TimeoutSeconds / 60)) minutes" } else { "$TimeoutSeconds seconds" }
        Refuse "could not download $What (it took longer than $limit). Check the internet connection and paste the line again."
      }
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

  # What Kosmos's engine pointer (%LOCALAPPDATA%\Kosmos\runtime\engine-path, engine/win32anchor.js)
  # says about the extracted copy: 'Names' (the launcher could not install itself and runs Kosmos
  # from here), 'Other' (no pointer, or it names somewhere else), or 'Unknown' (it could not be
  # read, for example because the launcher is writing it at that moment). Never throws.
  function Get-PointerVerdict([string] $Folder, [int] $Attempts) {
    $pointer = Join-Path $env:LOCALAPPDATA 'Kosmos\runtime\engine-path'
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
      try {
        if (-not (Test-Path -LiteralPath $pointer)) { return 'Other' }
        if (Test-IsInside (Read-TextFile $pointer).Trim() $Folder) { return 'Names' }
        return 'Other'
      }
      catch { if ($attempt -lt $Attempts) { Start-Sleep -Milliseconds $POINTER_READ_RETRY_MILLISECONDS } }
    }
    return 'Unknown'
  }

  # Has the launcher finished with the extracted copy? 'Free' only when that is positively known:
  # the pointer was read and names somewhere else, and the process list was read and nothing in
  # it runs from the folder. 'InUse' when something does. 'Unknown' for anything that could not
  # be read. Only 'Free' lets the folder be removed: doubt keeps it. Never throws.
  function Get-ExtractedCopyUse([string] $Folder) {
    $pointer = Get-PointerVerdict $Folder $POINTER_READ_ATTEMPTS
    if ($pointer -eq 'Names') { return 'InUse' }
    if ($pointer -ne 'Other') { return 'Unknown' }
    try { $processes = @(Get-Process -ErrorAction Stop) } catch { return 'Unknown' }
    foreach ($process in $processes) {
      $path = $null
      try { $path = $process.Path } catch { }   # another account's or a protected process: not ours
      if ($path -and (Test-IsInside $path $Folder)) { return 'InUse' }
    }
    return 'Free'
  }

  # A property of a parsed JSON object, or $null when it has none (StrictMode throws on a missing one).
  function Get-Field($Object, [string] $Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]   # indexing, not .Name: an empty {} has no .Name to read
    if ($null -eq $property) { return $null }
    return $property.Value
  }

  # Refuses unless Kosmos.exe is validly signed by $EXPECTED_SIGNER under Microsoft's ID Verified
  # code-signing chain (see WHAT IS TRUSTED at the top).
  function Assert-KosmosSignature([string] $Exe) {
    $signature = Get-AuthenticodeSignature -LiteralPath $Exe
    if ($signature.Status -ne 'Valid') { Refuse "Kosmos.exe is not validly signed (Windows says: $($signature.Status))." }
    $leaf = $signature.SignerCertificate
    $signer = $leaf.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($signer -ne $EXPECTED_SIGNER) { Refuse "Kosmos.exe is signed by '$signer', not by $EXPECTED_SIGNER." }
    # The chain, built with the certificates the signature carries (so a machine that has never
    # seen the intermediates still finds them). Revocation and the leaf's expiry were Authenticode's
    # to judge (a timestamped signature outlives its three-day certificate); this only asks WHO.
    $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
    $chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
    $chain.ChainPolicy.VerificationFlags = [System.Security.Cryptography.X509Certificates.X509VerificationFlags]::IgnoreNotTimeValid
    try {
      $carried = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2Collection
      $carried.Import($Exe)
      [void] $chain.ChainPolicy.ExtraStore.AddRange($carried)
    } catch { }
    [void] $chain.Build($leaf)
    $elements = @($chain.ChainElements | ForEach-Object { $_.Certificate })
    $root = if ($elements.Count) { $elements[$elements.Count - 1] } else { $null }
    $intermediate = @($elements | Where-Object { $_.Subject -match $EXPECTED_INTERMEDIATE_PATTERN })
    if (-not $root -or $root.Thumbprint -ne $EXPECTED_ROOT_THUMBPRINT -or $intermediate.Count -eq 0) {
      $top = if ($root) { $root.Subject } else { 'nothing' }
      Refuse "Kosmos.exe's signature does not come from Microsoft's code-signing service for $EXPECTED_SIGNER (its chain ends at $top)."
    }
  }

  # What the steps below share with the cleanup at the end. A hashtable, because a function
  # cannot assign to its caller's variables, and $script: under `iex` is the person's own session.
  $state = @{ Work = $null; Extracted = $null; KeepWork = $false; Launched = $false }

  function Install-Kosmos {
    Write-Host ''
    Say 'Installing Kosmos.'

    if ($env:OS -ne 'Windows_NT') {
      Refuse 'this installer is for Windows. On a Mac, paste this into Terminal instead: curl -fsSL https://installkosmos.com/setup | sh'
    }

    # TLS. Exactly what this does: when the process is on SystemDefault (the value 0, Windows 11's
    # default, where Windows itself chooses and offers TLS 1.2 and 1.3), nothing is changed, since
    # OR-ing Tls12 into 0 would give "TLS 1.2 only" and turn TLS 1.3 off. When the process holds an
    # explicit list instead (older .NET settings, such as SSL 3 and TLS 1.0 only, which the download
    # host refuses), TLS 1.2 is added to that list and nothing is removed. Put back as it was at the end.
    if ($originalProtocols -ne [System.Net.SecurityProtocolType]::SystemDefault) {
      [System.Net.ServicePointManager]::SecurityProtocol = $originalProtocols -bor [System.Net.SecurityProtocolType]::Tls12
    }

    $base = if ($env:KOSMOS_RELEASE_BASE) { $env:KOSMOS_RELEASE_BASE.TrimEnd('/') } else { $DEFAULT_RELEASE_BASE }
    $pointerName = if ($env:KOSMOS_UPDATE_CHANNEL -eq 'staging') { 'latest-win-staging.json' } else { 'latest-win.json' }
    if ($pointerName -ne 'latest-win.json') { Say "Using the staging channel ($pointerName)." }

    $work = Join-Path ([System.IO.Path]::GetTempPath()) ('kosmos-setup-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
    $state.Work = $work
    $downloads = Join-Path $work 'download'
    $extracted = Join-Path $work 'Kosmos'
    $state.Extracted = $extracted
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
    # \z, not $: in .NET, $ also matches before a final newline, which would let "...\n" through.
    if ($wantSha -cnotmatch '^[0-9a-f]{64}\z') { Refuse 'the release information has an unreadable checksum.' }
    if ($version -notmatch '^[0-9A-Za-z._-]+\z' -or $arch -notmatch '^[0-9A-Za-z_]+\z' -or $versioned -cne "kosmos-$version-win-$arch.zip") {
      Refuse 'the release information names a download in an unexpected form.'
    }

    # 2. The zip, and its checksum sidecar.
    Say "Downloading Kosmos $version."
    $zip = Join-Path $downloads $versioned
    Get-KosmosDownload "$base/$versioned" $zip "Kosmos $version" $ZIP_TIMEOUT_SECONDS
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
    Assert-KosmosSignature $exe
    Say "Checked: Kosmos.exe is signed by $EXPECTED_SIGNER, and the download matches both published checksums."

    # What the launcher is about to do, in words, when Kosmos is already here.
    $installedManifest = Join-Path $env:LOCALAPPDATA 'Programs\Kosmos\manifest.json'
    if (Test-Path -LiteralPath $installedManifest -PathType Leaf) {
      $installedVersion = $null
      try { $installedVersion = Get-Field (Read-TextFile $installedManifest | ConvertFrom-Json) 'version' } catch { }
      if ($installedVersion -and $installedVersion -eq $version) { Say "Kosmos $version is already installed. Opening it." }
      elseif ($installedVersion) { Say "Kosmos $installedVersion is installed. Kosmos checks which is newer, updates if this one is, and never goes back to an older version." }
    }

    if ($testNoLaunch) {
      Say "Test mode: stopping before opening Kosmos. It would run $exe (TLS during the run: $([System.Net.ServicePointManager]::SecurityProtocol))"
      return
    }

    # 6. Run it, as a double-click would. The launcher shows its own "Installing" window and message
    # boxes; this waits until it has handed over, so the temporary copy can be removed.
    # From here on the folder is KEPT unless a hand-over check positively finds it free: a
    # launcher may be running from it, so an error, a check that could not read something, or any
    # other doubt keeps it. Windows clears %TEMP% in time; deleting a running Kosmos is not undone.
    Say 'Opening Kosmos. The first time, it installs itself; this can take a minute.'
    $state.KeepWork = $true
    $state.Launched = $true
    if ($env:KOSMOS_SETUP_TEST_LAUNCHER) {
      $launcher = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru -WorkingDirectory $extracted `
        -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', "`"$env:KOSMOS_SETUP_TEST_LAUNCHER`"", "`"$extracted`"")
    }
    else {
      $launcher = Start-Process -FilePath $exe -WorkingDirectory $extracted -PassThru
    }
    $null = $launcher.Handle   # 5.1 reports no exit code for a Start-Process child unless its handle was taken
    # A launcher that could not install itself runs the board from here and stays running for as
    # long as the board does, so waiting for it to exit would hang this window. The engine pointer
    # naming this folder is the sign of that, and ends the wait at once. (A pointer that cannot be
    # read at that moment is not a sign of anything: the wait goes on.)
    $deadline = (Get-Date).AddSeconds($LAUNCHER_WAIT_SECONDS)
    while (-not $launcher.WaitForExit($LAUNCHER_POLL_MILLISECONDS)) {
      if ((Get-PointerVerdict $extracted 1) -eq 'Names') {
        Say "Kosmos is running from $extracted for now; please leave that folder alone. It tries to install itself properly the next time you open it."
        return
      }
      if ((Get-Date) -gt $deadline) {
        Say "Kosmos is still starting. The copy it started from is left in $extracted in case it still needs it; Windows clears that folder in time."
        return
      }
    }
    $use = Get-ExtractedCopyUse $extracted
    if ($use -eq 'Free') { $state.KeepWork = $false }
    elseif ($use -eq 'InUse') { Say "Kosmos is running from $extracted for now; please leave that folder alone. It tries to install itself properly the next time you open it." }
    else { Say "Could not confirm Kosmos has finished with $extracted, so it is left in place; Windows clears that folder in time." }
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
      if ($state.KeepWork) { Write-Host "  The copy it started from is left in $($state.Extracted) in case it is still in use." }
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
