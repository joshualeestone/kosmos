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
   lines, as install/kosmos's help does; words optional with a file; --stdin still gives the words; a wrong-world board does not keep a
   reply with a file (the file is read at send time); on kept:true name the file by the board's `attached`, else
   path.basename. A second usage line USAGE_REPLY_FILE, word for word install/kosmos's.
2. tools/windows/kosmos.sh (the Git Bash shim): MSYS conversion is off for every argument, so it converts reply's
   --file value with cygpath, as it already did --body-file's for feedback and community (review 3: /c/Users/...
   typed in Git Bash was refused). Tested on a Mac with a stand-in cygpath and node.
3. engine/dmfiles.js: comment only. The instructions paragraph is still left out on a win32 board, and the comment
   now gives the true reason: the board's file checks have never run on Windows. The CLI's own usage and --help
   do name --file on Windows (review 5), as on a Mac: decided, below.
4. tools.windows-kosmos-cli-reply-file-6726.test.js: the Mac test's arms, plus --stdin with --file, a wrong-world
   CONTROL (a plain reply IS kept through the same injected outbox), and a pin of the usage line against
   install/kosmos (it caught 25 MB vs 100 MB on the first run).

## Decided, not missed
- Teaching on win32 stays off until one real Windows run attaches a file. Rejected: turning it on now (agents
  would be taught a flag whose board half has never run on Windows). Weakest premise: that replyfile.js's
  containment rules (realpath, dev/ino, the home-folder refusals written for macOS) behave on NTFS; nothing
  Mac-side can test that.
- Review 5: `reply --help` on Windows names --file. Kept: parity, and an agent that finds the flag meets the
  board's checks, which decide containment by file identity (dev/ino, the real path), not by spelling. Rejected:
  hiding the line on Windows until the run (a second usage text to keep in step). Weakest premise: the same NTFS
  one above; the spelling-based hidden-in-home check is the part most likely to differ.
- The JSON-escape fallback install/kosmos needs for `attached` is not copied: the Windows CLI parses JSON.

## For the one real Windows run (asked of Homer on the card when the PR opens)
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
