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
# form (`pwsh kosmos.ps1 ...`, where the first argument is the file) are all covered; on
# Windows PowerShell 5.1 only the value after -File counts, since 5.1 runs a bare
# positional argument as -Command.
# A host started with -Command, -EncodedCommand or pwsh 7.4's -CommandWithArgs (or an abbreviation) is never the -File
# case, and a pipe written inside its command text is a real in-session pipe, so the scan
# is skipped there even when the script's path appears among its arguments.
# Only the host's arguments before the script's path are read, never the words after it. A path that
# does not match (an 8.3 short name) sends the flag, and the verb then refuses with the
# sentence naming --body-file: a refusal, never a lost text.
$pipedIn = [bool]$MyInvocation.ExpectingInput
if ($pipedIn -and $PSCommandPath) {
  # The host's own arguments are read in order, up to the first that names this script
  # (after it come the agent's words, which are never read here, so a word like /c or -e
  # cannot pass for a host switch and no word is resolved as a path) or the first
  # -Command / -EncodedCommand / -CommandWithArgs switch (a pipe inside its text is a real
  # in-session one, even when the script's path is one of the arguments after it). The value
  # after -File ends the scan too: it is this script (the flag is not sent) or another one
  # (a pipe inside that script is a real in-session one, and its own arguments are not read).
  $hostArgs = [Environment]::GetCommandLineArgs()
  $fileValue = $false
  for ($i = 1; $i -lt $hostArgs.Count; $i++) {
    $named = $hostArgs[$i]
    if (-not $fileValue -and $named -match '^(?:--?|/)(\w+)$') {
      $n = $Matches[1].ToLowerInvariant()
      if ('command'.StartsWith($n) -or 'encodedcommand'.StartsWith($n) -or $n -eq 'ec' -or 'commandwithargs'.StartsWith($n) -or $n -eq 'cwa') { break }
      if ('file'.StartsWith($n)) { $fileValue = $true; continue }
    }
    # Two readings: against the process directory, and against PowerShell's own location
    # (where a relative path resolves after pwsh's -WorkingDirectory).
    $candidates = @()
    try { $candidates += [IO.Path]::GetFullPath($named) } catch { }
    try { $candidates += (Resolve-Path -LiteralPath $named -ErrorAction Stop).ProviderPath } catch { }
    # Windows PowerShell 5.1 runs a bare positional argument as -Command, not -File (only
    # pwsh 7 takes it as the file), so there only the value after -File counts.
    if ($candidates -contains $PSCommandPath) {
      if ($fileValue -or $PSVersionTable.PSEdition -ne 'Desktop') { $pipedIn = $false }
      break
    }
    if ($fileValue) { break }
  }
}
# kosmos#8213: an apostrophe inside plain single quotes ('I can't and won't') ends the quote early. With an odd count
# PowerShell refuses the line before this script runs ("The string is missing the terminator"), which the agent's
# instructions now name. With an even count it PARSES, and the text arrives here cut into pieces with the apostrophes
# gone (measured, pwsh 7: 'I can't and won't do it' arrives as "I can", "t", "and", "wont do it"), which the CLI would
# join and send. So this call's own words on the line as typed ($MyInvocation.Line) are read with PowerShell's own
# parser, and two shapes refuse before anything is sent:
#   (a) a single-quoted string with a word touching its end ('I can't  ->  'I can' then t);
#   (b) a bare word still holding an apostrophe once doubled ones ('') and double-quoted parts are set aside
#       (won't do it'  or  Bob's'). In an --option=value word only the value is read, and a value that is one quoted
#       string ('eng', 'Bob''s') is fine. (-option:'value' is not one word: PowerShell gives a Parameter token and then
#       the value's own tokens, so (a) and (b) read it as they read any text.)
# This call's words run from where it starts on the line to the first | ; && || or newline, or to a ) or } it did not
# open (so a later word in the same if, block or array is not read). A here-string never holds a StringLiteral token,
# and 'it''s' is one token, so neither refuses. Not covered, so a mangled text can still go out there: a command
# continued onto the next line with a backtick ($MyInvocation.Line holds the first line only). When the line is not
# readable (started with -File, or no line at all) or anything here fails, nothing is checked and the call runs as
# before.
$splitQuote = $false
try {
  $line = $MyInvocation.Line
  $at = $MyInvocation.OffsetInLine
  if ($line -and $at -gt 0) {
    $tokens = $null; $parseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($line, [ref]$tokens, [ref]$parseErrors)
    $mine = New-Object System.Collections.ArrayList
    $depth = 0
    foreach ($t in $tokens) {
      if ($t.Extent.StartOffset -lt ($at - 1)) { continue }
      $tk = [string]$t.Kind
      if (@('Pipe', 'Semi', 'NewLine', 'AndAnd', 'OrOr', 'EndOfInput') -contains $tk -and $depth -eq 0) { if ($mine.Count) { break } else { continue } }
      if (@('LParen', 'AtParen', 'DollarParen', 'LCurly', 'AtCurly') -contains $tk) { $depth++ }
      if (@('RParen', 'RCurly') -contains $tk) { if ($depth -eq 0) { break } else { $depth-- } }
      [void]$mine.Add($t)
    }
    $word = @('Identifier', 'Generic', 'Number')
    for ($i = 0; $i -lt $mine.Count -and -not $splitQuote; $i++) {
      $k = [string]$mine[$i].Kind
      if ($k -eq 'Generic') {
        $w = $mine[$i].Text
        $optValue = $false
        if ($w.StartsWith('-')) {
          $eq = $w.IndexOf('=')
          if ($eq -lt 0) { $w = '' } else { $w = $w.Substring($eq + 1); $optValue = $true }
        }
        $w = ($w -replace '"[^"]*"', '').Replace("''", '')
        if ($optValue -and $w -match "^'[^']*'$") { $w = '' }
        if ($w.Contains("'")) { $splitQuote = $true }
      }
      if ($k -eq 'StringLiteral' -and $i + 1 -lt $mine.Count -and $word -contains [string]$mine[$i + 1].Kind -and $mine[$i + 1].Extent.StartOffset -eq $mine[$i].Extent.EndOffset) { $splitQuote = $true }
    }
  }
} catch { $splitQuote = $false }
if ($splitQuote) {
  [Console]::Error.WriteLine("PowerShell would have changed this text before kosmos saw it: an apostrophe inside single quotes ends the quote early (the text is cut into pieces and the apostrophe dropped), and a quoted part touching a word is joined to it or split from it. Nothing was sent. Pass the text as one single-quoted here-string: @' at the end of the command's line, the text, then '@ at the start of its own line. (Inside plain single quotes, an apostrophe is written twice: can''t.)")
  exit 2
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
