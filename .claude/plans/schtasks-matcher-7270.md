# schtasks-matcher-7270

**Posture:** production

Addresses #7270, the follow-up from #7247's round 8 review (PR #7271). The command matcher behind
tools/no-schtasks-preload.cjs (tools/lib/schtasks-call.cjs) missed common prefixes and refused some harmless calls.

## Done when
1. Every prefix the round 8 reviewer listed (NAME=value, @, if exist/errorlevel, nohup/exec/command/time/timeout,
   a redirect with no space, backticks) is read as running schtasks, with a control for each prefix running something else.
2. `cmd /c echo "a & schtasks"` (args passed without a shell) and a here-document body are no longer refused.
3. The two NITs: cmd's `""path" args"` form and `env -S` are read as they run.
4. The new tests fail against main's matcher (negative control) and the existing suite stays green under the guard.

## Changes
- Here-documents: NOT read specially (tried in round 0, removed in round 2); a body line starting with schtasks is
  refused, as on main.
- commands: backticks split commands, as `$( )` already did.
- words: `<` and `>` end a word; the redirect's target and the 2 of `2>` are not words.
- wordsRun: NAME=value and a leading @ skipped; nohup/exec/command/builtin/time/nice/then/else/do/! read past their
  options; timeout read past its duration (Windows' `timeout /t` runs nothing); cmd's if forms; env -S read as the line.
- cmd /c: if the line starts with `""`, also read it with the outer pair dropped, as cmd does.
- callRuns: without a shell, the launcher's words are built from its arguments (argWord): one with a space or tab and no
  double quote is one quoted word, as node passes it; any other is bare, as node passes it.

## Rejected
- Skipping here-document bodies (round 0 to 1): a << in a quote, a comment or node -e switched the guard off for the
  rest of a script, and bodies fed to bash or holding $( ) do run. Refusing a body line is the side that cannot reach
  the real scheduler.
- A real shell parser: out of proportion for a test guard; #7262 is the place for one shared reader.
- Escaping inner quotes in asOneWord (node's MSVC `\"` rules): the tokenizer does not read `\"`, so an argument that
  already holds a quote is left as written. That keeps cmd's `""path" args"` form readable.

## Weakest part
The matcher is still a tokenizer. New shapes will exist (a function or alias defined earlier in the same line,
`xargs schtasks`, a here-string feeding a shell). Round 1 showed my first version leaked (it quoted metacharacter-only arguments, hiding ver&schtasks), so this is not
safe by construction: each change is checked against main's answers on the reviewer's cases, and a regression test
holds each one.

## Verification
- tools.windows-tests-schtasks-7247.test.js + engine/windows-tests-1777.test.js + engine/win32job.test.js under the
  guard: 75/75.
- Negative control: the test file against origin/main's schtasks-call.cjs: the 3 new tests fail, the 19 old ones pass.

## Review rounds
- Round 1: 1 BLOCKER, 3 WARNINGs, 1 NIT, all FIXED. BLOCKER (a regression): quoting any argument with a metacharacter hid
  schtasks behind & ; | in an argument with no space (cmd /c ver&schtasks); now only a space or tab quotes, as node does,
  and the words are built from the arguments, never re-cut as a top-level line. WARNINGs: a quoted script ending in a
  launcher path (exec /bin/bash) was taken for that launcher (isPath); command -v is a lookup, not a run; << inside
  $(( )) is a shift, not a here-document, and only a POSIX line has here-documents. NIT: backticks no longer cut cmd or
  PowerShell lines. Also found while fixing: a quoted -c script had its here-document taken twice; read once now.
  Negative control: the new test fails against round 0's matcher. 76/76 with windows-tests-1777 and win32job.
- Round 2: 1 BLOCKER, 3 WARNINGs, 1 NIT. BLOCKER + WARNING (here-documents): FIXED by removing the here-document reader;
  bodies read as commands again, as on main. WARNING windowsVerbatimArguments: FIXED (arguments joined as node passes
  them). WARNING a backtick in an exec line of unknown shell (cmd on Windows) refuses echo `schtasks`: ACCEPTED, refusal
  only, named in the header. NIT X==1 schtasks refused: ACCEPTED (cmd fails that line anyway). Reviewer harness of 225
  calls rerun: every HEAD-false/main-true case is the intended one-quoted-argument read. Negative control: both new
  tests fail against round 1. 78/78 with windows-tests-1777 and win32job.
