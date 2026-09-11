# The Windows agent's `kosmos` command, for PowerShell. Shipped as <zip>\bin\kosmos.ps1
# by tools/build-kosmos-windows.sh; engine/win32launch.js puts <zip>\bin on the
# agent's PATH, and PowerShell resolves a bare `kosmos` to this script.
#
# The arguments travel to Node as JSON in a private temp file, NEVER on a command
# line. Every Windows command-line hop mangles an agent's message: cmd's %* kept
# only the first line of a multi-line reply and ran the tail of a message holding
# `"...&...` as a command (review round 1, measured), and PowerShell 5.1 drops
# embedded double quotes on any native command line. A FILE, not an environment
# variable: one variable holds at most ~32K characters, and a room post may be
# 64 KB (review round 2). The flag tells kosmos-cli.js where to read.
#
# Every failure is exit 1 and says so. Without Stop, a missing node.exe was a
# non-terminating error and `exit $null` reported SUCCESS for a message nobody sent.
$ErrorActionPreference = 'Stop'
$argvFile = $null
try {
  $argvFile = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'kosmos-argv-' + [Guid]::NewGuid().ToString('N') + '.json')
  [IO.File]::WriteAllText($argvFile, (ConvertTo-Json -InputObject @($args) -Compress -Depth 5), (New-Object Text.UTF8Encoding $false))
  & "$PSScriptRoot\..\runtime\node.exe" "$PSScriptRoot\kosmos-cli.js" --kosmos-argv-file $argvFile
  $code = $LASTEXITCODE
} catch {
  [Console]::Error.WriteLine('kosmos could not run: ' + $_.Exception.Message)
  $code = 1
} finally {
  if ($argvFile) { Remove-Item -LiteralPath $argvFile -Force -ErrorAction SilentlyContinue }
}
if ($null -eq $code) { $code = 1 }
exit $code
