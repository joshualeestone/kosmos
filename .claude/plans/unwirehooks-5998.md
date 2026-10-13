# unwirehooks-5998: --uninstall takes Kosmos's hooks and status line out of Claude Code's settings

Card: #5998 (Mona Lisa, found writing the public uninstall page #5996). Windows split to #5999.

## Finished looks like
`setup.sh --uninstall` removes exactly this install's report-hook entries and its status line from
~/.claude/settings.json and every ~/.claude-*/settings.json, keeps everything else in those files, and a real
sandboxed uninstall test proves it with the person's own hook, a hook sharing our entry, another install's hooks,
unrelated settings, a symlinked file and an unparseable file.

## Change
install/setup.sh uninstall(): inside the branch that has proved KOSMOS_HOME is a Kosmos install, right after
"deleting $KOSMOS_HOME" and before anything is removed, the bundled node runs a SELF-CONTAINED program (only fs and
path) over those files. A hook item is ours when it carries the kosmos-report-hook marker AND a path inside this
KOSMOS_HOME (given or realpath); the status line when it names kosmos-statusline.js inside it. An entry left with no
hooks is dropped, an event left with no entries is dropped, `hooks` is dropped only if this run emptied it. Written
through the realpath (a symlinked dotfile stays a link), keeping the mode, by temp file and rename. A file that
cannot be parsed or saved but names this install is named in the uninstall output; nothing is guessed at.
"Inside this home" is anchored: the root must start the string or follow a quote or space (so /var/x never matches
/private/var/x by accident); both the given KOSMOS_HOME and its realpath count, since the engine writes hook paths
from its own realpath. An event with nothing of ours is left exactly as it was. Saved with fsync, temp removed on
failure (that cleanup is defensive and untested: reaching it needs a write to fail after the file opened). The program
ends its output with a done line; whenever that line is missing (no node, a node that crashed or cannot run here, no
temp file) the shell names every settings file that still holds THIS install's hook path (given or real, right after a
quote) instead. A JSON file that is not an object but names this install is named too. When the folder is already
gone (an uninstall from before this change left the hooks), a re-run still names those files. The notice prints
the real folder too when the install was reached through a symlink, since that is what the hooks name. The later status-line notice no longer claims a surviving status line records nothing: it
may be another install's.
Node writes its list to a temp file: this heredoc inside $( ) did not parse under bash 3.2 (an apostrophe in a heredoc
nested in $( ) is a known bash 3.2 parse bug; the BOARDEOF block in the same function works because it has none).

## Rejected
- Calling an unwire function in engine/reporthook.js: `sh -s -- --uninstall` runs the NEWEST setup.sh against the
  INSTALLED engine, which may be older than any such function.
- Matching by the marker alone (entryIsOurs): a second Kosmos install on the Mac shares these files.
- Doing Windows here: different uninstall (engine/win32uninstall.js) and its own lock; #5999.

## Weakest premise
That every hook Kosmos wrote names a path inside KOSMOS_HOME. ensureWired writes app/bin/kosmos-report-hook.sh from
the installed engine, and the status line names app/engine/kosmos-statusline.js, both inside it; a hand-placed copy
elsewhere (the #1467 case) is not ours to remove and is left: a hand-placed status line is still named by the
status-line notice, a hand-placed hook is named by nothing (it points at a script that still exists, so it does not
error).
