# win-attach-cost-7232

**Posture:** production

Addresses #7232 (Windows reply attach: the per-attach project-folder walk/resolve grows with the board, a dead mapped
drive stalls it, and per-agent profile dirs on a share are touched on every attach). Design produced 10-27 from a
read-only study of engine/replyfile.js (#7221's hardening), engine/winpath.js, engine/projects.js, engine/create.js,
engine/instructions.js. BUILT 10-27 (A, B1-B5, tests); real dead-drive check not run (needs Josh's sign-out go).

## Decided while building
- B1 keeps #7221's same-share rule: another agent's folder on a remote letter is RESOLVED (not skipped) when the file
  itself is on that letter's share, as a folder written as that share already is. The server just answered for the
  file, so it is no stall; skipping it would judge by spelling and refuse an agent's own file when another project row
  lists the same folder (review r7 finding 2's case). Links onto a remote letter are skipped by spelling, like links to
  a share.
- B1 also covers a link in another agent's folder that leads onto a remote letter (the walk places each reached path),
  and B3 also passes over the agent's OWN project on a remote letter for a local file (same reasoning as B1: another
  computer cannot hold a file on this one). Both fail closed where the share is unknown.
- Share-spelled folders (\\host\share) are placed only when the drive table is known, so an unknown table is exactly
  as before everywhere.
- Refresh: board start + every 60 s (windrives.startRefreshing from server.js start), plus one re-learn per unlisted
  letter. No projects.json change hook exists to reuse; a CLI process writing projects.json must not spawn PowerShell.
- A learn that fails is not retried in the foreground for 60 s (else every attach would pay the 3 s timeout).
- keptRoots uses create.workerDir on every platform (what fileFor's dirname always was), dropping readJob per agent.

## Done when (from the card)
- An attach of a project file on a board with ~200 projects, one on a mapped drive whose server is down, answers in
  under a second (assert a syscall count too, so a slow runner cannot flake it).
- #7221's fail-closed tests (engine/replyfile.win32-7221.test.js) still pass.

## Where the cost and the stalls are (replyfile.js unless noted)
- allowedRoot loops over EVERY project (~271-297); for each OTHER agent's folder: otherFolderSkip (283) -> walkLinks
  (361: lstatSync 611, readlinkSync 624, listed's readdirSync 582 per path part), then projects.folderState (287:
  realpath, stat, access) and idOf(root) (288). Never stops early.
- keptRoots (198-230): instructions.fileFor (211) -> create.workerDir twice -> agentDirRecorded lstat(dir)
  (create.js:719), AND create.recordedRunner -> readJob (schtasks when its cache is cold; keptRoots does not need it);
  aboveIds(own) (214); idOf on 9 KOSMOS_WRITES paths per connected agent (228).
- rootReaches -> drivesReached (517, 524) walks the requester's own folders, which may sit on a mapped drive.

## Design (recommended)
A. engine/windrives.js: a drive table, letter -> local | remote(\\host\share) | absent. One PowerShell spawn:
   [IO.DriveInfo]::GetDrives() with [int]DriveType (GetDriveType answers from the local redirector; NEVER read IsReady
   or sizes, which contact the server) + (New-Object -ComObject WScript.Network).EnumNetworkDrives() for each letter's
   share. Numbers and paths only (no system-language parsing). Rejected: wmic (gone on 24H2), Win32_LogicalDisk (fills
   sizes, can stall), fsutil (localized), HKCU\Network (persistent mappings only). Learned at board start (non-blocking),
   refreshed every 60 s and when projects.json changes; an attach meeting an unlisted letter re-learns once (execFileSync,
   3 s timeout); table unknown -> behaviour exactly as today.
B. Use it only where a skip cannot fail open:
   1. Another agent's folder written on a REMOTE letter: otherFolderSkip returns {kind:'share', leadsTo: unc+rest} with no
      disk access (exactly #7221's link-to-share treatment; skippedMayHold refuses a share file by share tail; a local file
      cannot be in it). Share unknown -> leadsTo null -> OTHER_FOLDER_UNPLACED (fail closed). Server is THIS computer
      (loopback, os.hostname(), os.networkInterfaces() addresses) -> NOT skipped: walked and resolved as today.
   2. Absent letters: skip (realpath would ENOENT -> continue, as today).
   3. Own projects first, then stop early: if none of the requester's own projects holds the file, return before touching
      any other agent's folder. Keep the "same deepest folder, any project lists the agent" rule (294-296).
   4. keptRoots: read the profile dir's SPELLING first (new create.recordedDirSpelling, no lstat). Share or remote letter
      and the file is local -> skip the agent. File on a share -> KEPT_FOR_KOSMOS when mayHold(dir\<each KOSMOS_WRITES>,
      given, real). Otherwise create.workerDir, not fileFor (drops readJob per agent).
   5. drivesReached does not walk a root written on a remote letter.
Rejected: caching per-folder verdicts across attaches (fails open: a folder created later or a link swapped after the
cache filled; #7221 walks fresh deliberately; only de-duplicating folder strings within ONE attach is safe); filtering by
written drive alone (an other agent's E:\x can be a junction into C:\own\nested, reviews 11-1/16-1/22-1; own C: can lead
onto D:, review 4).

## Not covered (state in the PR)
SMB servers with remote-to-local link evaluation (admin-only); a DNS alias of this computer the loopback check misses;
letters remapped between refreshes (remote->local inside the window is the one narrow fail-open); non-SMB mounts
(WinFsp, cloud drives) classified local can still stall; on local disks cost still grows with the project count.

## Testing
- Seams in engine/replyfile.win32-7221.test.js: windrives.setTableForTests (gated like setRealpathForTests, 112); wrap
  lstatSync/realpathSync.native/statSync and projects.setFsWorldForTests so any Z:\ path throws "touched" or busy-waits;
  assert no Z: touches and the right verdict for a local file, a share file under Z:'s share (refused), an unknown share
  (OTHER_FOLDER_UNPLACED), a loopback share (still resolved), an agent dir on Z: (skipped for a local file,
  KEPT_FOR_KOSMOS for a file on that share).
- Scale: 200 project rows (199 local other-agent folders, some nested, one on Z:); time attach with hrtime, < 1000 ms,
  plus a syscall count.
- subst: the review-4 test (407) stays the control that a local letter is still walked.
- A REAL dead drive without admin: write HKCU\Network\Y (RemotePath=\\192.0.2.1\x, ConnectionType=1), sign out/in;
  Y: is then a remembered unavailable mapping. NOTE: sign-out on this box restarts the fleet; ask Josh first (treat like
  a reboot). Run once on main to confirm the stall, then on the branch.

## Riskiest part (for reviewers)
Treating a remote folder as "cannot hold a local file" (B1, B4). Attack with a mapping to this computer under every name
(\\127.0.0.2, \\[::1], FQDN, LAN IP, \\localhost\c$, a user share of C:\outer); a letter changed between refresh and
attach (subst, net use /d); a missing or partial table (must fall back to today); EnumNetworkDrives omitting a letter
GetDrives calls remote (must fail closed, not local); the own-first early exit vs the deepest-folder rule.

## Review rounds

### Review 1 (decided, all fixed; each with a test that fails on c0c0671feb)
1. BLOCKER, share names mis-decoded: Windows PowerShell printed in the OEM code page, so \\srv\Données read as
   Donn\uFFFDes and let another agent's nested file on that share through. SCRIPT now sets [Console]::OutputEncoding to
   UTF-8, and parse (and placeOf, for any table) keeps a share only when it is exactly \\host\share with no U+FFFD;
   anything else is null, so it fails closed.
2. BLOCKER, keptRoots skipped an agent on a remote letter whose share is unknown: now it skips, or keeps by share
   spelling, only when the share is named; otherwise workerDir as before.
3. BLOCKER/WARNING, a table kept for ever while refreshes fail: a table whose last good learn is older than two
   refreshes (120 s) is dropped (unknown, as before #7232).
4. WARNING, a letter the table calls absent but made since (subst): otherFolderSkip no longer treats absent as
   "leads nowhere"; such a folder is walked and resolved as before (a really missing root fails at once, no server).
   drivesReached keeps the absent stop, where it only refuses more.
5. WARNING, this computer's names: \\wsl$ and \\wsl.localhost, COMPUTERNAME (the NetBIOS name), and the IPv4-mapped
   IPv6 spellings of this computer's IPv4 addresses (ipv6-literal.net included) are this computer. DNS aliases stay
   not covered.
6. NIT: one blocking re-learn per refresh in total, not one per letter.
Seams added: windrives.setLearnForTests (clock and learner), scriptForTests; both excused in engine.reachable.

### Review 2 (decided, all fixed; each with a test that fails on 1c007c50d9)
1. WARNING, two shares of one server reaching one folder (\\nas\data\team and \\nas\team as Z:) let a file through
   that main refused by identity. Skipping by spelling now happens ONLY for a local file (the stall the card is about):
   for a file on the network the attach has already reached a server, so other agents' folders on remote letters are
   walked and resolved, and agent folders read with workerDir, by identity as main does. keptShares and the same-share
   exemption are gone (both were spelling compares for a network file). Cost: an attach of a file on the network still
   reads every other agent's folder on a mapped drive, a dead one included (as main).
2. WARNING, a remembered mapping whose server is unavailable: the script also prints EnumNetworkDrives letters
   GetDrives did not list, and parse calls any letter with a share remote whatever its DriveType.
3. NIT: learnedAt is when the learn STARTED, and a result from a learn that started before the current table's is
   dropped (a slow background learn cannot overwrite a newer foreground one).
4. NIT: the 60 s re-learn and the 120 s drop run on performance.now (monotonic), through the clock seam.
5. NIT: the scale bound is base (measured, own project alone) + the sum of (path parts + 6) per folder; a second walk
   of each folder (measured 21 reads a folder against 13) fails it.

### Review 3 (decided, all fixed; each with a test that fails on a032392553)
1. BLOCKER, a stale remembered share on a letter a USB disk or subst has since taken: a share makes a letter remote
   only when GetDrives says 0, 1 or 4 (or omits it); 2, 3, 5, 6 stay local, so the letter is walked and resolved.
2. WARNING, the redirector failing: the script prints !ENUM_FAILED and parse returns null (unknown, as main). Doing
   this exposed a Part A bug: `$e.Count` is a METHOD on the WshCollection, so the comparison threw and the swallowed
   catch meant NO share was ever read on this box (every mapped letter would have been remote with no share, refusing
   every project file board-wide whenever another agent had a project on a mapped drive). Now `$e.Count()`. Checked
   with no mappings (Count() = 0); a real mapping could not be made on this box (net use to the admin share: error 67),
   so Item() on a live mapping is unverified here.
3. WARNING, an agent folder written locally under a link onto a share or a dead mapped drive: keptRoots (for a local
   file) now places it with otherFolderSkip's walk (lstat and readlink only) and passes the agent over only when the
   walk reaches a NAMED share on another computer; a dead link, a share it cannot name, or this computer: read as
   before. Cost: one link walk per connected agent with a recorded folder, per local project-file attach. (A recorded
   folder that is ITSELF a link was already refused by create.usableRecordedDir, which lstats it.)
4. NIT, the blocking re-learn for an unlisted letter: now a background learn (learnSoon), once per refresh; the attach
   reads the letter as absent (walked as main). Header: the remap window is up to 120 s, not 60 s.
