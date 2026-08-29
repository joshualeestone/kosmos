# Install Kosmos on Windows. UNSIGNED PREVIEW.
#
# Josh, 2026-08-29: "Let's ship one unsigned to see it function."
#
# Six things, which is the whole job (see kosmos#1112):
#   1 the bundle is already here, beside this script
#   2 it was verified at BUILD time against nodejs.org's SHASUMS256.txt
#   3 unpack it somewhere sensible
#   4 a Start Menu shortcut
#   5 start at login
#   6 uninstall cleanly

$ErrorActionPreference = 'Stop'

function Say  { param($m) Write-Host "     $m" }
function Step { param($m) Write-Host "";  Write-Host "==> $m" }
function Die  { param($m) Write-Host ""; Write-Host "  $m" -ForegroundColor Red; exit 1 }

$Source  = Split-Path -Parent $MyInvocation.MyCommand.Path
$Install = Join-Path $env:LOCALAPPDATA 'Kosmos'

Write-Host ""
Write-Host "  Kosmos for Windows (unsigned preview)"

# 🛑 REFUSE TO INSTALL ONTO OURSELVES. Running this from inside the install
# directory would copy the tree over itself mid-read. The check is on resolved
# paths, because a shortcut or a mapped drive can spell the same folder two
# ways and a string compare would miss it.
try {
  $srcFull = (Resolve-Path $Source).ProviderPath.TrimEnd('\')
  $dstFull = if (Test-Path $Install) { (Resolve-Path $Install).ProviderPath.TrimEnd('\') } else { $Install.TrimEnd('\') }
  if ($srcFull -ieq $dstFull) {
    Die "This copy is already the installed one ($Install). Nothing to do."
  }
} catch { }

# A bundle that did not unzip fully is the likeliest real failure here, and it
# produces a board that installs cleanly and dies at the first request. Check
# the pieces BEFORE touching the destination.
Step "checking the download"
foreach ($p in @('app\server.js', 'app\engine', 'app\web')) {
  if (-not (Test-Path (Join-Path $Source $p))) {
    Die "The download is incomplete: $p is missing. Please download and extract it again."
  }
}
$engineCount = (Get-ChildItem (Join-Path $Source 'app\engine') -Filter *.js).Count
if ($engineCount -lt 50) {
  Die "The download is incomplete: only $engineCount engine files, expected 50 or more. Please download and extract it again."
}
Say "$engineCount engine modules, runtime and web all present"

# ── the runtime ─────────────────────────────────────────────────────────────
# A thin bundle carries no node.exe; it carries runtime.json naming what to
# fetch and what it must hash to. A full bundle carries the binary and this
# whole block is skipped.
#
# 🛑 THE CHECKSUM IS RE-VERIFIED HERE AND NOT TAKEN ON TRUST. runtime.json is
# a convenience for knowing WHICH bytes to expect, not the authority that they
# arrived intact: the file travels with the download and anything that could
# tamper with the download could tamper with it. Re-hashing what actually
# landed is the check that means something.
$NodeExe = Join-Path $Source 'runtime\node.exe'
if (-not (Test-Path $NodeExe)) {
  $manifest = Join-Path $Source 'runtime\runtime.json'
  if (-not (Test-Path $manifest)) {
    Die "This download has neither a runtime nor a runtime.json saying where to get one. Please download it again."
  }
  $r = Get-Content $manifest -Raw | ConvertFrom-Json

  Step "fetching the Node runtime, v$($r.version)-win-$($r.arch)"
  Say "about 36 MB, from nodejs.org"
  $tmp = Join-Path $env:TEMP ("kosmos-node-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  $zip = Join-Path $tmp 'node.zip'
  try {
    # Progress rendering makes Invoke-WebRequest dramatically slower on a large
    # file, and there is nobody watching a percentage during an install anyway.
    $prev = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $r.url -OutFile $zip -UseBasicParsing
    $ProgressPreference = $prev
  } catch {
    Die "Could not download the Node runtime from $($r.url). Check the internet connection and run this again. ($($_.Exception.Message))"
  }

  Step "verifying it"
  $got = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  $want = $r.zip_sha256.ToLower()
  if ($got -ne $want) {
    Die "The Node runtime download does not match its expected checksum, so it is NOT being installed.`n     expected $want`n     got      $got`n     This can mean a corrupted download. Try again; if it keeps happening, say so rather than working around it."
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
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Say "runtime ready"
}

Step "installing to $Install"
if (Test-Path $Install) {
  Say "an existing install is here, replacing it"
  # Stop a running board first, or the copy fails on a locked node.exe with a
  # message that does not mention Kosmos.
  # ⚠️ `$_.Path` THROWS on a process this user cannot inspect, and
  # $ErrorActionPreference='Stop' would turn that into an aborted install with
  # a message about nothing the person did. The try/catch is per-process on
  # purpose: one unreadable process must not hide the node we are looking for.
  #
  # ⚠️ Matched on PATH, never on the name alone. Killing every `node.exe` would
  # take out unrelated Node apps the person is running, which is a far worse
  # outcome than a failed install.
  foreach ($proc in @(Get-Process node -ErrorAction SilentlyContinue)) {
    $procPath = $null
    try { $procPath = $proc.Path } catch { continue }
    if ($procPath -and $procPath.StartsWith($Install, [System.StringComparison]::OrdinalIgnoreCase)) {
      Say "stopping the running board (pid $($proc.Id))"
      try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch {
        Die "Kosmos is running and could not be stopped (pid $($proc.Id)). Close it and run this again."
      }
    }
  }
  Start-Sleep -Milliseconds 500
  Remove-Item $Install -Recurse -Force
}
New-Item -ItemType Directory -Path $Install -Force | Out-Null
Copy-Item (Join-Path $Source 'app')     $Install -Recurse -Force
Copy-Item (Join-Path $Source 'runtime') $Install -Recurse -Force
Copy-Item (Join-Path $Source 'Kosmos.cmd') $Install -Force
if (Test-Path (Join-Path $Source 'README.txt')) { Copy-Item (Join-Path $Source 'README.txt') $Install -Force }
Say "copied"

Step "adding shortcuts"
$launch = Join-Path $Install 'Kosmos.cmd'

# 🛑 A SHORTCUT IS CONVENIENCE. THE INSTALL IS NOT. Measured on Windows Server
# 2022: running as LocalSystem, `$env:APPDATA` resolves to the system profile
# and its Start Menu\Programs directory does not exist, so `CreateShortcut`
# threw and -- with $ErrorActionPreference='Stop' -- took the WHOLE INSTALL
# down AFTER the app had been copied successfully. The person would have been
# left with a complete, working install and an error message.
#
# ⇒ Create the parent first, and never let a missing shortcut fail the run.
# The launcher in the install folder works regardless.
function New-KosmosShortcut {
  param($LinkPath, $Target, $WorkDir, $Desc, $Label)
  try {
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

$menuOk = New-KosmosShortcut -LinkPath (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Kosmos.lnk') `
  -Target $launch -WorkDir $Install -Desc 'Kosmos' -Label 'Start Menu'

# Start at login. A Startup-folder shortcut rather than a Run registry key or a
# Scheduled Task: it is per-user, needs no elevation, and the person can see and
# delete it themselves in shell:startup. A registry key is invisible to anyone
# who did not already know to look for it.
$loginOk = New-KosmosShortcut -LinkPath (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\Kosmos.lnk') `
  -Target $launch -WorkDir $Install -Desc 'Kosmos (starts at login)' -Label 'start at login'

Step "writing the uninstaller"
$uninstall = @"
@echo off
REM Remove Kosmos. Leaves your DATA alone on purpose: that lives in
REM %LOCALAPPDATA%\AgentWorkforce and is your projects, not the program.
echo Stopping Kosmos...
taskkill /F /IM node.exe /FI "WINDOWTITLE eq Kosmos*" >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Kosmos.lnk" >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Kosmos.lnk" >nul 2>&1
echo Removing "$Install"...
rmdir /s /q "$Install"
echo Done. Your projects are still in %LOCALAPPDATA%\AgentWorkforce.
pause
"@
Set-Content -Path (Join-Path $Install 'Uninstall Kosmos.cmd') -Value $uninstall -Encoding ASCII
Say "Uninstall Kosmos.cmd"

Step "starting Kosmos"
Start-Process -FilePath $launch -WorkingDirectory $Install
Write-Host ""
if (-not $menuOk -or -not $loginOk) {
  Write-Host ""
  Write-Host "  Note: one or more shortcuts could not be created, which is cosmetic." -ForegroundColor Yellow
  Write-Host "  Kosmos is installed and working. Start it any time by running:" -ForegroundColor Yellow
  Write-Host "    $launch" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Installed. Kosmos should open in your browser in a moment."
Write-Host "  If it does not, go to http://127.0.0.1:16180/"
Write-Host ""
Write-Host "  The agents panel will say it cannot see anything running."
Write-Host "  That is correct on a new machine, not a fault."
Write-Host ""
