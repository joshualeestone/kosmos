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

  # 🛑 THE OTHER HALF, AND IT BIT THE AUTHOR OF THE FIRST HALF. A BACKTICK is
  # PowerShell's escape character, so markdown-style `word` inside an
  # interpolating here-string EATS THE FIRST LETTER when it is one of the
  # escape letters. Measured: `rmdir` rendered as a carriage return followed by
  # "mdir". The check above looks for backslash-dollar and is blind to this.
  # ⇒ Render it and look for a control character where no line ended.
  $rendered = $ExecutionContext.InvokeCommand.ExpandString($body)
  $n = 0
  foreach ($line in ($rendered -split "`n")) {
    # A CR at the very end is a legitimate CRLF. One in the middle is not.
    $trimmed = $line -replace "`r$", ""
    if ($trimmed -match "[`r`t`a`b`f`v`0]") { $n++ ; Write-Output ("      STRAY CONTROL CHAR in: " + ($trimmed -replace "[`r`a`b`f`v`0]", "<CTRL>")) }
  }
  if ($n -gt 0) {
    Write-Output "      SUSPECT: $n line(s) carry a control character mid-line."
    Write-Output "      A backtick is PowerShell's ESCAPE character, so a markdown-style"
    Write-Output "      backtick-quoted word in a here-string eats its own first letter."
  }
}
exit 0
