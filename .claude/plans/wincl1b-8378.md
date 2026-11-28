# wincl1b-8378: kosmos#8378 cluster 1, the engine/ half (26 files) on Windows

Splinter 2026-11-28 00:15 handed me the second half of Mona Lisa's cluster 1; split agreed on the card (m7282): Mona
keeps the 25 cli.* files, I take the 26 engine/* files (accountcarry-8048 to connect.willinstall-1556). Worked by the
card's rules (comment 7235170746): shared cause first, a test-environment failure is a fix, skip only what does not
exist on Windows with skipOnWin32 naming the mechanism, a HOST_BRANCH_EXCLUDED entry carrying each reason.

## Measured on GitHub's Windows runner (branch wincl1b-8378-never-merge, never merged)
Mona's run 46115766861 gave the failing tests; my runs 46116648501, 46117122182, 46117804305 and the last two checked
the fixes. Each file was also run on macOS after every change.

## Fixes, not skips (test-environment causes)
- Cross-drive paths: path.relative(cwd, dir) is absolute when cwd is on D: and temp on C:. brief and connect-onefolder
  take their relative form from inside the sandbox (chdir).
- The runner's temp path is an 8.3 short name (RUNNER~1); trust.canonicalOnDisk uses realpathSync.native, which expands
  it. backupsessions and backupsnapshot build their sandbox with realpathSync.native, so it is canonical.
- os.homedir() reads USERPROFILE on Windows: agytrust's script arms set it beside HOME; backuptick-inputs points it at
  the sandbox home (inputsHere protects %USERPROFILE%\AppData whole, and the temp folder is under it).
- hooks.json stores a Windows path with escaped backslashes: agyrefresh replaces the JSON form.
- catalogue.download plants its copy at store.dataRootFor for this platform (AppData/Roaming on Windows).
- connect-agent and connect-onefolder install the shared jobfixture's stand-in Task Scheduler (connecting refuses when
  it cannot tell whether a task exists).
- connect: the fake release servers serve the name download() asks for (claude.exe on win32); the kept, swept and
  partial names carry .exe; the executable-bit check holds only off Windows (a Windows download sets no mode, #3159).
- allowance: on Windows ensureStatusLine writes winCommandFor (kosmos#6213), so the command arms expect the platform's.

## Skips (mechanism absent on Windows)
POSIX file modes (as one guarded assertion where the rest of the arm is platform-neutral); chmod locks (joined to root's own skip where one existed); FIFOs; setup.sh blocks; names
holding a backslash, a control character or a double quote; the launch-env entry (anthropiccompat.enabled refuses every platform but darwin); the Linux
tmux and musl lookups (compared against POSIX spellings).

## Pinned per platform, not skipped
- briefsize: a project folder that is a plain file reads unreadable on POSIX (ENOTDIR) and missing on Windows (ENOENT).

## A real Windows bug, not skipped
- engine/accountcarry-8048.test.js review 6 stays red on Windows: an account move reports a hook written with ~ as a
  loss (mixed path separators in accountcarry.one). Filed as kosmos#9273. My first pass skipped it under a false
  reason (that the hook script runs by its shebang: accountcarry never runs it); review round 1 caught it.

## Skips whose subject exists on Windows (named card)
- chat's spawn-failure arm (absolute POSIX stand-in paths) and backupsnapshot's four name-judgement arms (names Windows
  cannot hold): kosmos#9265.
- claudeaccounts' apiKeyHelper arm (runs `cat '<keyfile>'` through cmd.exe, from a name with a `"`): kosmos#9277, the
  open question of which shell runs an apiKeyHelper on Windows.

## Fixed in review round 3, no longer skipped
- The connect stand-in arms (connect.willinstall, connect.nobinary, connect.test.js's broken-binary and #1922 arms):
  their flows answer through connect.setRunner, and the Windows failure was runners.runnableExactly, which accepts a
  file only by a PATHEXT name. The stand-ins are named .exe on Windows (connect.willinstall's runnable one is node.exe).
  Batches 6 and 12 had skipped them under a false shebang reason; those skips are gone.

## Deferred, for the card owner
- Review round 5 suggested putting the fully fixed files in ALSO (so Windows CI runs them) rather than
  HOST_BRANCH_EXCLUDED, and accountcarry in KNOWN_RED. The card's how-to says every file that gains a win32 branch takes
  a HOST_BRANCH_EXCLUDED entry, so this branch follows it; the suggestion is on #8378 for the card owner to rule on.

## Weakest premise
GitHub's runner is a Windows Server image run as admin, not the box; a symlink arm or a mode arm may behave differently
on Homer's non-admin box. His fresh run confirms what is left.

## Review round 6 (2026-11-28 07:0x)
- backuptick review 8: the whole-test chmod skip is narrowed to the one block that needs a chmod lock (not on Windows,
  not for root); the ..x containment, protectIncomplete and CONTROL parts now run on Windows too. The other chmod-lock
  skips (grep `skip: NO_CHMOD` in engine/) sit on tests whose TITLE names the failure the chmod causes (an unreadable
  record, an unwritable folder); I read the titles, not every body, so a mixed arm like this one may remain.
- Not yet run on Windows CI after merge, stated plainly: 19 of these files go in HOST_BRANCH_EXCLUDED and 7 are in no
  list the selector reads, so until the ALSO-vs-HOST_BRANCH_EXCLUDED question on #8378 is ruled, the 25-of-26 Windows
  pass is evidence from the never-merge check branch only, and accountcarry review 6 (#9273) reds nowhere. The PR says so.
- anthropiccompat launch-env: the reason now names Windows; Linux would refuse the same way (linux.yml last ran on main
  2026-10-07, red), which is not this card.
- Deferred NITs: connect.test.js "lands executable" could assert the .exe name on Windows; willinstall's stand-in choice
  keys on the shell body's text; a node.exe copy fallback is large. Each is recorded, none changes what runs.

## Review round 7 (2026-11-28 07:1x)
- DECIDED: these files stay in HOST_BRANCH_EXCLUDED, not ALSO. Rejected: moving cluster 1 alone into ALSO (with
  accountcarry in KNOWN_RED). Why: group 5 (Renet, already on main) uses HOST_BRANCH_EXCLUDED with the same kind of reason,
  so moving one cluster makes two conventions for one card; whether the passing files should RUN on Windows CI is one
  question for the whole card, recorded on #8378. Weakest premise: that group 5's choice was deliberate rather than
  copied from the card's first cluster. What would change it: the card owner ruling ALSO, then every cluster moves at once.
- willinstall's Windows stand-in now refuses a body that ends neither `exit 0` nor `exit 1`, instead of guessing.
  The "slow" arm never depended on its body (it counts probes through connect.setRunner, on every host).
- agyrefresh's comment named four backslashes; JSON writes two.

## Review round 8 (2026-11-28 07:1x): the 8-round cap, no BLOCKER open
- Corrected in place (prose that was misleading): the accountcarry entry now says nothing on Windows CI runs its red
  while the file is listed; chat and backupsnapshot owed-arm reasons use the exact "what it checks exists on Windows".
- To a follow-up card, per the cap: automove-7548 "#7621 item 2" is a mixed arm skipped whole (its first half needs no
  chmod); anthropiccompat launch-env could pin the Windows refusal (exit 2) rather than skip it; allowance NO_SETUP_SH's
  reason could name the quoted runtime/bin/node form. The ALSO-vs-HOST_BRANCH_EXCLUDED question stays on #8378.
