# win-attach-cost-7232

**Posture:** production

Addresses #7232 (Windows reply attach: the per-attach project-folder walk/resolve grows with the board, a dead mapped
drive stalls it, and per-agent profile dirs on a share are touched on every attach). Design produced 10-27 from a
read-only study of engine/replyfile.js (#7221's hardening), engine/winpath.js, engine/projects.js, engine/create.js,
engine/instructions.js. NOT YET BUILT.

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
