# winunhooks-5999: the Windows uninstall takes Kosmos's report hooks out of Claude Code's settings

Card: kosmos#5999 (split from #5998, which did the Mac and Linux uninstall in install/setup.sh).

## Finished looks like
After `Kosmos.exe --uninstall` on Windows, no Claude settings file (the default account's, and every `~/.claude-*`
one's) holds a report hook pointing into the Kosmos folder the person is about to delete, and everything else in those
files is exactly as it was. Anything that could not be taken out is named in the uninstall's report.

## What changes
- `engine/reporthook.js` `unwireInstall(settingsPath, roots, { dryRun })`: removes entries that carry the marker AND
  name a path inside one of `roots`, in that same string (command or arg). Windows matching: no case, either
  separator, a root only at the start of the string or after a quote or space (#5998's rule). Keeps a person's own
  hooks, another install's, and a person's hook sharing our entry. Empty events and an empty `hooks` go. An unreadable
  file is reported (ours + because), never rewritten. Writes through the existing atomic `writeSettings`.
- `engine/win32uninstall.js`: a new step after the tasks and the board are confirmed gone and before the folders.
  Files: `AGENT_WORKFORCE_CLAUDE_SETTINGS` or `<home>\.claude\settings.json`, plus `<home>\.claude-*\settings.json`.
  Each under `filelock.withFileLock(file)`, the #3088 lock `wireDefaultHooks` and `trust.preacceptBypass` take.
  Roots: the launcher's `--root` (the bundle, which holds both the node.exe and the script the entry names) and its
  real path. DONE line per file changed, LEFT line per file that still holds ours.

## Decisions
- Only once every task is gone and no board answers: the board (server.js wireDefaultHooksTry) and each agent launch
  (win32launch) wire the hooks back, so removing them earlier undoes nothing. Rejected: unwiring first (it would
  just be re-wired, and the report would claim a removal that did not last).
- Roots = the bundle only, not %LOCALAPPDATA%\Kosmos: the hook entry names the bundle's node.exe and script.
- No `--root`: nothing is guessed; a LEFT line says the hooks were not checked. The launcher always passes it.
- A file whose lock is held is not touched; a read-only look decides whether to name it.
- A LEFT line makes the result not ok, so the launcher keeps the Apps entry for removing again. Same posture as every
  other leftover in this module.
- Status line: not touched; it is never written on Windows (allowance.ensureStatusLine skips win32).

## Weakest premise
That the launcher's `--root` is the folder the hook entries point into (the bundle the board ran from). True when the
person runs the uninstall from the same Kosmos they used; a second copy of Kosmos elsewhere would have its own
entries, which this keeps (correctly, they are another install's), but then the person may still see errors if that
copy is the one they delete by hand.

## Tests
`engine/win32uninstall.unhooks-5999.test.js` (8): matching rules (neighbours, shared entry, case and separators,
old shell form, boundary lookalikes), dry run, unreadable file, and through `uninstall()`: both files cleaned and
said, untouched while a task is registered, no root, a held lock. Six perturbations each turned a test red.
