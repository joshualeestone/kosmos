# Report what every interpolating string in a .ps1 will RENDER as, WITHOUT
# running any of it.
#
# 🛑 WHY TOKENISING AND NOT `ExpandString`. The first version of this file used
# `$ExecutionContext.InvokeCommand.ExpandString($body)`, which EVALUATES `$( )`
# SUBEXPRESSIONS. That made a linter that EXECUTES ARBITRARY CODE OUT OF THE
# FILES IT LINTS, wired into `test:shell`, running on every developer machine
# and in CI, over any .ps1 anybody adds under install/.
# Proven with an on-disk side effect: a here-string containing
# `$(Set-Content -Path /tmp/proof.txt ...)` created the file when THE CHECKER
# ran, and the checker reported PASS.
# ⇒ The tokeniser processes ESCAPES without executing anything. Measured: a
# backtick-r still shows as a carriage return, and a `$( )` beside it stays
# literal text and creates no file.
#
# 🔑 AND IT COVERS MORE, NOT LESS. The regex it replaces required a newline
# straight after `@"`, so `@"` with a trailing space -- valid PowerShell, and
# the exact EC2 bug -- reported "HERESTRINGS 0". Ordinary double-quoted strings
# were invisible too. The tokeniser sees every expandable string there is.
param([Parameter(Mandatory=$true)][string]$Path)

$errors = $null
$tokens = $null
[System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors) | Out-Null

$strings = @($tokens | Where-Object { $_.GetType().Name -match 'StringExpandableToken' })
Write-Output "EXPANDABLE-STRINGS $($strings.Count)"

$i = 0
foreach ($t in $strings) {
  $i++
  # .Value has escapes processed and variables/subexpressions left alone.
  $val = $t.Value
  $lines = $val -split "`n"

  # 🛑 A CONTROL CHARACTER MID-LINE is what an accidental backtick escape leaves
  # behind. A backtick is PowerShell's escape character, so a markdown-style
  # `word` inside an interpolating string EATS ITS OWN FIRST LETTER when that
  # letter is one of the escape letters. Measured: `rmdir` became <CR>mdir.
  #
  # ⚠️ TAB IS DELIBERATELY NOT IN THIS CLASS. An earlier version included it and
  # would have failed any generated file that legitimately contains a tab.
  # A tab is ordinary content; a bell or a form feed in generated text is not.
  $hits = 0
  foreach ($line in $lines) {
    $trimmed = $line -replace "`r$", ""
    if ($trimmed -match "[`r`a`b`f`v`0]") {
      $hits++
      Write-Output ("      STRAY CONTROL CHAR (line " + ($t.Extent.StartLineNumber) + "): " + ($trimmed -replace "[`r`a`b`f`v`0]", "<CTRL>"))
    }
  }

  # ⚠️ REPORTED, AND IT HAS A REAL FALSE POSITIVE. `C:\Program Files\$sub\bin`
  # is idiomatic and correct in a script that generates Windows paths, which is
  # exactly what this file is. So this is not "never correct", which is what an
  # earlier version of this comment claimed and a reviewer disproved.
  # It is reported because a backslash-dollar is ALSO what a
  # backtick-should-have-been-used bug looks like, and that bug is silent.
  # ⇒ If it is a genuine Windows path, restructure so the backslash is inside a
  # single-quoted segment, or split the string. Do not weaken the check.
  # ✅ ASK THE AST WHICH VARIABLES THIS STRING WILL ACTUALLY EXPAND, rather than
  # matching text. Splinter's mechanism, and it is strictly better than the regex
  # it replaces because it answers the real question with no execution:
  #     `$here   backtick ESCAPES it -> no variable node, stays literal
  #     \$here   backslash is NOT an escape -> $here IS a variable and WILL expand
  # ⇒ A backslash immediately before a variable that expands is the signature of
  # an author who believed backslash escapes. It is a CANDIDATE, not a verdict:
  # `C:\Program Files\$sub\bin` has the same shape and is entirely correct, so
  # this reports what will expand and leaves the judgement to a person.
  # 🛑 EXTENT TEXT, NOT $n.Name, AND SUBEXPRESSIONS COUNTED SEPARATELY. This
  # line's stated job is "which variables will this string actually expand", and
  # the first version answered it wrongly in two ways, both measured:
  #   $env:HOME was reported as $HOME and $script:secret as $secret -- .Name
  #     DROPS THE SCOPE QUALIFIER, so it named a DIFFERENT VARIABLE.
  #   a string whose whole content is $(Get-Date) reported NO expands= at all,
  #     because NestedTokens is a FLAT STREAM in which `$(` is a plain Token --
  #     making a string that runs a command indistinguishable from a literal.
  # ⇒ Extent.Text preserves the qualifier, and subexpressions are named rather
  # than silently dropped, because a subexpression expands too.
  $expanded = @()
  $subexprs = 0
  if ($t.NestedTokens) {
    foreach ($n in $t.NestedTokens) {
      $tn = $n.GetType().Name
      if ($tn -match 'Variable') { $expanded += $n.Extent.Text }
      elseif ($n.Kind -eq 'DollarParen' -or $n.Kind -eq 'AtParen') { $subexprs++ }
    }
  }
  $bs = ([regex]::Matches($val, '\\\$')).Count

  $expl = ""
  if ($expanded.Count -gt 0) { $expl += " expands=" + ($expanded -join ",") }
  if ($subexprs -gt 0)       { $expl += " subexpressions=$subexprs" }
  if ($expanded.Count -eq 0 -and $subexprs -eq 0) { $expl = " expands=nothing" }
  Write-Output ("  [$i] line=$($t.Extent.StartLineNumber) lines=$($lines.Count) ctrl=$hits backslash-dollar=$bs$expl")
  if ($hits -gt 0) {
    Write-Output "      SUSPECT: a backtick is PowerShell's ESCAPE character, so a"
    Write-Output "      markdown-style backtick-quoted word here eats its own first letter."
  }
  if ($bs -gt 0) {
    Write-Output "      SUSPECT: backslash-dollar. PowerShell escapes with a BACKTICK,"
    Write-Output "      so a \`$name renders as a bare \ with the variable lost."
    Write-Output "      (If this is a literal Windows path, restructure rather than ignore.)"
  }
}
exit 0
