# Install Kosmos on Windows. UNSIGNED PREVIEW.
#
# Josh, 2026-08-29: "Let's ship one unsigned to see it function."
#
# Six things (kosmos#1112): the bundle is here, it was verified at build time,
# unpack it somewhere sensible, a Start Menu shortcut, start at login, and
# uninstall cleanly.
#
# 🛑 THIS RUNS ON A STRANGER'S MACHINE AND IT DELETES THINGS. Every destructive
# step below is gated on proof that the target is ours, and every step that can
# fail after the copy has begun is wrapped, because the worst outcome here is
# not an install that refuses -- it is an install that half-succeeds and leaves
# somebody with no working copy and no message they can act on.

$ErrorActionPreference = 'Stop'

function Say  { param($m) Write-Host "     $m" }
function Step { param($m) Write-Host "";  Write-Host "==> $m" }
function Die  { param($m) Write-Host ""; Write-Host "  $m" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  Kosmos for Windows (unsigned preview)"

# ── where Windows says we may install ────────────────────────────────────────
# 🛑 CHECKED BEFORE IT IS USED. `Join-Path` takes a mandatory [string[]], so a
# null here throws "Cannot bind argument to parameter 'Path' because it is
# null" -- which is safe (nothing destructive has run) and completely
# unactionable for the person reading it. In PowerShell assigning '' to an env
# var REMOVES it, so empty and unset are the same case.
if (-not $env:LOCALAPPDATA) {
  Die "Windows did not tell us where to install (LOCALAPPDATA is not set). This usually means the installer was run from an unusual context. Try running it from your own user account."
}

$Source  = Split-Path -Parent $MyInvocation.MyCommand.Path
$Install = Join-Path $env:LOCALAPPDATA 'Kosmos'

# ── refuse to install onto ourselves ─────────────────────────────────────────
# ⚠️ -LiteralPath, NOT -Path. `Resolve-Path` treats its argument as a WILDCARD,
# so a folder containing [ or ] -- e.g. "Kosmos [1]", exactly what a second
# download produces -- fails to resolve. The previous version swallowed that in
# an empty catch and silently skipped this guard.
#
# ⚠️ AND IT CHECKS CONTAINMENT, NOT ONLY EQUALITY. If the extracted folder sits
# anywhere UNDER the install directory, an equality test passes and the
# Remove-Item below deletes the running installer's own source mid-run.
$srcFull = $null
try { $srcFull = (Resolve-Path -LiteralPath $Source).ProviderPath.TrimEnd('\') }
catch { Die "Could not work out where this installer is running from. ($($_.Exception.Message))" }
$dstFull = $Install.TrimEnd('\')

if ($srcFull -ieq $dstFull) { Die "This copy is already the installed one ($Install). Nothing to do." }
if ($srcFull.StartsWith($dstFull + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
  Die "This installer is running from inside $Install. Move the extracted folder somewhere else (your Downloads folder is fine) and run it again."
}

# ── is the download complete? ────────────────────────────────────────────────
# Checked BEFORE touching the destination, because a partial extraction is the
# likeliest real failure and it produces a board that installs and then dies at
# the first request.
Step "checking the download"
foreach ($p in @('app\server.js', 'app\engine', 'app\web', 'Kosmos.cmd')) {
  if (-not (Test-Path (Join-Path $Source $p))) {
    Die "The download is incomplete: $p is missing. Please download and extract it again."
  }
}
# ⚠️ COUNTS REAL MODULES, NOT *.test.js. An earlier version counted both, so a
# staging failure that dropped every real module while keeping the tests would
# have passed this floor. A floor made of the wrong population is not a floor.
$engineCount = @(Get-ChildItem (Join-Path $Source 'app\engine') -Filter *.js |
                 Where-Object { $_.Name -notlike '*.test.js' }).Count
if ($engineCount -lt 40) {
  Die "The download is incomplete: only $engineCount engine modules, expected 40 or more. Please download and extract it again."
}
Say "$engineCount engine modules, and the web files, are present"

# ── the runtime ──────────────────────────────────────────────────────────────
# A full bundle carries node.exe and skips this entirely. A thin bundle carries
# runtime/runtime.json naming what to fetch and what it must hash to.
#
# 🛑 THE CHECKSUM IS RE-VERIFIED HERE AND NOT TAKEN ON TRUST. runtime.json
# travels with the download, so anything that could tamper with the download
# could tamper with it. Re-hashing what actually landed is the check that means
# something; the manifest only says which bytes to expect.
$NodeExe = Join-Path $Source 'runtime\node.exe'
if (-not (Test-Path $NodeExe)) {
  $manifest = Join-Path $Source 'runtime\runtime.json'
  if (-not (Test-Path $manifest)) {
    Die "This download has neither a runtime nor a runtime.json saying where to get one. Please download it again."
  }
  $r = Get-Content $manifest -Raw | ConvertFrom-Json

  Step "fetching the Node runtime, v$($r.version)-win-$($r.arch)"
  Say "about 36 MB, from nodejs.org"

  # ⚠️ TLS 1.2 EXPLICITLY. Windows PowerShell 5.1 inherits SecurityProtocol from
  # .NET Framework, which on older builds is Ssl3+Tls. nodejs.org requires 1.2+,
  # and the failure reads "Could not create SSL/TLS secure channel", which tells
  # a person nothing about what to do.
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

  $tmp = Join-Path $env:TEMP ("kosmos-node-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  $zip = Join-Path $tmp 'node.zip'
  $prevProgress = $ProgressPreference
  try {
    # Progress rendering makes Invoke-WebRequest dramatically slower on a large
    # file and nobody is watching a percentage during an install.
    $ProgressPreference = 'SilentlyContinue'
    # ⚠️ A corporate proxy returns 407 without these, and the message a person
    # gets otherwise is about the internet being down, which it is not.
    Invoke-WebRequest -Uri $r.url -OutFile $zip -UseBasicParsing `
      -Proxy ([Net.WebRequest]::DefaultWebProxy) -ProxyUseDefaultCredentials
  } catch {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    $m = $_.Exception.Message
    if ($m -match '407|proxy')      { Die "A network proxy refused the download. Ask whoever manages this computer to allow nodejs.org, or use the full Kosmos download, which needs no internet during install. ($m)" }
    elseif ($m -match 'SSL|TLS')    { Die "This computer could not make a secure connection to nodejs.org, which usually means it needs Windows updates. The full Kosmos download needs no internet during install and avoids this. ($m)" }
    else                            { Die "Could not download the Node runtime from $($r.url). Check the internet connection and run this again. ($m)" }
  } finally {
    $ProgressPreference = $prevProgress
  }

  Step "verifying it"
  try {
    $got  = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    $want = $r.zip_sha256.ToLower()
    if ($got -ne $want) {
      Die "The Node runtime download does not match its expected checksum, so it is NOT being installed.`n     expected $want`n     got      $got`n     This usually means the download was corrupted. Try again; if it keeps happening, say so rather than working around it."
    }
    Say "sha256 matches"

    Step "unpacking the runtime"
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $inner = Join-Path $tmp "node-v$($r.version)-win-$($r.arch)"
    New-Item -ItemType Directory -Path (Join-Path $Source 'runtime') -Force | Out-Null
    Copy-Item (Join-Path $inner 'node.exe') (Join-Path $Source 'runtime\node.exe') -Force
    if (Test-Path (Join-Path $inner 'LICENSE')) {
      Copy-Item (Join-Path $inner 'LICENSE') (Join-Path $Source 'runtime\LICENSE') -Force
    }
    Say "runtime ready"
  } finally {
    # A failed run otherwise leaves 36 MB in %TEMP% that nobody knows about.
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# ── replacing an existing install ────────────────────────────────────────────
Step "installing to $Install"
if (Test-Path $Install) {
  # 🛑 PROVE IT IS OURS BEFORE DELETING IT. The only previous test was "a folder
  # named Kosmos exists", so anything already at that name -- another vendor's,
  # or a folder somebody made -- was recursively deleted with no confirmation.
  # This file is meticulous about not killing unrelated node.exe processes and
  # was careless about an unrelated directory tree.
  if (-not (Test-Path (Join-Path $Install 'app\server.js'))) {
    Die "There is already a folder at $Install and it does not look like a Kosmos install (no app\server.js). Refusing to delete it. Move or rename it, then run this again."
  }
  # 🛑 AND REFUSE A REPARSE POINT. Windows PowerShell 5.1's Remove-Item -Recurse
  # descends into junctions and symlinks and deletes what they point AT. People
  # do redirect AppData subfolders.
  $item = Get-Item $Install -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    Die "$Install is a junction or symbolic link, not a real folder. Removing it could delete files somewhere else, so this installer will not touch it. Remove the link yourself and run this again."
  }

  Say "an existing install is here, replacing it"
  # Stop a running board first, or the copy fails on a locked node.exe with a
  # message that does not mention Kosmos.
  #
  # ⚠️ MATCHED ON PATH, never on the name alone: killing every node.exe would
  # take out unrelated Node apps. The trailing separator matters, or
  # "...\KosmosSomethingElse\node.exe" matches too.
  # ⚠️ $_.Path THROWS on a process this user cannot inspect, and
  # ErrorActionPreference='Stop' would turn that into an aborted install about
  # nothing the person did. The try/catch is per-process on purpose.
  $needle = $Install.TrimEnd('\') + '\'
  foreach ($proc in @(Get-Process node -ErrorAction SilentlyContinue)) {
    $procPath = $null
    try { $procPath = $proc.Path } catch { continue }
    if ($procPath -and $procPath.StartsWith($needle, [System.StringComparison]::OrdinalIgnoreCase)) {
      Say "stopping the running board (pid $($proc.Id))"
      try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch {
        Die "Kosmos is running and could not be stopped (pid $($proc.Id)). Close it and run this again."
      }
    }
  }
  Start-Sleep -Milliseconds 500
  try { Remove-Item $Install -Recurse -Force }
  catch { Die "Could not remove the previous install at $Install. Close any window showing that folder, and anything running from it, then try again. ($($_.Exception.Message))" }
}

# 🛑 EVERY STATEMENT FROM HERE TO THE END OF THE COPY IS WRAPPED. These were the
# only unguarded lines in the file, and they run AFTER the previous install has
# been deleted -- so a locked file or an access-denied produced a raw .NET
# exception and a machine with no working install and no readable message.
try {
  New-Item -ItemType Directory -Path $Install -Force | Out-Null
  Copy-Item (Join-Path $Source 'app')        $Install -Recurse -Force
  Copy-Item (Join-Path $Source 'runtime')    $Install -Recurse -Force
  Copy-Item (Join-Path $Source 'Kosmos.cmd') $Install -Force
  foreach ($extra in @('open-board.cmd', 'README.txt')) {
    if (Test-Path (Join-Path $Source $extra)) { Copy-Item (Join-Path $Source $extra) $Install -Force }
  }
} catch {
  Die "Could not copy Kosmos into $Install. Close anything using that folder and run this again. If it keeps failing, say so rather than working around it. ($($_.Exception.Message))"
}
Say "copied"

# ── where the app itself says it keeps data ──────────────────────────────────
# 🛑 ASK THE APP, DO NOT RESTATE IT. The previous version told the person their
# projects were in %LOCALAPPDATA%\AgentWorkforce. The app's own resolver returns
# a DIFFERENT folder, so the one message whose entire job is reassurance was
# wrong, and a person looking there after an uninstall would find nothing and
# conclude their work had been destroyed.
# ⇒ One resolver, one answer. This cannot drift, because it is not a copy.
$DataDir = $null
try {
  $DataDir = & (Join-Path $Install 'runtime\node.exe') -e "process.stdout.write(require('./engine/store').ROOT)" 2>$null
  if ($LASTEXITCODE -ne 0) { $DataDir = $null }
} catch { $DataDir = $null }
if ([string]::IsNullOrWhiteSpace($DataDir)) {
  # Not fatal: the install is fine, we simply cannot name the folder. Saying
  # nothing is better than naming the wrong one.
  $DataDir = $null
  Say "note: could not ask Kosmos where it keeps its files; the uninstaller will not name the folder"
} else {
  Say "your projects will live in $DataDir"
}

# ── shortcuts ────────────────────────────────────────────────────────────────
# 🛑 A SHORTCUT IS CONVENIENCE. THE INSTALL IS NOT. Measured on Server 2022:
# running as LocalSystem, APPDATA's Start Menu directory does not exist, so
# CreateShortcut threw and -- with ErrorActionPreference='Stop' -- took the
# WHOLE INSTALL down after the app had copied successfully.
Step "adding shortcuts"
$launch = Join-Path $Install 'Kosmos.cmd'

function New-KosmosShortcut {
  param($RelPath, $Target, $WorkDir, $Desc, $Label)
  try {
    # ⚠️ APPDATA IS READ INSIDE THE FUNCTION. In the previous version the caller
    # built the path, so a null APPDATA threw a parameter-binding error at the
    # CALL SITE, outside this catch -- reintroducing the exact regression the
    # try/catch was added to fix.
    if (-not $env:APPDATA) { Write-Host "     no APPDATA, skipping the $Label shortcut" -ForegroundColor Yellow; return $false }
    $LinkPath = Join-Path $env:APPDATA $RelPath
    $parent = Split-Path -Parent $LinkPath
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($LinkPath)
    $sc.TargetPath = $Target; $sc.WorkingDirectory = $WorkDir; $sc.Description = $Desc
    $sc.Save()
    Say $Label
    return $true
  } catch {
    Write-Host "     could not create the $Label shortcut, continuing anyway" -ForegroundColor Yellow
    Write-Host "     ($($_.Exception.Message))" -ForegroundColor DarkGray
    return $false
  }
}

$menuOk = New-KosmosShortcut -RelPath 'Microsoft\Windows\Start Menu\Programs\Kosmos.lnk' `
  -Target $launch -WorkDir $Install -Desc 'Kosmos' -Label 'Start Menu'

# Start at login. A Startup-folder shortcut rather than a Run registry key or a
# Scheduled Task: it is per-user, needs no elevation, and the person can see and
# delete it themselves in shell:startup. A registry key is invisible to anyone
# who did not already know to look.
$loginOk = New-KosmosShortcut -RelPath 'Microsoft\Windows\Start Menu\Programs\Startup\Kosmos.lnk' `
  -Target $launch -WorkDir $Install -Desc 'Kosmos (starts at login)' -Label 'start at login'

# ── the uninstaller ──────────────────────────────────────────────────────────
# 🛑 THE PATH IS NOT INTERPOLATED INTO THE .cmd, AND THAT IS NOT STYLE.
# Set-Content -Encoding ASCII maps every non-ASCII character to '?', so a
# username like Müller produced "C:\Users\M?ller\..." and rmdir silently failed.
# A '%' in a username is legal and is stripped by cmd as an unmatched variable.
# ⇒ The .cmd derives its own location from %~dp0, which has neither problem.
#
# 🛑 AND IT STOPS THE BOARD BY PATH AND CHECKS THE RESULT. The previous version
# used `taskkill /FI "WINDOWTITLE eq Kosmos*"`, which matched NOTHING: the
# launcher starts the board with `start ""`, so the window title is the empty
# string. The board survived, rmdir hit a locked node.exe, and the script
# printed "Done." unconditionally on the next line.
$dataLine = if ($DataDir) { "echo Your projects are still in `"$DataDir`"." } else { "echo Your projects have not been touched." }
$uninstall = @"
@echo off
REM Remove Kosmos. Leaves your DATA alone on purpose: that is your projects,
REM not the program.
setlocal
set "KOSMOS_HERE=%~dp0"
REM Run from TEMP: rmdir cannot remove the directory it is sitting in.
cd /d "%TEMP%"
echo Stopping Kosmos...
powershell -NoProfile -Command "`$here = `$env:KOSMOS_HERE.ToLower(); Get-Process node -EA SilentlyContinue | Where-Object { `$_.Path -and `$_.Path.ToLower().StartsWith(`$here) } | Stop-Process -Force" >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Kosmos.lnk" >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Kosmos.lnk" >nul 2>&1
echo Removing "%KOSMOS_HERE%"...
rmdir /s /q "%KOSMOS_HERE%"
if exist "%KOSMOS_HERE%" (
  echo.
  echo Some files could not be removed. Kosmos may still be running.
  echo Close it, then run this again.
) else (
  echo Done.
  $dataLine
)
pause
"@
Set-Content -Path (Join-Path $Install 'Uninstall Kosmos.cmd') -Value $uninstall -Encoding OEM
Say "Uninstall Kosmos.cmd"

# ── go ───────────────────────────────────────────────────────────────────────
Step "starting Kosmos"
try { Start-Process -FilePath $launch -WorkingDirectory $Install }
catch { Write-Host "     could not start it automatically; run $launch yourself" -ForegroundColor Yellow }

Write-Host ""
if (-not $menuOk -or -not $loginOk) {
  Write-Host "  Note: one or more shortcuts could not be created, which is cosmetic." -ForegroundColor Yellow
  Write-Host "  Kosmos is installed and working. Start it any time by running:" -ForegroundColor Yellow
  Write-Host "    $launch" -ForegroundColor Yellow
  Write-Host ""
}
Write-Host "  Installed. Kosmos should open in your browser in a moment."
Write-Host ""
Write-Host "  A small black window stays open while Kosmos is running."
Write-Host "  Closing it stops Kosmos."
Write-Host ""
Write-Host "  It will also start automatically when you log in. To stop that,"
Write-Host "  press Windows+R, type  shell:startup  and delete the Kosmos shortcut."
Write-Host ""
Write-Host "  The agents panel will say it cannot see anything running."
Write-Host "  That is correct on a new machine, not a fault."
Write-Host ""
