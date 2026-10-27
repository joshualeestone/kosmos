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
- cmd /c: a line that starts with a quote is read as written AND with its first and last quote dropped, as cmd does
  (review 4); either one running schtasks is enough.
- callRuns: each launcher read as it reads its arguments: cmd gets the line node builds (nodeQuote, libuv rules: quote on
  space, tab, double quote or empty; \" inside), plus the as-written line when an argument holds a double quote;
  PowerShell gets the arguments joined, as it joins what follows -Command; a POSIX shell or env gets each argument as
  one word. Lines known to be cmd or PowerShell are not cut at backticks.
- A quoted word with a space is read as a line AND as a path; either one running schtasks is enough.

## Rejected
- Skipping here-document bodies (round 0 to 1): a << in a quote, a comment or node -e switched the guard off for the
  rest of a script, and bodies fed to bash or holding $( ) do run. Refusing a body line is the side that cannot reach
  the real scheduler.
- A real shell parser: out of proportion for a test guard; #7262 is the place for one shared reader.
- One word per argument for every launcher (rounds 0 to 2): PowerShell joins its arguments and cmd re-reads the line
  node builds, so that leaked (review 3).

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
- Round 3: 2 BLOCKERs, 2 WARNINGs, 1 NIT. BLOCKERs FIXED: PowerShell arguments after -Command are joined, as PowerShell
  joins them (reviewer checked live); a quoted path with " -" in a folder name is read both ways. WARNINGs FIXED: node's
  quoting rule was stated wrong (it also quotes a double quote and an empty argument); cmd now reads the exact line node
  builds; 2>&1 before a command is not cut at the &. NIT partly FIXED: env -S"..." and --split-string=, command -p -v.
  NIT ACCEPTED (leak on main too): echo "`schtasks`" in POSIX double quotes; a quoted path to nohup. Both reviewers'
  harnesses rerun: every HEAD-false/main-true case is the intended one-quoted-argument read (truth: does not run).
  Negative control: both new tests fail against round 2. 80/80 with windows-tests-1777 and win32job.
- Round 4: 1 BLOCKER, 2 NITs. BLOCKER FIXED: cmd drops the first and last quote after /c in the general case, not only
  `""path"`, which moves an & out of quotes (cmd /c "echo a b" "x & schtasks"; reviewer proved it live). The line is
  read both ways now; the exec-line NIT is fixed by the same change. NIT ACCEPTED: refusals that need the word schtasks
  (x"&schtasks to cmd, PowerShell syntax errors). Reviewer harnesses rerun on the fix: live cmd proof matches truth on
  every row; fuzz differentials 0 leak regressions. 300k-call fuzz: nothing throws. Negative control: the new test fails
  against round 3. 81/81 with windows-tests-1777 and win32job.
- Round 5: 2 BLOCKERs, 2 WARNINGs, 3 NITs. BLOCKERs FIXED: a redirect and its file stay in a word (marked redirect, skipped
  as a command) so a cmd /c line rebuilt from words still has them for the quote-stripped reading (cmd /c "echo a b" >
  "x & schtasks", live); an exec line of unknown shell is read with backtick cuts and without (env A=`x schtasks, live).
  WARNINGs FIXED: a start title after its switches (start /wait "" schtasks, live); a verbatim cmd or PowerShell line is
  read as one (no backtick cuts). NITs FIXED: Command -v in any case; nohup.exe and the other prefix words with .exe; the
  header rewritten to say what is read both ways and what is not seen; an invalid-shell test case replaced by if [ ]; then.
  All four earlier harnesses rerun: 0 leak regressions. Negative control: the new test fails against round 4. 82/82.
- Round 6: no BLOCKER (1.2M-call fuzz vs main: only redirect-target cases differ, where main refused a file name). 2
  WARNINGs, 2 NITs. FIXED: while, until and { read past (leak main shares); --chdir, --unset, --signal, --kill-after
  take the next word; a redirect among cmd, PowerShell or POSIX switches does not end them. ACCEPTED and named in the
  header: a redirect an outer shell already took is kept in the cmd line (refusal only; node passes it through when cmd
  is the program). Fuzz rerun on the fix: same 2 redirect-target cases only. Negative control: the new test fails
  against round 5. 83/83.
