# winrules-4752: the setup guide's absolute Read rules, in the path form Claude Code matches on Windows

Follow-up to #4752 (closed), from a peer's note. Claude Code's permissions docs: "On Windows, paths are normalized to
POSIX form before matching. C:\Users\alice becomes /c/Users/alice, so use //c/**/.env". The guide's absolute rules
came from `ruleAbs`, which wrote the native spelling (`//C:\Users\...`). That is not a form the docs say is matched,
so on Windows those rules were at best unverified. The `~/` rules are unaffected.

## Change
- `engine/setup-assistant.js` `ruleAbs(p, platform = process.platform)`: on win32, backslashes become `/` and a
  leading drive `C:` becomes `c/`, then the usual `//` prefix: `C:\Users\x` -> `//c/Users/x`. macOS and Linux are
  unchanged (a backslash there is part of a file name). Exported, so the form is pinned from any host.
- Everything that builds an absolute rule already goes through `ruleAbs`, including `wasEntryRule`'s prefix, so the
  writer and the reader of those rules agree. `RULE_SYNTAX` is checked on the native path with its separator taken
  out first, as before.

## Tests
`engine/setup-assistant.winrules-4752.test.js` (in `tools/windows-tests.js` ALSO): drive paths to `//c/...` (fails on
main: ruleAbs not exported and native); macOS and Linux unchanged (control); and, on the host it runs on, no Read
rule the guide writes keeps a backslash or a drive colon, which the Windows job measures for real.

## Weakest premise
That Claude Code's documented normalisation is what the version a person runs does. Not measured on a Windows
machine here; the docs are the source. The old native form was not documented as matched at all, so this cannot
make a rule that worked stop working unless Claude Code also matches the native form, which nothing says.
