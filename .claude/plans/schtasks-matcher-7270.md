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
- dropHeredocs: a here-document's lines are dropped up to its end word (`<<-` strips tabs; `<<<` is not one).
- commands: backticks split commands, as `$( )` already did.
- words: `<` and `>` end a word; the redirect's target and the 2 of `2>` are not words.
- wordsRun: NAME=value and a leading @ skipped; nohup/exec/command/builtin/time/nice/then/else/do/! read past their
  options; timeout read past its duration (Windows' `timeout /t` runs nothing); cmd's if forms; env -S read as the line.
- cmd /c: if the line starts with `""`, also read it with the outer pair dropped, as cmd does.
- callRuns: a launcher argument with a space or metacharacter and no quote of its own is wrapped in quotes, so it is
  read as the one word node passes.

## Rejected
- A real shell parser: out of proportion for a test guard; #7262 is the place for one shared reader.
- Escaping inner quotes in asOneWord (node's MSVC `\"` rules): the tokenizer does not read `\"`, so an argument that
  already holds a quote is left as written. That keeps cmd's `""path" args"` form readable.

## Weakest part
The matcher is still a tokenizer. New shapes will exist (a function or alias defined earlier in the same line,
`xargs schtasks`, a here-string feeding a shell). It errs toward refusing only where a parenthesis or backtick splits
a non-command, which turns that call into ENOENT in a test, never into a real scheduler call.

## Verification
- tools.windows-tests-schtasks-7247.test.js + engine/windows-tests-1777.test.js + engine/win32job.test.js under the
  guard: 75/75.
- Negative control: the test file against origin/main's schtasks-call.cjs: the 3 new tests fail, the 19 old ones pass.

## Review rounds
