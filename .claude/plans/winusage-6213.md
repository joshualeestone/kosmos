# winusage-6213: read Claude usage on Windows (kosmos#6213, a #6176 slice)

## Done when
On Windows, Kosmos wires its status line into a Claude account (when the account is added, and from the row's set-up
offer, #6175) with a command Claude Code runs there; once an agent on the account has worked, the row shows its weekly
usage. `weeklyBlocked` no longer answers 'windows'. Tested on the Mac with the platform set to win32; seen once on a
real Windows computer before the PR merges (the module's own rule: the Mac does not ship a Windows change unverified).

## Facts it rests on (Claude Code docs, statusline.md "Windows configuration"; setup.md)
- A status line command runs through Git Bash when it is installed, otherwise PowerShell. Git for Windows is optional.
- `statusLine` has no exec form (`command` runs in a shell); hooks have one, which is how #570 avoided this.
- Paths must use forward slashes: Git Bash eats backslashes.

## The call
`engine/allowance.js` `winCommandFor(node, script, accountDir)`: three UNQUOTED paths with forward slashes. Unquoted is
the one form both shells run alike (a quoted path needs `&` in PowerShell). A folder with a space is replaced by its
Windows short (8.3) name (`winShortPathCached`, via `cmd /c for %I in (...) do @echo %~sI`); a `~` inside a word is literal
to bash. The file name is never shortened, so the command still names kosmos-statusline.js (MARKER, isOurs). Anything
outside `[A-Za-z0-9._-/:~]` is refused with a reason, and nothing is written.

A path that is not safe (a space, a non-ASCII letter) is tried by its short name, used only if that one is safe (a short
name can keep an apostrophe or & ( ) !, so such a folder is refused); one with ", %, $, `
or a line break is refused before that, as reporthook refuses them; only the script keeps its file name long. The Windows uninstall (engine/win32uninstall.js) takes Kosmos's
status line out of each Claude settings file when it points inside the install being removed, by the folder's long or
short spelling (allowance.unwireStatusLine), as install/setup.sh does on the Mac, and also when the script it names is
already gone (an earlier Kosmos folder), as the report hooks' unwire does.

## Rejected
- Quoting for one shell: which shell runs depends on whether the person installed Git.
- `~/...` paths: Windows PowerShell 5.1 does not expand `~` in a native command's arguments.
- `powershell -NoProfile -File <ps1>` (the docs' example): the space problem moves to the -File path, and every
  refresh starts PowerShell.

## Weakest premise
8.3 names can be switched off on a drive; then a folder with a space is refused (the row says not set up, honestly).
The command has not yet run on a real Windows Claude Code, in either shell. **The merge gate, on a real Windows
computer:** (1) the command runs in Git Bash and, without Git, in PowerShell; (2) the script RECEIVES its JSON on stdin
there (it reads fd 0; whether a native child of Claude Code's PowerShell gets the piped input is not documented);
(3) a reading appears on the row; (4) an uninstall takes the status line out. Until all four are seen, the PR stays open.

## Not touched (Mona Lisa's #6189 is in these)
engine/kosmos-statusline.js (main, record), readFiveHour, the AI Models row markup.
