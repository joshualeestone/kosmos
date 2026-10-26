# winreplyfile-6726: the Windows kosmos reply takes --file (kosmos#6726, Windows half)

## Goal
`kosmos reply --file <path>` works from the Windows CLI (tools/windows/kosmos-cli.js) exactly as install/kosmos's
does since c43c2d494b (#6758). The board half (engine/replyfile.js, server.js /api/reply) is unchanged.

## Why Mac-side
Splinter 2026-09-28 (#4373): a CLI verb or flag for parity between the two CLIs is built Mac-side, green on its
tests, merged, and then Homer is asked for one real run on the Windows box (not gating). win32 engine/supervisor
code would be Homer's; this touches none.

## Changes
1. tools/windows/kosmos-cli.js verbReply: take --file / --file= out of the args before `--` (past it, words);
   refuse twice, an empty or option-shaped path, a control character; make a relative path absolute by
   joining text onto the folder, as install/kosmos's "$PWD/$path" does (review 1: path.resolve removed `..`, so
   the board never saw a `..` it refuses, and through a junction it could name another file); on Windows take only
   a path on a drive, and refuse C:foo, \foo, /foo, a network or device path (review 3: the board would open
   \\host\share before any containment check, an outbound SMB connection) and a relative path from a folder not
   on a drive; the path rules are injectable (ctx.pathRules) so the Windows refusals run through verbReply on a Mac; `reply --help` shows both usage
   lines where --file is taught (a Mac), and on Windows only reply's own until #7221 lands (review 8); words optional with a file; --stdin still gives the words; a wrong-world board does not keep a
   reply with a file (the file is read at send time); on kept:true name the file by the board's `attached`, else
   path.basename. A second usage line USAGE_REPLY_FILE, word for word install/kosmos's.
2. tools/windows/kosmos.sh (the Git Bash shim): MSYS conversion is off for every argument, so it converts reply's
   --file value with cygpath, as it already did --body-file's for feedback and community (review 3: /c/Users/...
   typed in Git Bash was refused). Tested on a Mac with a stand-in cygpath and node.
3. engine/dmfiles.js: comment only. The instructions paragraph is still left out on a win32 board, and the comment
   now gives the true reason: the board's file checks have never run on Windows. The CLI's usage and --help name
   --file on a Mac only; on Windows the flag works when typed but is not named until #7221 (review 8, which reversed
   review 5).
4. tools.windows-kosmos-cli-reply-file-6726.test.js: the Mac test's arms, plus --stdin with --file, a wrong-world
   CONTROL (a plain reply IS kept through the same injected outbox), and a pin of the usage line against
   install/kosmos (it caught 25 MB vs 100 MB on the first run).

## Decided, not missed
- Teaching on win32 stays off until one real Windows run attaches a file. Rejected: turning it on now (agents
  would be taught a flag whose board half has never run on Windows). Weakest premise: that replyfile.js's
  containment rules (realpath, dev/ino, the home-folder refusals written for macOS) behave on NTFS; nothing
  Mac-side can test that.
- REVERSED in review 8, once #7221 was known (Windows no longer names --file until it lands). Was, review 5: `reply --help` on Windows names --file. Kept: parity, and an agent that finds the flag meets the
  board's checks, which decide containment by file identity (dev/ino, the real path), not by spelling. Rejected:
  hiding the line on Windows until the run (a second usage text to keep in step). Weakest premise: the same NTFS
  one above; the spelling-based hidden-in-home check is the part most likely to differ.
- The JSON-escape fallback install/kosmos needs for `attached` is not copied: the Windows CLI parses JSON.

## For the one real Windows run (asked of Homer on the card when the PR opens)
- Review 10: PowerShell passes `~` to kosmos.ps1 literally, so `--file ~/Files/x.txt` is joined onto the folder and
  the board answers there is no file there; say so, or expand ~ in the shim, once teaching turns on.
- FIRST, #7221 (review 6): the board resolves a network or device path, and a link or junction out to a share,
  before refusing it (engine/replyfile.js realpath before allowedRoot). The CLI's refusal is spelling only. A run with
  a normal file would pass with that open, so #7221 lands before teaching turns on. Specced for Homer, not built here.
- `kosmos reply --file <absolute path in Files> "x"` attaches, and downloads from the conversation.
- Git Bash: `kosmos reply --file /c/Users/<you>/.../Files/x.txt` (the shim's conversion, real cygpath).
- engine/replyfile.js compares the hidden-in-home check by spelling (`given.startsWith(home + sep)`), so on
  case-insensitive NTFS `c:\users\...` may skip it (review 3, reasoned). Check it before teaching turns on.
- Review 2: a RELATIVE path from a subfolder. node's cwd comes from kosmos.ps1's PowerShell location, which is
  not the folder the agent expects when that location is not on the FileSystem provider. A wrong root is refused
  by the board, never attached elsewhere (reasoned, not measured).

## Validation
- New test 18/18. Mutation-checked, each red: path.resolve back; the help line dropped; the old shim; verbReply
  ignoring the injected path rules. All tools.windows-kosmos-cli*.test.js, tools.windows-kosmos-shims-570,
  cli.reply-*.test.js and cli.help-flag-*.test.js (after iteration 4): 432 tests, 411 pass, 21 skip (Windows-only),
  0 fail. comment-deferral (from the worktree), dmfiles, windows-coupling-audit-1732: green.

## Review rounds after the rebase onto main (2026-10-26)
6. (default model) W: the board-side gap above (#7221, Homer's). W: three test arms read the real working folder, so a
   suite run from a network folder on Windows would red (now an injected literal; `/` no longer joins as `//`). Nits
   taken: C1 controls refused, as bash's [[:cntrl:]] does in UTF-8; a relative path refused for its folder now names
   that folder (arm added); the dmfiles comment rewrapped.

7. (sonnet) W: a refusal echoed the typed path before the control-character check, so an escape sequence in it
   reached the agent's terminal (now the typed path is checked first, and a folder named in a refusal has its
   control characters replaced; arms for both). W: drive paths that are a stream (C:\x:s) or a device (C:\NUL) pass
   the CLI's spelling check; board-side, added to #7221. Not taken: a single-dash value (-x) is taken as a path
   (the board refuses it as relative; install/kosmos does the same); no arm drives the real process.cwd() default
   (every arm injects the folder on purpose, so no result depends on where the suite runs).
8. (default model) W: the Windows CLI named --file in help and usage while dmfiles held the teaching back, so the flag
   was taught anyway; with #7221 known, that reverses review 5's call. Now --file is named only where the board's
   checks have run (replyFileTaught, keyed on the path rules): on Windows the flag works when typed (the real run
   needs it) but neither help nor usage names it, and dmfiles' comment agrees. Sibling help tests ask helpFor rather
   than rebuilding the text. Nit taken: the shim arm says the real cygpath is the Windows run's. Not taken, parity
   with install/kosmos: bidi and line-separator characters are not filtered (Mac the same); --File is not --file.
9. (sonnet) Convention taken: Changes item 1 still said Windows help shows both usage lines (now it says where it
   does). Nit taken: the help comment, orphaned above review 8's, is back above helpFor. Not issues: an empty-words
   reply with a file is driven at the board by server.reply-file-6726.test.js (lines 165, 484). Deferred as
   duplicates: the board-side refusals and their ordering (#7221, review 6), a relative path's working folder from
   PowerShell (review 2), a single-dash value (review 7).
10. (default model) W: a drive path typed with forward slashes (C:/Users/a/.aws/x) passes the board's hidden-in-home
   check, which reads the path as written and splits on backslashes; the CLI now sends a Windows drive path with
   backslashes only (no `..` is rewritten; tested), and the board side is added to #7221. W: Changes item 3 still
   said Windows names --file (fixed). Nits taken: the folder is read only for a relative path (an absolute one
   never reads it, tested); a saved name with a control character is not written to the terminal (the given name
   stands in, tested); the sibling help arms say they check routing; PowerShell's literal ~ is on the Windows run
   list.

11. (sonnet) Nit taken: the shim says every verb names its path flag or sets past_options (an empty $flag would match
   an empty argument). Not taken: "Sent, with X attached" when the board returns no `attached` (install/kosmos says
   the same, and the board and CLI ship in one app, so no board answers kept without knowing --file). Deferred as
   duplicates: the board-side refusals (#7221, review 6), a single-dash value (review 7), the stand-in cygpath (the
   real run, review 8).
12. (default model) W: in Git Bash the shim ran an absolute --file value through cygpath, which shortens `..` by text,
   so the board never saw the `..` it refuses (and through a junction the shortened path names another file); a reply
   --file value with a `..` segment is now passed on unconverted, so the CLI refuses it as having no drive (arms for
   both forms, and a `..b` name still converted). W: the board's hidden-in-home rule compares spelling
   case-sensitively, which on a Mac's case-insensitive APFS lets `/users/...` skip it; outside this diff, filed as
   #7226. W: the comment said device paths were refused; it now says a device or stream on a drive goes to the board
   (#7221). Nits taken: refusals name C:/..., which survives Git Bash quoting; a working folder deleted under the
   command is a refusal, never a crash or a join onto `/` (tested); the sibling help arms compare the other verbs'
   real text again.
13. (sonnet) Nit taken: a /c/... path with a `..`, which the shim now leaves unconverted, was refused for having no
   drive; it is refused for the `..` (tested). Deferred as duplicates: the board-side refusals (#7221), bidi and
   zero-width characters (review 8, parity), the sibling help arms (review 12), the stand-in cygpath (review 8).
14. (default model) W: the comment still read as if network paths were refused; it now says the check is spelling
   only (a mapped or subst drive, or a junction out to a share, looks like a drive path) and #7221 is the guard. Nits
   taken: an unreadable folder is the reason given before a `..` (tested); the shim's `..` check matches either
   separator (tested); reply's help has one exact pin. Not taken: `--file -h` prints help (install/kosmos the same,
   nothing is sent).

