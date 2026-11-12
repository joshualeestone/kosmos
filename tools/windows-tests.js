'use strict';
/**
 * #1777 -- run the Windows tests ON WINDOWS.
 *
 * This fleet develops and tests on macOS. The engine carries dozens of test files about its
 * Windows behaviour, and on a Mac they either simulate win32 or skip the arms that need the
 * real thing, so a green suite here says nothing about Windows (#1777's "false green"). The
 * `windows` job in .github/workflows/windows.yml runs this script on a real Windows runner.
 *
 * WHAT IT RUNS: every test file with "win32" in its name, in engine/ and at the repo
 * root; the root's tools.win-* / tools.windows-* files; and the files named in ALSO
 * (engine) and ALSO_ROOT. One file at a time, stdin closed (a child that reads
 * stdin would otherwise wait for ever), with a per-test timeout so a hang is named as the test
 * that hangs, and an overall budget so the job ends with a verdict rather than being killed.
 * Left out on purpose: the files in HOST_BRANCH_EXCLUDED, each with its reason; github.test.js,
 * which the rule never selects (a fake `gh` script, measured red on Windows in #1777); and
 * tools.build-windows / tools.publish-windows (Mac-side release tooling that builds the Windows
 * bundle; it never runs on Windows).
 *
 * FLAKY: a few tests' results depend on the runner's own network or timing; FLAKY names them,
 * and they are not judged either way. A kill or crash is never excused as flaky.
 *
 * SKIPS: a selected file whose EVERY test skips is a failure unless ALL_SKIP_OK names it, since
 * this job is the only place its arms run. A file that skips SOME of its tests is counted in the
 * log, not judged. An ALL_SKIP_OK file whose tests now run is stale on CI; off CI (your own Windows
 * computer, which may have the runners the CI runner lacks) it reads "ran here" instead (#8368).
 *
 * MEASURED: a line a test prints starting "MEASURED: " is copied to this log even when the file passes.
 *
 * HOW IT JUDGES: a failing file is a failure unless KNOWN_RED lists it, with its card AND the
 * exact tests expected to fail. Any other failing test in a listed file, or a listed file that
 * was killed (a hang), is a failure. A listed test that now PASSES is also a failure, "take it
 * off the list", so the list cannot turn into a permanent excuse or hide what else goes red in
 * the same file. A stale entry fails every run on main, and a PR's run only when the PR touches
 * that file or this script (staleBlocks). Measured on windows-latest before this was written: see
 * #1777.
 *
 * WHAT A GREEN HERE IS NOT: a GitHub Windows runner is a Windows Server image, run as an
 * admin, with no Kosmos user setup. It is evidence about Windows, not about a user's laptop.
 *
 * ON YOUR OWN WINDOWS COMPUTER (#7247): `node tools/windows-tests.js` (and `npm test`, through
 * tools/run-tests.sh) loads tools/no-schtasks-preload.cjs into every node process the run starts,
 * so their schtasks calls do not reach the computer's real Task Scheduler, where Kosmos keeps its
 * board and agents. It guards node only: test:shell's bash scripts never load it, and a process
 * started with an environment that replaces NODE_OPTIONS or leaves it out runs unguarded. Most
 * tests stub their scheduler calls; one that does not could end a live task, such as the board's.
 * A test that needs the real scheduler sees schtasks.exe as missing (ENOENT). On
 * CI the preload is not loaded. To run against the real scheduler on purpose, on a computer whose
 * tasks you can lose, set KOSMOS_TESTS_REAL_SCHTASKS=1. To see every refused call, set
 * KOSMOS_SCHTASKS_BLOCK_LOG to a file path.
 */

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

// Files without "win32" in their name that still speak about Windows behaviour. The engine ones
// are named bare; root ones carry no prefix. Every test file that branches on a win32 HOST must
// be selected here or excluded in HOST_BRANCH_EXCLUDED, or the Mac-side test goes red (#1777).
const ALSO = ['attachments-stream-6734.test.js',   // #6734: the store's stream lifecycle (rename/remove after close)
  'tunnelcommand-8378.test.js',   // #8378: a .js connector stand-in really starts through node on Windows
  'connect.install-997.test.js',   // kosmos#8378: the Claude install contract on Windows (claude.exe download, .exe runnability)
  // kosmos#8378: the token-only guard's test files. Their sandbox is made outside the home (test-support/tmpscope-outside-home.js),
  // so the arms that hold on Windows run there (#5664 step A among them); each arm about the macOS or Linux guard, POSIX
  // startup files, POSIX path lines, the PATH scan Windows does not build yet or /bin/bash skips with its reason.
  'hookscripts-5774.test.js', 'startupfiles-5774.test.js', 'startplugins-5774.test.js', 'launchpath-5516.test.js',
  'configstart-5516.test.js', 'launchprune-5663.test.js', 'boardkeychain-4491.test.js',
  'feedbackday-7875.test.js',   // #7875: kosmos feedback day, run through the Windows CLI's own handler
  'agentpermission-5406.test.js', 'backupdevicekey-5535.test.js', 'platform.test.js', 'store.test.js', 'windows-coupling-audit-1732.test.js', 'runners.win-runnable-2270.test.js',
  'create.test.js', 'outbox.test.js', 'remove.test.js', 'world-guard-lift-1704.test.js', 'personalinstr.test.js',
  'setup-assistant.winrules-4752.test.js',   // #4752: the guide's real rules, read on a Windows host
  'securewrite.fsync-5434.test.js',   // #5434: its Windows-only skips (EPERM, EISDIR) run only there
  'projects.linuxopen-5881.test.js',   // #5881: its Linux arms and its Mac and Windows controls run there (the Windows one through a spy); the stand-in arm skips
  'accounts.fsync-5434.test.js',   // #5434 slice 2: the account stores' saves must work on Windows too
  'create.switchmem-7410.test.js',   // #7410: a switch off Claude copies its notes; its runner stand-ins carry .cmd on Windows
  'create.switchwords-7445.test.js',   // #7445: a switch between two non-Claude runners says the conversation does not come across; stand-ins carry .cmd
  'store.fsync-5434.test.js',   // #5434 slice 4: store.js's profile, settings and picture saves, on Windows too
  'orgkeypin-5686.test.js',   // #5686 b1-mac: the company-key pin is written and checked on Windows too (its 0600 check skips there)
  'manifest-verify.recovery-6609.test.js',   // #6609, #6692: the release key list record on Windows too (hard link, rename, folder fsync, and its access list in place of 0600/0700); its read-only arm skips there
  'allowance.fsync-5434.test.js',   // #5434 slice 5: the account folder's weekly files, on Windows too
  'create.codexfsync-5434.test.js',   // #5434 slice 7: the codex config.toml rewrite, on Windows too
  'create.codexlock-5434.test.js',    // #5434 slice 8: one lock for the codex config.toml writers; the trust append flushed
  'trust.fsync-5434.test.js',   // #5434 slice 6: trust.js's Claude Code config and settings saves, on Windows too
  'personfsync-5434.test.js',   // #5434 slice 9: ~/.claude.json and agy settings saves, on Windows too
  'agyhooks.fsync-5434.test.js',   // #5434 slice 10: agy's .agents/hooks.json save, on Windows too
  'setupsettings.fsync-5434.test.js',   // #5434 slice 11: the guard's Claude Code settings saves, on Windows too
  'instructions.fsync-5434.test.js',   // #5434 slice 12: an agent's brief and its kept previous version, on Windows too
  'undo.fsync-5434.test.js',   // #5434 slice 13: Undo's restore, saved-aside copy and kept copies, on Windows too
  'backupstate-5535.test.js',   // #5535 E0.6: the backup state file; a rename refused while a scanner holds it must read as retry on Windows
  'boardauth.fsync-5434.test.js',   // #5434 slice 14: board.token flushed, a zero-filled one healed, on Windows too
  'secrets.fsync-5434.test.js',   // #5434 slice 15: world id, applied policy and phone-notify state saves, on Windows too
  'create.supfsync-5434.test.js',   // #5434 slice 16: the supervisor and report bridges install, on Windows too
  'state.fsync-5434.test.js',   // #5434 slice 17: worlds, projects, removed list, you.json, policy.json saves, on Windows too
  'chat.fsync-5434.test.js',   // #5434 slice 18: conversation threads and the DM seen-cursor, on Windows too
  'switches.fsync-5434.test.js',   // #5434 slice 19: fourteen small setting and marker saves, on Windows too
  'records.fsync-5434.test.js',   // #5434 slice 20: twelve Kosmos records, on Windows too
  'state21.fsync-5434.test.js',   // #5434 slice 21: sign-in state, agent browser config, feedback, Windows records, launch record
  'undoindex.fsync-5434.test.js',   // #5434 slice 22: Undo's switch and index, and the sweep's unreadable-index guard
  'caches.fsync-5434.test.js',   // #5434 slice 23: caches, markers and nudge records, on Windows too
  'settingswrite.fsync-5434.test.js',   // #5434 slice 3: the provider settings writers, on Windows too
  'store.real-root-5418.test.js',   // #5418: the test-process root rule is live in this job, so its own test runs here too
  'sendertoken.revokeifunchanged-5418.test.js',   // #5418 ask 2: the cleanup's last guard, on Windows too
  'sendertoken.prune-ended-5208.test.js',   // kosmos#5208: sealing, compacting and deleting files a reader may hold open, on Windows too
  'restoresink.test.js',   // #5536: the restore sink's Windows duties (Unicode names, link on NTFS, junction refusal) are measured here
  'restoreresume-5536.test.js',   // #5536 slice 3: resume on NTFS (case-folded names, the record and lock identity checks where O_NOFOLLOW is 0)
  'restoreworld-5536.test.js',   // #5536 slice 4b: the restored workers and projects moved into the new Kosmos by rename on NTFS, and the sink opened on the folder made for it
  'accounts.wiredefaulthooks-5612.test.js',   // #5612: the default account's reporting hooks, wired on the real win32 platform
  'computerprint-5532.test.js',   // #5532: the computer print's real-registry arm reads this runner's registry
  'orgenroll-5531.test.js',   // #6113: its owner-only checks skip and its unreadable-id arm swaps the file for a folder on Windows
  'cert-watch.test.js',   // kosmos#6602: its owner-only mode check skips on Windows; the rest (the reader, the switch file) runs there
  'sheetpreview.test.js',   // kosmos#8122: the spreadsheet preview's link refusal must hold on Windows, which has no O_NOFOLLOW (only the FIFO arm skips)
  // kosmos#8378: shared Windows fixtures (a stand-in Task Scheduler in test-support/jobfixture.js, runner stubs Windows
  // counts as runnable in test-support/runnerstub.js, USERPROFILE beside HOME). Each arm about launchd, tmux, POSIX
  // modes or the macOS LaunchAgents survey skips with its reason; the rest runs here.
  'discover.adopt.test.js', 'qwen-review2-5977.test.js', 'machine.test.js', 'register.test.js', 'delete-leftover.test.js',
  'connect-keep-8293.test.js', 'create.compat-7206.test.js'];
// test-support.remove-tree.test.js (#5074): the shared win32 cleanup retry's own tests, which ran here inside the
// shims file before the helper moved.
const ALSO_ROOT = ['cli.world-outbox-1704.test.js', 'engine.boardauth-1946.test.js', 'report-hook-allowed-5495.test.js',
  'test-support.remove-tree.test.js',
  'tools.cleanup-fixture-tokens-5418.test.js',   // #5418 ask 2: the cleanup tool must plan and remove the same way on Windows
  'engine.reachable.test.js',   // #5548: its caller keys are posix so a module is not its own caller; measured red here before
  'tools.command-words-7262.test.js',   // #7262: the shared reader; since #7318 its tool-guard arms run here too
  'tools.run-tests-chunks-7257.test.js',   // #7257: npm test's node --test in chunks under Windows' command-line cap
  'cli.project-remove-member-7405.test.js',   // kosmos#8378: the Windows CLI's remove-member arms run here; its Mac CLI arms skip by skipOnWin32
  // kosmos#8378: the board's roster through the pane source the Windows board uses, and its jobs in a stand-in Task
  // Scheduler; the tmux-stop, launchd and bash sign-in mock arms skip with their reasons.
  'server.test.js', 'server.disconnect-stop-2570.test.js', 'web.not-running.test.js',
  'server.codexlimits-6176.test.js'];   // kosmos#8454: a moved Codex agent's job time, read from its Scheduled Task's file

// Test files that branch on a win32 host but are not run on Windows, each with why.
const HOST_BRANCH_EXCLUDED = {
  'engine/status.panes-async-6173.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it fakes tmux with a #!/bin/sh script run by its shebang line, which Windows cannot run',
  'engine/last-look.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it reads a real tmux server of its own, and Kosmos runs no tmux on Windows',
  'cli.inputkeep-6774.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.limitmsg-5805.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.proof-visible-6358.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos through /bin/bash by an absolute POSIX path, which Windows cannot run',
  'cli.start-own-pgroup-4669.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs kosmos start through /bin/bash, and reads /bin/ps, by an absolute POSIX path, which Windows cannot run',
  'cli.startedby-5450.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos through /bin/bash by an absolute POSIX path, which Windows cannot run',
  'cli.task-webhook-1307.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.whoisleft-8137.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.agents-setE-2321.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.body-file-5970.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.busy-health-4466.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do; and it runs install/kosmos through /bin/bash by an absolute POSIX path, which Windows cannot run',
  'cli.claim-6946.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.community-comment-4373.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do; and it runs install/kosmos through /bin/bash by an absolute POSIX path, which Windows cannot run',
  'cli.community-edit-5574.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.community-endorse-4913.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.community-follow-4774.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.community-post-4289.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.community-read-4373.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.community-vote-4884.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.community-withdraw-5574.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.file-notices-7989.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.gaps-4891.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.heldq-7915.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.inbox-4784.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.inbox-unanswered-7155.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.livecheck-prefix-8156.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos through a bash looked up on a PATH of absolute POSIX folders (/usr/bin:/bin:/usr/sbin:/sbin), which Windows does not have',
  'cli.msg-stdin-2909.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.msgqueue-5187.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.post-ambiguous-4653.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.post-inreplyto-3224.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.post-new-3224.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.post-noreply-2908.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.post-setE-2321.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.post-stdin-2909.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.project-create-3388.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.project-pause-4771.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.project-role-5300.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.project-show-4581.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.project-who-7989.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.react-2255.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.reply-file-6726.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.reply-stdin-4582.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.room-idreject-2702.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.room-reopen-2710.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.start-reclaim-4679.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-activity-5874.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-assign-4914.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-close-many-7412.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-close-parent-7514.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-hold-4771.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-list-across-7057.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-list-compact-6761.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-list-mine-7992.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-list-state-5705.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-message-to-7408.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-nobody-5376.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-number-5175.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-reopen-6157.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-repeat-minutes-6893.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-replaced-6923.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-reviewer-4787.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-show-8202.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.unhold-owner-7407.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'server.builttell-6330.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'server.community-read-soon-5636.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'server.subtasks-3861.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'engine/supervisor.pane-reach-1160.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs the supervisor (bin/agent-supervisor.sh) through /bin/bash by an absolute POSIX path, which Windows cannot run',
  'install.boot-adds-5584.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it gives the board a fake tmux (test-support/fake-tmux.sh) that Windows cannot run by its shebang line, so the heartbeat never ticks and prompter-nudges.json is never written (a real Windows board does write it)',
  'install.sealed-app-5896.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs the install helper through /bin/sh by an absolute POSIX path and relies on the POSIX executable bit, neither of which Windows has',
  'install.uninstall-sweep.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs the Mac and Linux uninstall through /bin/bash by an absolute POSIX path, which Windows cannot run',
  'report-hook-killguard-4671.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it is the Mac and Linux kill guard (install/kosmos-report-hook.sh), run through /bin/bash by an absolute POSIX path; Windows does not install it (its hook is engine/kosmos-report-hook.js, which has no kill guard: #8406)',
  'server.blocked-owner-person-5318.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs a line taken from install/kosmos (the Mac CLI) through /bin/bash by an absolute POSIX path, which Windows cannot run',
  'server.post-project-2837.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it fakes tmux with a shell script (test-support/fake-tmux.sh) run directly by its shebang line, which Windows cannot do',
  'server.task-same-text-5319.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs a line taken from install/kosmos (the Mac CLI) through /bin/bash by an absolute POSIX path, which Windows cannot run',
  'supervisor.agyseed-4417.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs the supervisor (bin/agent-supervisor.sh) through /bin/bash by an absolute POSIX path, which Windows cannot run',
  'supervisor.retire-token-4530.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs the supervisor (bin/agent-supervisor.sh) and its fake runners through /bin/bash by an absolute POSIX path, which Windows cannot run',
  'tools.prove-it-fails-restore-7619.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs tools/prove-it-fails.sh through /bin/bash, and reads /bin/ps, by an absolute POSIX path, which Windows cannot run',
  'tools.release-gate.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs the Mac release cut (tools/release.sh), which hands POSIX paths from Git Bash to native node, so node reads them as other Windows paths; the release cut only runs on a Mac',
  'tools.serve-watch.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it posts through #!/bin/sh stub commands run by their shebang line, which Windows cannot do; serve-watch is a Mac fleet tool run by launchd; and it builds a launchd plist (a Mac file) from POSIX paths with the host path module; serve-watch is a Mac fleet tool run by launchd',
  'tools.gap-alarm.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it posts through #!/bin/sh stub commands run by their shebang line, and points claude-msg at the tmux socket folder under process.getuid(), neither of which Windows has; gap-alarm is a Mac fleet tool run by launchd; and it puts a #!/bin/sh git on a colon-separated PATH, which Windows can neither run by its shebang line nor read; gap-alarm is a Mac fleet tool run by launchd; and it builds and installs a launchd LaunchAgent (a Mac file) from POSIX paths; gap-alarm is a Mac fleet tool run by launchd',
  'tools.publish-windows-2008.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs tools/publish-kosmos-windows.sh, Mac-side release tooling that never runs on Windows, and builds its fixture with the zip command, which Windows does not have',
  'install.reachable-1662.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs functions cut from install/setup.sh, the Mac and Linux installer, through sh -c, and a script that long passed on the Windows command line reaches Git Bash cut short; Windows installs Kosmos with its own installer and never runs setup.sh',
  'install.linux-board-4920.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs blocks cut from install/setup.sh through /bin/sh by an absolute POSIX path, which Windows cannot run; the systemd board is Linux only; and the systemd board is Linux only, and linuxboard refuses a folder with a backslash in a systemd unit, which every Windows folder has',
  'engine/status.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it reads the tmux socket folder under process.getuid(), which Windows does not have; and it fakes tmux with #!/bin/sh scripts run by their shebang line, and reads the tmux socket folder under process.getuid(), neither of which Windows has',
  'supervisor.provider-key-inject-3296.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs the supervisor (bin/agent-supervisor.sh) through /bin/bash by an absolute POSIX path, which Windows cannot run',
  'engine/openaiaccounts.chatgpt-reauth-2584.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it fakes codex with a #!/bin/bash script (with a TERM trap) run by its shebang line, which Windows cannot do',
  'engine/orgchartcodex.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: the Codex org-chart reader is off on Windows by design (engine/orgchartcodex.js WHY_WINDOWS)',
  'engine/manipcheck-5683.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: agent-event reporting is off on Windows by design (engine/agentevents.js, kosmos#5683 review 41): its tick reads nothing there; and it is about a macOS sandbox refusal of a bash command, and Windows has no macOS sandbox; agent-event reporting is off on Windows by design (engine/agentevents.js, kosmos#5683 review 41)',
  'engine/agentevents-5683.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it classifies commands and file paths naming POSIX paths (/Users/...) with the host path module, which on Windows reads them as Windows paths; agent-event reporting is off on Windows by design (engine/agentevents.js, kosmos#5683 review 41); and it is about a macOS sandbox refusal of a bash command, and Windows has no macOS sandbox; agent-event reporting is off on Windows by design (engine/agentevents.js, kosmos#5683 review 41)',
  'engine/create.tmux-linux-4917.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: the Linux tmux lookup asks runners.isRunnable, which on a Windows host judges by PATHEXT, so an extensionless tmux never counts; the lookup runs only on Linux',
  'cli.accounts-5359.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.agent-token-verbs-4491.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.board-proof-1765.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.connections-4451.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.handoff-6506.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.notice-7153.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.records-6994.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-donewhen-5152.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-message-summary-4540.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-ran-retry-5643.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-ran-unchanged-5643.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.task-told-5836.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.token-refused-5333.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'cli.tool-failed-6071.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do',
  'engine/connect-oldjob-8294.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arm that needs it: the "$HOME/..." spelling is made only for a folder under the home and a forward slash, and Windows paths use backslashes (os.homedir() also comes from USERPROFILE there, not HOME)',
  'tools.sbom-o05.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arms that need it: readTmuxBundle reads the bundle with /usr/bin/tar, an absolute POSIX path, which Windows cannot run; the SBOM is built only for the Mac release',
  'bundle.manifest.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the arm that needs it: it reads the POSIX executable bit of tools/verify-manifest.sh, which Windows does not keep',
  'accounts.delete-primary-2684.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine.boardauth-leaf-2509.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine.dirmode-1763.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/backupagy.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/backupmemberkey-5744.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/chat.stuckinput-6717.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/chat.unsent-6436.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/cloudflare.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/communitynudge-5211.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/fedseal.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/filenotices-7989.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/geminiaccounts.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/githubdevice.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/grokaccounts.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/prompternudge.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/qwenaccounts-5977.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/tokendoors.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/trust.createifabsent-2129.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/undo-5153.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/wouldping.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'server.claude-apikey-2420.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'server.storecheck-7248.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'cli.project-test-8236.test.js': 'its win32 branch only skips the Mac CLI arm (install/kosmos is bash); the Windows CLI is driven in-process in the same file (#8236)',
  'cli.task-files-8214.test.js': 'its win32 branches only skip the Mac CLI arms (install/kosmos is bash); the Windows CLI is driven in-process in the same file, and filesLines takes the platform as an option, so its Windows rule is tested on any host (#8214)',
  'server.agent-restart-removed-8071.test.js': 'its win32 branch only picks the expected answer for a removed agent named in other case, the same answer as on the Mac: the route ignores case through one flag that is true on both (kosmos#8071), so the Mac run covers the arm Windows would take; the file boots the whole board, which the Windows runner does not',
  'engine/machinecost-7978.test.js': 'its win32 branches only skip: the module does not run on Windows, which has no tmux or ps (#7978)',
  'engine/store.mode-hardening-1760.test.js': 'its win32 branch skips every arm: it checks POSIX file modes (the data root 0700, the message log 0600), which Windows does not have; chmod there only toggles read-only (#1760).',
  'engine/store.chmod-retry-7554.test.js': 'its win32 branch skips every arm: it checks POSIX file modes (whether the data root is tightened to 0700 after an EBUSY, EPERM or EACCES chmod), which Windows does not have (#7554)',
  'server.builtcommit-7508.test.js': 'its win32 branches only skip the Mac CLI arms (install/kosmos is a bash script, which a Windows runner does not run); the Windows CLI arms of the same file drive tools/windows/kosmos-cli.js through its own entry point with real git, and run on every host (#7508)',
  'engine/loginadvlog-7194.test.js': 'its win32 branch only skips the real `ps -o comm=` capture (Windows has no ps, and the login-notice log reads tmux panes, which Kosmos does not run there); every other arm is string parsing that runs the same on the Mac',
  'engine/tmux-kill-helper-6857.test.js': 'its win32 branches skip every arm that needs tmux or a uid: killServerAt ends a tmux server by its socket path, and Kosmos runs no tmux on Windows; its fake tmux is a /bin/sh script. The one arm with no tmux (an empty socket path throws) runs everywhere',
  'server.attachment-stream-6734.test.js': 'it counts open descriptors through /dev/fd, which Windows does not have, and its win32 branches skip the FIFO and file-mode arms (no FIFOs or POSIX modes there); the stream lifecycle it covers that matters on Windows is run there by engine/attachments-stream-6734.test.js (#6734)',
  'server.remotestepup-6595.test.js': 'its win32 branch only skips the R01c orphaned-tunnel arm (kosmos#6669), which reads the real process table with ps, a Mac and Linux tool; the rest of the file tests the remote step-up routes, which take no platform branch',
  'server.filebrowser-6724.test.js': 'its win32 branch only skips the backslash-name arm (a backslash cannot be in a Windows name, so the case does not exist there); the file walks real symlinks and hard links throughout, which a Windows runner cannot make without admin; the Windows paths of the gates it uses (resolveListedFile, sameListedPath, sameOpenedFile) are tested in engine/projects.download.win32-5165.test.js',
  'engine/remote-mode-6548.test.js': 'its win32 branch skips every arm: it checks POSIX file modes (0600 under three umasks), which Windows does not have; the write it tests keeps 0o600, which Windows reads only as not read-only (#6548).',
  'engine/remote.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips five arms: one because it checks POSIX file modes, which Windows does not keep; three because it makes saves fail with a read-only POSIX folder mode (chmod 0o500), which Windows does not keep; one because it sends two environment names that differ only in case (ALL_PROXY and all_proxy), which cannot both exist in a Windows environment',
  'server.phonenotify-718.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips one arm: it makes the save fail with a read-only POSIX folder mode (chmod 0o500), which Windows does not keep',
  'engine/agykeep-5812.test.js': 'its win32 host branch only skips the real-agy arm (a Mac CLI against a fake Gemini API; Kosmos runs no agy agents on Windows); the bridge\'s Windows paths are tested through its platform seam on every non-Windows host',
  'engine/codexhooks-5812.test.js': 'it asserts the POSIX forms (a quoted sh command, a basic-string trust key) on the host platform, and on win32 install() writes the win32 forms instead; those are tested in engine/codexhooks.win32-8348.test.js (kosmos#8348), which this job runs',
  'engine/grokkeep-5812.test.js': 'its win32 host branch only skips the real-grok arm (a Mac CLI against a fake model); the bridge\'s Windows paths are tested through its platform seam on every non-Windows host',
  'engine/signedoutaccounts-5948.test.js': 'its win32 branches (#5948) only skip the chmod-000 and symlink arms; its other arms use POSIX-spelled fixture paths, and its logic (paths plus file reads) is covered on the Mac and Linux',
  'engine/usage-world-5532.test.js': 'its win32 branches (#5532) only skip the chmod and symlink arms; the usage scan it tests reads Claude transcripts the same way on both, and engine/usage.test.js is not run on Windows either',
  'engine/agentbrowser.test.js': 'its win32 branch only skips a read-only-folder arm; the file describes macOS',
  'engine/usagepoll-7152.test.js': 'its win32 branches (#7152) only skip the POSIX file-mode (0600) and read-only-folder arms, which Windows does not have; its credential arms fake the macOS Keychain on POSIX-spelled paths, and the off-macOS path (the folder\'s .credentials.json) is tested with platform linux on every host',
  'server.builtsha-6330.test.js': 'its win32 branches (#6330 slice 2) only skip the two Mac CLI arms (install/kosmos is bash); the Windows CLI\'s --file is tested in tools.windows-kosmos-cli-570.test.js, and the engine and route arms run everywhere',
  'test-support.stray-processes.test.js': 'its six ps-based tests skip on win32 (killUnderScope reads ps, which Windows has not, and does nothing there); its pure names() test runs on the Mac and Linux (#6362)',
  'test-support.tmpscope.test.js': 'its win32 branches (#6362) only skip the locked-folder arm (POSIX permissions) and the left-running-child arm (bash and POSIX signals); tmpscope itself is plain node fs and its other arms run on the Mac and Linux; the win32-only branch of tmpscope.js (TEMP and TMP, the retrying sweep, kosmos#8378) is covered by test-support.tmpscope.win32-8378.test.js, which this job runs',
  'engine/status.codex-model-switch-4416.test.js': 'the guard it tests is Mac-only by design: it compares a rollout with the launch plist\'s mtime, and a Windows Scheduled Task has no file to compare',
  'engine/geminisettings.test.js': 'its win32 branch only skips a POSIX file-mode arm',
  'engine/communitysend.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'engine/communitysend-why-5435.test.js': 'its win32 branch (#5435) skips the read-only-folder arm; its other arms are platform-free and run on the Mac',
  'engine/undo-credential-4491.test.js': 'its win32 branch only skips the FIFO arm (Windows has no FIFOs); it makes symlinks, which Windows allows only with a privilege, and its sibling undo-5153.test.js is not run on Windows either',
  'engine/attachments.facts-5448.test.js': 'its win32 branch only skips the mkfifo arm (Windows has no FIFOs); its sibling attachments.test.js is not run on Windows either',
  'engine/groksettings.test.js': 'its win32 branch only skips a POSIX file-mode arm',
  'engine/securewrite.test.js': 'POSIX file-mode assertions, measured red on Windows (#1777)',
  'engine/sendertoken.test.js': 'its only win32 branch is skipOnWin32 (kosmos#8378), which skips the mode checks: it checks POSIX file modes, which Windows does not keep',
  'server.remote-bind-1112.test.js': 'its win32 branch (#4845) only picks which created-agent source a test puts back, mirroring server.js (createdroster off Windows); the file was never run on Windows and boots the Mac board',
  'server.allowance-3946.test.js': 'its arms build POSIX settings fixtures and link a real account folder by symlink, which Windows allows only with a privilege',
  'server.engine-restart-4408.test.js': 'its win32 branch only skips the restart arm, whose stubs pin the Mac arms (launchctl, the installed CLI); the Windows arm is boardrestart-2238.test.js\'s',
};

// Selected files whose every test may skip on the runner, each with why. Any OTHER selected file
// that runs and skips all of its tests is a red: this job is the only place those arms run.
const ALL_SKIP_OK = {
  'engine/win32agyreply.e2e.test.js': 'needs a signed-in Antigravity; the runner has none',
  'engine/win32agysignin.e2e.test.js': 'needs Antigravity installed; the runner has none',
  'engine/win32codexreply.e2e.test.js': 'needs a signed-in Codex; the runner has none',
  'engine/win32codexsup.integration.test.js': 'needs a real Codex binary; the runner has none',
};

// A failing file listed here does not fail the job, as long as exactly the named tests fail
// in it. Every entry names the card that owns it. Names are as node's spec reporter prints them;
// a failing SUBTEST also marks its parent failing, so list the parent's name as well.
const KNOWN_RED = {
  // Empty since #5645: the 8 native-installer probes (#4266) failed on runners whose TEMP is an 8.3 short path; the
  // installer test now builds its scratch paths in long form.
};

// Tests whose result on the runner depends on the runner's own network or timing: they may pass
// or fail, and neither is judged. Each names its card. Keep this short; a test here is not run
// in any sense that counts.
const FLAKY = {
  // Empty since #4278 made win32handoff's hand-off arm deterministic (a simulated late refusal).
};

const PER_TEST_TIMEOUT_MS = 60000;
// A file's whole run. The slowest file measured on the runner, win32apply, took 413s to 481s
// over five runs; a file past half of this is named in the log, so drift shows before it is a red.
const PER_FILE_TIMEOUT_MS = 1200000;
// No file STARTS after this much of the run has gone; the rest are reported as not run (a red).
// The workflow's timeout-minutes is set above this plus one file's cap, so the job always
// finishes with a verdict instead of being cancelled mid-file.
const START_BUDGET_MS = 33 * 60000;

function selectFiles(engineNames, rootNames = []) {
  const isTest = (n) => n.endsWith('.test.js');
  const engine = engineNames.filter((n) => isTest(n) && (n.includes('win32') || ALSO.includes(n))).map((n) => 'engine/' + n);
  // At the root, the Windows-side tools' tests are named tools.win-* / tools.windows-* (the
  // `kosmos` command a Windows agent runs, the native installer and launcher, the shims).
  const root = rootNames.filter((n) => isTest(n) && (n.includes('win32') || /^tools\.win(dows)?-/.test(n) || ALSO_ROOT.includes(n)));
  return [...engine, ...root].sort();
}

// The failing test names in a run's spec-reporter output: "✖ <name> (<n>ms)" lines, minus the
// file-level line node prints for the file itself (its path, with either separator). Only that
// exact line is dropped, so a real test whose title ends in ".test.js" still counts.
function failingTests(output, file = '') {
  const self = file.replace(/\\/g, '/');
  const names = new Set();
  for (const line of String(output).split('\n')) {
    const m = line.match(/^\s*✖ (.+) \([\d.]+m?s\)\s*$/);
    if (m && !(self && m[1].replace(/\\/g, '/') === self)) names.add(m[1]);
  }
  return [...names];
}

// results: [{ file, ok, failing: [names], killed, notRun, error, tests, skipped }].
// Returns { failed: [{ file, why }], stale: [...], known: [...], ranHere: [{ file, ran }] }.
/* kosmos#8368: `ciRules` says whether to judge as the CI runner does (onCi below, the same CI rule as the scheduler guard). An ALL_SKIP_OK file skips there because the runner has
   no Codex or Antigravity; on a Windows computer that has them, its tests run and pass, which is the point of having
   them, not a stale entry. So "its tests run now" is stale only on CI, where it still catches an entry no longer needed.
   Default true: every existing caller keeps the CI rule. */
function judge(results, knownRed = KNOWN_RED, allSkipOk = ALL_SKIP_OK, flaky = FLAKY, { ciRules = true } = {}) {
  const failed = []; const stale = []; const known = []; const ranHere = [];
  for (const raw of results) {
    // A FLAKY test's failure is dropped before judging; a file failing only those counts as a pass.
    const skipNames = (flaky[raw.file] && flaky[raw.file].tests) || [];
    const kept = (raw.failing || []).filter((n) => !skipNames.includes(n));
    const onlyFlaky = !raw.ok && !raw.killed && !raw.error && !raw.notRun && (raw.failing || []).length > 0 && kept.length === 0;
    const r = onlyFlaky ? { ...raw, ok: true, failing: [] } : { ...raw, failing: kept };
    const entry = knownRed[r.file];
    if (r.notRun) { failed.push({ file: r.file, why: 'not run: the start budget ran out' }); continue; }
    // A pass whose test count cannot be read would disarm the all-skipped rule for it, silently.
    if (raw.ok && (r.tests === null || r.tests === undefined)) { failed.push({ file: r.file, why: 'passed, but its test count could not be read (reporter output changed?)' }); continue; }
    if (r.ok && r.tests > 0 && r.skipped === r.tests && !allSkipOk[r.file]) {
      failed.push({ file: r.file, why: `every one of its ${r.tests} tests skipped on Windows; list it in ALL_SKIP_OK with why, or let its arms run` });
      continue;
    }
    if (r.ok) { if (entry) stale.push({ file: r.file, card: entry.card, why: 'it PASSES now' }); continue; }
    if (entry && r.error) { failed.push({ file: r.file, why: `could not run (${r.error}), which ${entry.card} does not cover` }); continue; }
    if (!entry) { failed.push({ file: r.file, why: r.killed ? 'killed (a hang or the file cap)' : r.error ? `could not run (${r.error})` : 'failed' }); continue; }
    if (r.killed) { failed.push({ file: r.file, why: `killed (a hang or the file cap), which ${entry.card} does not cover` }); continue; }
    const unexpected = (r.failing || []).filter((n) => !entry.tests.includes(n));
    if (unexpected.length || !(r.failing || []).length) {
      failed.push({ file: r.file, why: unexpected.length
        ? `failing beyond ${entry.card}: ${unexpected.join(' | ')}`
        : `failed with no failing test named, which ${entry.card} does not cover` });
      continue;
    }
    const nowPass = entry.tests.filter((n) => !r.failing.includes(n));
    if (nowPass.length) stale.push({ file: r.file, card: entry.card, why: `these pass now: ${nowPass.join(' | ')}` });
    known.push({ file: r.file, card: entry.card });
  }
  const seen = new Set(results.map((r) => r.file));
  for (const [file, entry] of Object.entries(knownRed)) {
    if (!seen.has(file)) stale.push({ file, card: entry.card, why: 'not run' });
  }
  for (const [file] of Object.entries(allSkipOk)) {
    const r = results.find((x) => x.file === file);
    if (r && r.ok && r.tests > 0 && r.skipped < r.tests) {
      if (ciRules) stale.push({ file, card: 'ALL_SKIP_OK', why: 'its tests run now' });
      else ranHere.push({ file, ran: r.tests - r.skipped });
    }
  }
  return { failed, stale, known, ranHere };
}

// A stale entry fails main's run always. On a PR it fails only when the PR touches that test
// file or this script, so a fix landing on main does not turn every other open PR red; main's
// own run then names the entry to drop. changed === null means "not a PR, or the diff could not
// be read": strict.
function staleBlocks(entry, changed) {
  if (changed === null) return true;
  return changed.includes(entry.file) || changed.includes('tools/windows-tests.js');
}

function changedFiles(root) {
  const base = process.env.WINDOWS_TESTS_PR_BASE;
  if (!base) return null;
  const r = cp.spawnSync('git', ['diff', '--name-only', base, 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

// Why a file failed, as node's spec reporter says it: the "failing tests:" section it prints at the
// end, one entry per failing test (each starts "test at <file>:<line>"), minus stack frames. Before
// #4301 only lines containing "Error" were kept, so a test that ran out of its own timeout ("test timed
// out after 30000ms") showed its name and nothing else. Each entry is capped on its own and says what
// it left out, so one long assertion diff cannot hide the next test's reason; entries for tests the
// caller did not expect to fail come first. A crash before that section falls back to the output's tail.
const DETAIL_LINES_PER_TEST = 15;
const DETAIL_TESTS = 10;
// A file that crashed before node printed its failing-tests section: this much of its output's tail.
const CRASH_TAIL_LINES = 60;
// A stack frame: "at" then a location in parentheses or at the end, including the unlocated
// (<anonymous>), (native) and (index N) shapes node prints for built-ins and Promise.all.
// The last frame before an error's properties ends in " {", so that is allowed too.
const STACK_FRAME = /^\s+at .*(\(.*:\d+:\d+\)|:\d+:\d+|\((?:native|<anonymous>|index \d+)\)|\(node:[^)]*\))( \{)?$/;
function failureDetail(output, expected = []) {
  const lines = String(output).replace(/\r/g, '').split('\n');
  const at = lines.findIndex((l) => /^\s*✖ failing tests:\s*$/.test(l));
  const keep = (l) => l.trim() && !STACK_FRAME.test(l);
  if (at < 0) return lines.slice(-CRASH_TAIL_LINES).filter(keep).map((l) => l.trimEnd());
  // An entry starts at its "test at" line. Anything before the first one (normally a blank line) opens
  // an entry only if it has something to keep, so it cannot take a slot as an empty entry.
  const entries = [];
  for (const l of lines.slice(at + 1)) {
    if (/^\s*test at /.test(l)) entries.push([]);
    if (!keep(l)) continue;
    if (!entries.length) entries.push([]);
    entries[entries.length - 1].push(l.trimEnd());
  }
  const named = (e) => { const m = e.find((l) => /^\s*✖ /.test(l)); return m ? m.replace(/^\s*✖ /, '').replace(/ \([\d.]+m?s\)$/, '') : ''; };
  const ordered = [...entries.filter((e) => !expected.includes(named(e))), ...entries.filter((e) => expected.includes(named(e)))];
  const out = [];
  for (const e of ordered.slice(0, DETAIL_TESTS)) {
    out.push(...e.slice(0, DETAIL_LINES_PER_TEST));
    if (e.length > DETAIL_LINES_PER_TEST) out.push(`  ... ${e.length - DETAIL_LINES_PER_TEST} more line(s) of this test's detail not shown`);
  }
  if (ordered.length > DETAIL_TESTS) out.push(`... ${ordered.length - DETAIL_TESTS} more failing test(s) not shown; run the file alone for all of it`);
  return out;
}

/* #7247: the environment each test file runs with. On a Windows computer that is not CI, NODE_OPTIONS gains
   `--require tools/no-schtasks-preload.cjs`, so the file, and every process it starts that keeps NODE_OPTIONS, is
   kept off the live Task Scheduler, where one test that reaches it could end the board's own task. CI's runner is throwaway and its real
   scheduler is part of what this job measures, so it is left as it was; KOSMOS_TESTS_REAL_SCHTASKS=1 asks for the
   real scheduler on a Windows computer too. tools/run-tests.sh reads this same rule (it runs childEnv), so the two
   runners cannot disagree. */
const PRELOAD = path.join(__dirname, 'no-schtasks-preload.cjs');
/* CI as the runners set it (CI=true on GitHub). CI=false or CI=0, which some shells export, is not CI. */
function onCi(env) { return !!env.CI && !/^(false|0)$/i.test(String(env.CI)); }
function guardsScheduler(env = process.env, platform = process.platform) {
  return platform === 'win32' && !onCi(env) && env.KOSMOS_TESTS_REAL_SCHTASKS !== '1';
}
function childEnv(env = process.env, platform = process.platform) {
  if (!guardsScheduler(env, platform)) return env;
  /* Quoted, as the checkout's path may hold a space, and with forward slashes: NODE_OPTIONS reads a backslash inside
     quotes as an escape, so C:\Users\... fails to load (measured on the Windows box), while C:/Users/... loads. */
  const require_ = `--require "${PRELOAD.replace(/\\/g, '/')}"`;
  const prior = env.NODE_OPTIONS || '';
  /* Not added twice; a different copy of a preload already there (an older one kept outside the repo) does not count,
     so this checkout's own is always loaded. Matched by its exact spelling on purpose: a second load of the same
     preload only wraps wrappers that already refuse the same calls, so a missed match costs nothing. */
  return { ...env, NODE_OPTIONS: prior.includes(require_) ? prior : (prior ? prior + ' ' : '') + require_ };
}
/* The one line a run prints about the scheduler on a Windows computer, guarded or not. */
function schedulerLine(env = process.env, platform = process.platform) {
  if (platform !== 'win32') return null;
  if (guardsScheduler(env, platform)) return 'schtasks calls are refused in every test (#7247); KOSMOS_TESTS_REAL_SCHTASKS=1 allows the real scheduler';
  return 'schtasks calls reach this computer\'s REAL Task Scheduler (' + (onCi(env) ? 'CI is set' : 'KOSMOS_TESTS_REAL_SCHTASKS=1') + ', #7247)';
}

function count(output, label) {
  const m = String(output).match(new RegExp('^ℹ ' + label + ' (\\d+)$', 'm'));
  return m ? Number(m[1]) : null;
}

function main() {
  const root = path.join(__dirname, '..');
  const files = selectFiles(fs.readdirSync(path.join(root, 'engine')), fs.readdirSync(root));
  console.log(`windows-tests: ${files.length} files, node ${process.version}, ${process.platform}`);
  const env = childEnv();
  const line = schedulerLine();
  if (line) console.log('windows-tests: ' + line);
  // A selection that finds nothing would pass having run nothing.
  if (files.length === 0) { console.log('windows-tests: no test files selected; refusing to report green'); return 1; }
  const began = Date.now();
  const results = [];
  for (const file of files) {
    if (Date.now() - began > START_BUDGET_MS) { console.log(`NOT RUN ${file}`); results.push({ file, ok: false, notRun: true }); continue; }
    const started = Date.now();
    // On a timeout spawnSync kills this `node --test` process only; the child it runs the file in
    // can outlive it on Windows. A hang is rare enough that the next files sharing the runner with
    // an orphan is accepted, and the hang itself is still reported red.
    const run = cp.spawnSync(process.execPath, ['--test', `--test-timeout=${PER_TEST_TIMEOUT_MS}`, file], {
      cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: PER_FILE_TIMEOUT_MS, encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const output = `${run.stdout || ''}\n${run.stderr || ''}`;
    const ok = run.status === 0;
    // status is null for a kill (timeout or signal) and also for a spawn error or maxBuffer
    // overflow, which carry run.error; only the first is a hang.
    const killed = run.status === null && !(run.error && run.error.code !== 'ETIMEDOUT');
    const ms = Date.now() - started;
    const why = run.error ? ` (${run.error.code || run.error.message})`
      : run.signal ? ` (killed by ${run.signal})` : ok ? '' : ` (exit ${run.status})`;
    const tests = count(output.replace(/\r/g, ''), 'tests'); const skipped = count(output.replace(/\r/g, ''), 'skipped');
    const counts = tests === null ? '' : ` [${tests} tests, ${skipped || 0} skipped]`;
    const slow = ms > PER_FILE_TIMEOUT_MS / 2 ? ' SLOW: over half the file cap' : '';
    console.log(`${ok ? 'PASS' : 'FAIL'} ${Math.round(ms / 1000)}s ${file}${why}${counts}${slow}`);
    // A line a test prints as "MEASURED: ..." reaches this log even on a pass: some facts only this job can see.
    for (const l of output.split(/\r?\n/)) if (/^\s*(# )?MEASURED: /.test(l)) console.log('    ' + l.trim());
    const failing = ok ? [] : failingTests(output, file);
    if (!ok) {
      // Every failing name (a KNOWN_RED entry is copied from these), then why (#4301).
      for (const n of failing) console.log('    ✖ ' + n);
      const expected = [...((KNOWN_RED[file] && KNOWN_RED[file].tests) || []), ...((FLAKY[file] && FLAKY[file].tests) || [])];
      // node's reporter writes the failing-tests section to stdout; reading stdout alone keeps a file's
      // own stderr out of the last entry. A file with no section there (a crash) shows both streams' tail.
      const hasSection = /^\s*✖ failing tests:\s*$/m.test(String(run.stdout || '').replace(/\r/g, ''));
      for (const l of failureDetail(hasSection ? run.stdout : output, expected)) console.log('    ' + l);
    }
    results.push({ file, ok, failing, killed, tests, skipped: skipped || 0,
      error: !killed && run.error ? (run.error.code || run.error.message) : undefined });
  }
  const { failed, stale, known, ranHere } = judge(results, KNOWN_RED, ALL_SKIP_OK, FLAKY, { ciRules: onCi(process.env) });
  for (const k of known) console.log(`known red ${k.file} (${k.card})`);
  for (const h of ranHere) console.log(`ran here ${h.file}: ${h.ran} of its tests ran on this computer (they skip on the CI runner, which lacks what they need)`);
  for (const f of failed) console.log(`NEW RED ${f.file}: ${f.why}. Fix it, or list it in KNOWN_RED in tools/windows-tests.js with its card`);
  const changed = changedFiles(root);
  let blocking = 0;
  for (const st of stale) {
    const blocks = staleBlocks(st, changed);
    if (blocks) blocking += 1;
    console.log(`STALE ${st.file} (${st.card}): ${st.why}; update ${st.card === 'ALL_SKIP_OK' ? 'ALL_SKIP_OK' : 'KNOWN_RED'}`
      + (blocks ? '' : ' (not this PR\'s change, so not failing it; main\'s run will)'));
  }
  const pass = results.filter((r) => r.ok).length;
  console.log(`windows-tests: ${pass} passed, ${results.length - pass} failed (${known.length} known red), ${failed.length} new red, ${stale.length} stale (${blocking} blocking)`);
  return failed.length || blocking ? 1 : 0;
}

module.exports = { childEnv, onCi, guardsScheduler, schedulerLine, PRELOAD, selectFiles, failingTests, failureDetail, judge, staleBlocks, FLAKY, ALSO, ALSO_ROOT, HOST_BRANCH_EXCLUDED, ALL_SKIP_OK, KNOWN_RED, PER_FILE_TIMEOUT_MS, START_BUDGET_MS };

if (require.main === module) process.exitCode = main();
