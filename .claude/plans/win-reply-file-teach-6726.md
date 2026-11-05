# kosmos#6726 (Windows): teach `kosmos reply --file` on Windows

**Posture:** production

## Goal
Windows agents learn they can attach a file to their reply. The flag has worked on Windows since PR #7238 but was deliberately not taught (not in `kosmos reply --help`, not in the usage a bare reply prints, not in the instructions engine/dmfiles.js writes) until #7221 landed (PR #7243, 10-26) and one real Windows run attached a file. That run was done on the Windows box on 11-05 and is posted on #6726.

## Done when
1. On Windows, `kosmos reply --help` and a bare `kosmos reply` name `--file` with the same line as install/kosmos.
2. The Files block in every Windows agent's instructions carries the attach paragraph, plus one Windows sentence: give the file's full path, since PowerShell does not expand `~` (measured: a `~` path is refused as "there is no file at ...\~\...").
3. Nothing else in the block, the CLI, or the Mac side changes.

## The real Windows run (11-05, Kosmos 0.7.86 on the Windows box; full table on #6726)
- An absolute Windows path in Files attaches; the download's sha256 equals the file's, served as an attachment with nosniff.
- A Git Bash `/c/...` path attaches.
- The hidden-in-home refusal, for a file in a dot folder inside a project I am on, holds in normal, lower-case and upper-case spellings (control: a plain file there attaches).
- `..` paths are refused by design; plain relative names attach from Git Bash and PowerShell; from a PowerShell registry location the file is refused, never attached from elsewhere.
- PowerShell passes `~` literally and the board refuses it: hence the sentence.
- Observation, not changed: a dot-named file directly in Files attaches and arrives without its leading dot.

## Design
- `replyFileTaught` stays as a function of the path rules (now true for both), so a later hold for one side is a one-line change.
- The `~` sentence is in the instructions only. The CLI's usage line is pinned to install/kosmos's word for word by tools.windows-kosmos-cli-reply-file-6726.test.js, so it stays the Mac's line.

## Tested (Windows box)
- tools.windows-kosmos-cli-reply-file-6726.test.js: the help test now pins that Windows prints the same two lines as the Mac.
- New engine/dmfiles.reply-file-6726.test.js: the block teaches `--file`. Control: it fails against origin/main's dmfiles on this Windows host.
- dmfiles, instructions, messages, create and the 3614/6726 server tests: the same 9 failures as origin/main on this box, by name AND by reason (only random temp-folder names differ); none involve the teaching.
- windows-tests-1777, engine.reachable, fixture-discipline, no-name-refs: pass.

## Review rounds
- Round 1 (blind reviewer): 0 BLOCKER, 1 WARNING, 3 NIT. Converged. The reviewer rendered dmfiles' block on origin/main and HEAD with the platform overridden at load: darwin and linux byte-identical (3894 bytes, same sha); win32 differs from darwin by exactly the new sentence. Found no other code, golden file or doctrine hash that assumes Windows lacks --file; syncEveryone re-renders the block at board start and tellAgent tells running agents. Fixed: W1 the new test was vacuous on CI (Windows CI only selects win32-named files, and on a Mac it passed on main too): it now renders each platform in a child node that loads dmfiles with process.platform set (its own requires loaded first under the real platform, since the store refuses another platform's home layout), and checks Windows has the paragraph and the ~ sentence and the Mac has the paragraph without it, with a line from outside the paragraph as the control. Control on this box: against origin/main's dmfiles the Windows case fails and the Mac case passes. NIT wrapping and wording ("Give the file's full path, not one starting with ~: PowerShell does not turn ~ into your home folder."), NIT replyFileTaught is now `() => true`.
