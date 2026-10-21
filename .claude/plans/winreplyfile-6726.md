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
   the board never saw a `..` it refuses, and through a junction it could name another file); refuse a Windows
   path with a drive but no folder (C:foo) or a folder but no drive (\foo); `reply --help` shows both usage
   lines, as install/kosmos's help does; words optional with a file; --stdin still gives the words; a wrong-world board does not keep a
   reply with a file (the file is read at send time); on kept:true name the file by the board's `attached`, else
   path.basename. A second usage line USAGE_REPLY_FILE, word for word install/kosmos's.
2. engine/dmfiles.js: comment only. Instructions still do not teach --file on a win32 board, and the comment now
   gives the true reason: the board's file checks have never run on Windows.
3. tools.windows-kosmos-cli-reply-file-6726.test.js: the Mac test's arms, plus --stdin with --file, a wrong-world
   CONTROL (a plain reply IS kept through the same injected outbox), and a pin of the usage line against
   install/kosmos (it caught 25 MB vs 100 MB on the first run).

## Decided, not missed
- Teaching on win32 stays off until one real Windows run attaches a file. Rejected: turning it on now (agents
  would be taught a flag whose board half has never run on Windows). Weakest premise: that replyfile.js's
  containment rules (realpath, dev/ino, the home-folder refusals written for macOS) behave on NTFS; nothing
  Mac-side can test that.
- The JSON-escape fallback install/kosmos needs for `attached` is not copied: the Windows CLI parses JSON.

## Validation
- New test 16/16 (review 1 arms mutation-checked: path.resolve back, and the help line dropped, each red). All tools.windows-kosmos-cli*.test.js and cli.reply-*.test.js: 408 tests, 401 pass, 7 skip
  (Windows-only), 0 fail. comment-deferral (from the worktree), dmfiles, windows-coupling-audit-1732: green.
