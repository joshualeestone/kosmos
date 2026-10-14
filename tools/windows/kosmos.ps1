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
# 64 KB (review round 2). kosmos-cli.js deletes it as soon as it has read it.
#
# Each argument goes as the TEXT the agent typed ([string] keeps `007` and `1kb`,
# where PowerShell's own number would send 7 and 1024); anything that is not a
# plain value (a list, a table) goes as itself, so kosmos-cli.js refuses it
# rather than sending different words (review rounds 2 and 3).
#
# Exit codes: the CLI's own (0, 1, 2, 3 for "maybe") come back unchanged, and a
# failure here is 1 with a sentence. Stop is set ONLY around what this script does
# itself: under `2>&1` PowerShell turns node's stderr into error records, and Stop
# there would turn every refusal and every "maybe" into a 1 (review round 3).
#
# NEVER READ $input IN THIS FILE (win32-cli-verbs, review round 1, measured). Under
# `powershell -File`, merely referencing $input makes PowerShell wait for its stdin
# to close, and a tool runner can hold that pipe open for good: every verb hung,
# `kosmos reply` included. Gating it on $MyInvocation.ExpectingInput, or reading it
# only for `feedback write`, did not help. So PowerShell pipeline input does not
# reach the CLI; every verb that reads stdin says how to hand the text over instead
# (an argument, a here-string, or --body-file <file> since #5946).
#
# #5946: what this file DOES read is $MyInvocation.ExpectingInput, a flag on the call
# itself that is true when something was piped into `kosmos`. Reading it never touches
# $input or stdin (measured: no verb waits on an open stdin with it). When it is true the
# CLI is told with --kosmos-ps-pipeline, so a verb that wanted piped text says at once
# that it did not arrive and names --body-file, instead of waiting on a stdin that is
# not the agent's text.
# One exception, measured: `powershell -File kosmos.ps1 ...` with stdin redirected also
# reads as ExpectingInput (the host feeds its stdin to the script), and there node DOES
# get that stdin, so `printf report | powershell -File kosmos.ps1 feedback write` saves
# the report. When the process was started to run this very file, the flag is not sent:
# any host argument naming it counts, so -File, its abbreviations and pwsh 7's positional
# form (`pwsh kosmos.ps1 ...`, where the first argument is the file) are all covered.
# A host started with -Command or -EncodedCommand (or an abbreviation) is never the -File
# case, and a pipe written inside its command text is a real in-session pipe, so the scan
# is skipped there even when the script's path appears among its arguments. A path that
# does not match (an 8.3 short name) sends the flag, and the verb then refuses with the
# sentence naming --body-file: a refusal, never a lost text.
$pipedIn = [bool]$MyInvocation.ExpectingInput
$hostRanCommand = $false
foreach ($a in [Environment]::GetCommandLineArgs()) {
  if ($a -match '^[-/](\w+)$') {
    $n = $Matches[1].ToLowerInvariant()
    if ('command'.StartsWith($n) -or 'encodedcommand'.StartsWith($n) -or $n -eq 'ec') { $hostRanCommand = $true; break }
  }
}
if ($pipedIn -and $PSCommandPath -and -not $hostRanCommand) {
  foreach ($named in [Environment]::GetCommandLineArgs()) {
    # Two readings: against the process directory, and against PowerShell's own location
    # (where a relative path resolves after pwsh's -WorkingDirectory).
    $candidates = @()
    try { $candidates += [IO.Path]::GetFullPath($named) } catch { }
    try { $candidates += (Resolve-Path -LiteralPath $named -ErrorAction Stop).ProviderPath } catch { }
    if ($candidates -contains $PSCommandPath) { $pipedIn = $false; break }
  }
}
$pipeFlag = @()
if ($pipedIn) { $pipeFlag = @('--kosmos-ps-pipeline') }
$argvFile = $null
$code = 1
try {
  $node = Join-Path $PSScriptRoot '..\runtime\node.exe'
  if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw "the runtime is missing ($node)" }
  $words = @(foreach ($a in $args) { if ($null -eq $a -or $a -is [string] -or $a -is [ValueType]) { [string]$a } else { ,$a } })
  $argvFile = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'kosmos-argv-' + [Guid]::NewGuid().ToString('N') + '.json')
  $ErrorActionPreference = 'Stop'
  [IO.File]::WriteAllText($argvFile, (ConvertTo-Json -InputObject $words -Compress -Depth 1), (New-Object Text.UTF8Encoding $false))
  $ErrorActionPreference = 'Continue'
  & $node "$PSScriptRoot\kosmos-cli.js" --kosmos-argv-file $argvFile @pipeFlag
  $code = $LASTEXITCODE
} catch {
  [Console]::Error.WriteLine('kosmos could not run: ' + $_.Exception.Message)
  $code = 1
} finally {
  if ($argvFile) { Remove-Item -LiteralPath $argvFile -Force -ErrorAction SilentlyContinue }
}
if ($null -eq $code) { $code = 1 }
exit $code
