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
failure. With no node (a partial install) or no temp file, every settings file that still names THIS install's hook
path is named instead. The later status-line notice no longer claims a surviving status line records nothing: it
may be another install's.
Node writes its list to a temp file (a heredoc inside $( ) does not parse in bash here).

## Rejected
- Calling an unwire function in engine/reporthook.js: `sh -s -- --uninstall` runs the NEWEST setup.sh against the
  INSTALLED engine, which may be older than any such function.
- Matching by the marker alone (entryIsOurs): a second Kosmos install on the Mac shares these files.
- Doing Windows here: different uninstall (engine/win32uninstall.js) and its own lock; #5999.

## Weakest premise
That every hook Kosmos wrote names a path inside KOSMOS_HOME. ensureWired writes app/bin/kosmos-report-hook.sh from
the installed engine, and the status line names app/engine/kosmos-statusline.js, both inside it; a hand-placed copy
elsewhere (the #1467 case) is not ours to remove and is left (and still named by the status-line notice).
