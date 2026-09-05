# Prove the committed Kosmos.exe came from the committed KosmosLauncher.cs.
#
# 🛑 WHY A SCRIPT AND NOT A CHECKSUM IN A README. Baron's condition for allowing a
# binary into the tree (#2086) is that a reviewer can REGENERATE it, not that they
# can be told a hash. A hash in prose proves only that the file has not changed
# since somebody wrote the hash down; it says nothing about whether the source
# beside it is the source it came from.
#
# 🛑 THIS EXE IS NOT BYTE-REPRODUCIBLE, MEASURED, AND THAT IS NOT A DEFECT.
# The only C# compiler on a stock Windows box is the pre-Roslyn one shipped with
# .NET Framework, which has no deterministic switch. Two builds of identical
# source, seconds apart, differ -- measured, 21 bytes of 6656: the PE header's
# TimeDateStamp, the 16-byte MVID (a fresh GUID per compile), and four further
# bytes. Same size, same code.
# ⇒ So the check is a MASKED compare: build twice, let the two builds tell us
# which bytes are build metadata, then compare the committed binary against a
# fresh one everywhere else.
#
# ⭐ THE MASK IS DERIVED, NEVER HARDCODED, and that is the whole reason this is
# trustworthy. A hardcoded offset list would be a second copy of a fact about a
# compiler we do not control: a compiler update that moved or widened those
# fields would leave the list silently masking the wrong bytes -- which is a
# check that hides exactly the difference it exists to find. Deriving the mask
# from two fresh builds on the spot means the masked set is always precisely
# "what this compiler varies between runs", and every byte outside it is
# compared. If a compiler ever varied a byte of real CODE between runs, that byte
# would land in the mask and this check would weaken silently -- so the run also
# reports the mask, and a mask that is not ~21 bytes in two small runs deserves
# a look rather than a shrug.
#
# ⚠️ WINDOWS-ONLY, BY NATURE. Reproducing a Windows PE needs the Windows
# compiler. A reviewer on a Mac cannot run this, which is exactly why the binary
# is committed rather than built during the release: see the note in
# tools/build-kosmos-windows.sh.
#
#   powershell -File tools/windows/verify-launcher.ps1
#
# Exit 0 = the committed exe reproduces from the committed source.

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $here 'KosmosLauncher.cs'
$committed = Join-Path $here 'Kosmos.exe'

# The pinned compiler. Framework64 v4.0.30319 is present on every Windows 10/11
# machine; naming the path rather than searching keeps two runs comparable.
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

# 🔑 ONE definition of the build, shared with tools/build-kosmos-windows.sh's
# comment and with the README. If this list changes, the committed binary must
# be rebuilt in the same commit.
$FLAGS = @('/nologo', '/target:exe', '/optimize+', '/platform:anycpu')

foreach ($p in @($csc, $src, $committed)) {
  if (-not (Test-Path -LiteralPath $p)) { Write-Error "missing: $p"; exit 2 }
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('kosmos-launcher-verify-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  # 🛑 BOTH REBUILDS MUST BE NAMED Kosmos.exe, IN SEPARATE FOLDERS. The output
  # FILE NAME becomes the assembly's module name and is written into the
  # metadata, so building to `one.exe` shifts every heap offset after it and the
  # compare came back with ~2300 bytes differing on a binary that was in fact
  # correct. A verifier whose own scaffolding changes the artifact would have
  # sent the next person hunting a defect in the launcher.
  $dirOne = Join-Path $tmp 'one'; New-Item -ItemType Directory -Force -Path $dirOne | Out-Null
  $dirTwo = Join-Path $tmp 'two'; New-Item -ItemType Directory -Force -Path $dirTwo | Out-Null
  $one = Join-Path $dirOne 'Kosmos.exe'
  $two = Join-Path $dirTwo 'Kosmos.exe'

  & $csc @FLAGS "/out:$one" $src | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Error 'the first rebuild failed'; exit 2 }
  # A second apart, so a per-run timestamp actually differs between the two and
  # lands in the mask. Without this the mask can come back empty on a fast box
  # and the compare silently becomes a plain byte-compare that always fails.
  Start-Sleep -Seconds 2
  & $csc @FLAGS "/out:$two" $src | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Error 'the second rebuild failed'; exit 2 }

  $a = [System.IO.File]::ReadAllBytes($one)
  $b = [System.IO.File]::ReadAllBytes($two)
  $k = [System.IO.File]::ReadAllBytes($committed)

  if ($a.Length -ne $b.Length) { Write-Error "two rebuilds differ in SIZE ($($a.Length) vs $($b.Length)); this compiler is not usable for a masked compare"; exit 1 }
  if ($k.Length -ne $a.Length) {
    Write-Host "MISMATCH: committed Kosmos.exe is $($k.Length) bytes, a fresh build is $($a.Length)."
    Write-Host 'The committed binary did not come from the committed source (or from these flags).'
    exit 1
  }

  # The mask: every byte this compiler varies between two runs of one source.
  $observed = New-Object System.Collections.Generic.List[int]
  for ($i = 0; $i -lt $a.Length; $i++) { if ($a[$i] -ne $b[$i]) { $observed.Add($i) } }

  # 🛑 WIDENED TO WHOLE 32-BIT FIELDS, and this is a correctness fix rather than
  # caution. The varying fields here are 32-bit timestamps, and two builds two
  # seconds apart usually differ in only the LOW byte of each -- so the observed
  # set covers one byte of a four-byte field. The committed binary was built at
  # an arbitrary earlier time, so ITS copy of that field can differ in bytes the
  # two reference builds agreed on, and the compare would report a mismatch on a
  # binary that is in fact correct. If any byte of a 32-bit field varies, the
  # field varies: round each run down to a 4-byte boundary and up to a whole
  # number of words.
  $set = New-Object System.Collections.Generic.HashSet[int]
  foreach ($i in $observed) {
    $start = $i - ($i % 4)
    for ($j = $start; $j -lt $start + 4 -and $j -lt $a.Length; $j++) { [void]$set.Add($j) }
  }
  # And the two PE fields that are variable BY DEFINITION, whether or not these
  # particular two builds happened to disagree on them: the COFF TimeDateStamp
  # and the optional header's CheckSum. Located structurally, so no offset here
  # is a guess about this compiler's layout.
  $peAt = [BitConverter]::ToInt32($a, 0x3C)
  foreach ($off in @(($peAt + 8), ($peAt + 24 + 64))) {
    for ($j = $off; $j -lt $off + 4 -and $j -lt $a.Length; $j++) { [void]$set.Add($j) }
  }
  $mask = @($set) | Sort-Object

  Write-Host ("compiler      : " + (Get-Item $csc).VersionInfo.FileVersion)
  Write-Host ("flags         : " + ($FLAGS -join ' '))
  Write-Host ("size          : " + $a.Length + " bytes")
  Write-Host ("build metadata: " + $mask.Count + " byte(s) vary between two runs")
  if ($mask.Count -gt 0) {
    $shown = ($mask | ForEach-Object { '0x{0:X4}' -f $_ }) -join ' '
    Write-Host ("              : " + $shown)
  }
  if ($mask.Count -gt 64) {
    Write-Host ''
    Write-Host "REFUSED: $($mask.Count) bytes vary between two builds of one source."
    Write-Host 'That is far more than build metadata, so masking them would hide real differences.'
    exit 1
  }

  foreach ($i in $mask) { $a[$i] = 0; $k[$i] = 0 }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $ha = [BitConverter]::ToString($sha.ComputeHash($a)).Replace('-', '')
  $hk = [BitConverter]::ToString($sha.ComputeHash($k)).Replace('-', '')

  Write-Host ("masked rebuild : " + $ha)
  Write-Host ("masked committed: " + $hk)
  Write-Host ''
  if ($ha -eq $hk) {
    Write-Host 'OK: the committed Kosmos.exe reproduces from the committed KosmosLauncher.cs.'
    exit 0
  }

  $n = 0
  for ($i = 0; $i -lt $a.Length; $i++) { if ($a[$i] -ne $k[$i]) { $n++ } }
  Write-Host "MISMATCH: $n byte(s) differ outside the build metadata."
  Write-Host 'The committed binary did not come from the committed source (or from these flags).'
  Write-Host 'Rebuild it in the same commit as the source change:'
  Write-Host ("  " + $csc + ' ' + ($FLAGS -join ' ') + ' /out:tools\windows\Kosmos.exe tools\windows\KosmosLauncher.cs')
  exit 1
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
