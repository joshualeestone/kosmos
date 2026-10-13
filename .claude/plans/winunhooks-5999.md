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
  real path. DONE line per file changed; LEFT for what a retry can fix (busy lock, failed save); NOTE for
  what it cannot (an unreadable file, a folder refusing the lock, no root).

## Decisions
- Only once every task is gone and no board answers: the board (server.js wireDefaultHooksTry) and each agent launch
  (win32launch) wire the hooks back, so removing them earlier undoes nothing. Rejected: unwiring first (it would
  just be re-wired, and the report would claim a removal that did not last).
- Roots = the bundle only, not %LOCALAPPDATA%\Kosmos: the hook entry names the bundle's node.exe and script.
- No `--root`: nothing is guessed; a NOTE says the hooks were not checked (round 1: a LEFT made the result not ok for
  good and turned the existing Windows uninstall tests red, which pass no root). The launcher always passes it.
- A file whose lock is held is not touched; a read-only look decides whether to name it.
- A LEFT line makes the result not ok, so the launcher keeps the Apps entry for removing again. Same posture as every
  other leftover in this module.
- Round 1: a hook carrying the marker whose script is already gone is taken out too, wherever it points. An added
  account (`accounts.prepare`) is wired once, with the folder Kosmos ran from then, and nothing repoints it after a
  move, so its hooks can name an earlier folder. Ours by the marker and already broken: removing it removes an error.
  Weakest part: a Kosmos on a drive that is unplugged at uninstall time loses its hooks in added accounts (the
  default account's are re-wired by that board at its next start).
- Roots: the given folder made absolute, plus both real paths (Node's `__dirname` uses the JS realpath).
- Status line: not touched; it is never written on Windows (allowance.ensureStatusLine skips win32).

## Weakest premise
That the launcher's `--root` is the folder the hook entries point into (the bundle the board ran from). True when the
person runs the uninstall from the same Kosmos they used; a second copy of Kosmos elsewhere would have its own
entries, which this keeps (correctly, they are another install's), but then the person may still see errors if that
copy is the one they delete by hand.

## Tests
`engine/win32uninstall.unhooks-5999.test.js` (15): matching rules (neighbours, a shared entry, case and separators,
the old shell form, boundary lookalikes), dry run, unreadable file, the broken-script rule (each case it must keep,
with a control it removes), goneOnDisk (not found vs could not look), and through `uninstall()`: every file cleaned
and said, a .claude-* folder with no settings file left unwritten, untouched while a task is registered or a board
answers (each proving the guard was false), no root (a note), an earlier folder's dead entries, the real path behind
a link and the settings override, an unreadable file and a folder refusing the lock (notes), a held lock (left).
Every guard was perturbed and turned a test red. Round 4 found the integration tests passing through the broken-script
seam rather than the folder match (path.resolve off Windows); the default seam now says nothing is gone.

## Left as decided (review NITs)
- The no-root note still says to remove Kosmos again: only a hand-run CLI reaches it (the launcher passes --root).
- A settings file that cannot be opened reads "could not be read as JSON": that sentence is the shared readSettings's,
  used by the wiring too; a separate card if it matters.

## Review log
Rounds 1 to 4 found BLOCKER/WARNINGs, all fixed (commit subjects). Rounds 5 and 6: no BLOCKER or WARNING. Converged.
