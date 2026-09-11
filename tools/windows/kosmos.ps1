# The Windows agent's `kosmos` command, for PowerShell. Shipped as <zip>\bin\kosmos.ps1
# by tools/build-kosmos-windows.sh; engine/win32launch.js puts <zip>\bin on the
# agent's PATH, and PowerShell resolves a bare `kosmos` to this script.
#
# The arguments travel to Node as JSON in an environment variable, NEVER on a
# command line. Every Windows command-line hop mangles an agent's message: cmd's %*
# kept only the first line of a multi-line reply and ran the tail of a message
# holding `"...&...` as a command (review round 1, measured), and PowerShell 5.1
# drops embedded double quotes on any native command line. JSON in the
# environment is exact for all of them. The flag tells kosmos-cli.js to read it.
$env:KOSMOS_ARGV_JSON = ConvertTo-Json -InputObject @($args) -Compress
try {
  & "$PSScriptRoot\..\runtime\node.exe" "$PSScriptRoot\kosmos-cli.js" --kosmos-argv-from-env
  $code = $LASTEXITCODE
} finally {
  Remove-Item Env:KOSMOS_ARGV_JSON -ErrorAction SilentlyContinue
}
exit $code
