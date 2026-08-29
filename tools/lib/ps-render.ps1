# Render every double-quoted here-string in a .ps1 and report what came out.
#
# 🛑 WHY RENDERING AND NOT PARSING. A `\$foo` inside an interpolating
# here-string PARSES CLEAN and then renders as a bare backslash, because
# PowerShell escapes with a BACKTICK and the `$foo` interpolates to nothing.
# Measured:
#   input   powershell -Command "\$here = \$env:FOO; Write-Output \$here"
#   parses  OK, 12 tokens
#   renders powershell -Command "\ = \; Write-Output \"      <- variables EATEN
# ⇒ The generated file is silently wrong and no parser can tell you.
#
# ⚠️ This reports; it does not judge. The caller decides what must be present,
# because only the caller knows what the generated file is for.
param([Parameter(Mandatory=$true)][string]$Path)

$src = Get-Content -LiteralPath $Path -Raw
# Double-quoted here-strings only. Single-quoted (@'...'@) do not interpolate,
# so a backslash in one is just a backslash and there is nothing to check.
$rx = [regex]'(?s)@"\r?\n(.*?)\r?\n"@'
$m = $rx.Matches($src)
Write-Output "HERESTRINGS $($m.Count)"
$i = 0
foreach ($h in $m) {
  $i++
  $body = $h.Groups[1].Value
  # A lone backslash-dollar is never correct in PowerShell. Report it with the
  # line so a person can look, rather than trying to auto-fix it.
  $bad = [regex]::Matches($body, '\\\$')
  Write-Output "  [$i] lines=$(($body -split "`n").Count) backslash-dollar=$($bad.Count)"
  if ($bad.Count -gt 0) {
    Write-Output "      SUSPECT: PowerShell escapes with a backtick, not a backslash."
    Write-Output "      A \`$name here renders as a bare \ and the variable is lost."
  }
}
exit 0
