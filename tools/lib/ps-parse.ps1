# Parse one .ps1 and report. Kept as a FILE rather than inline in the shell
# script because quoting a PowerShell one-liner through bash and zsh mangles
# backticks and dollars -- which is the exact class of bug this exists to catch.
param([Parameter(Mandatory=$true)][string]$Path)
$errors = $null
$tokens = $null
[System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors -and $errors.Count -gt 0) {
  Write-Output "ERRORS $($errors.Count)"
  foreach ($e in $errors) { Write-Output "  line $($e.Extent.StartLineNumber): $($e.Message)" }
  exit 1
}
Write-Output "OK $($tokens.Count) tokens"
exit 0
