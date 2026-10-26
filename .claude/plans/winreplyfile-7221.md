# winreplyfile-7221: a Windows board refuses network and device paths for a reply attachment before resolving them

**Posture:** production

Addresses #7221 (follow-up of #6726, Windows half). Branch `winreplyfile-7221`, worktree `work/wt-7221`, built and
verified on the Windows box (Homer), 2026-10-26.

## The problem

`engine/replyfile.js` `attach()` accepted any `path.isAbsolute` path and called `fs.realpathSync.native` on it before
any containment check. On a Windows board:

- `\\host\share\x`, `//host/share/x` and `\\?\UNC\host\share\x` are absolute, so resolving them makes an SMB
  connection before `allowedRoot` refuses them.
- A link in the agent's Files folder that points out to a share is followed by realpath, reaching the share the same
  way.
- A DOS device name on a drive path (`...\Files\COM1`, `...\NUL`) can be opened before `isFile()` refuses it.

The Windows CLI refuses these as typed, but only by spelling; the board is where the file is opened, and any local
process can POST `/api/reply`.

## The premise, measured (the card's weakest point)

On this box, Node 24.19, Windows 11 26100 (probe kept at `work/workers/homer/probe7221.js`):

| Call on a symlink to `\\10.255.255.1\share\x` (unroutable) | Time | Result |
|---|---|---|
| `fs.lstatSync` | 0 ms | isSymbolicLink true |
| `fs.readlinkSync` | 0 ms | the UNC target |
| `fs.realpathSync.native` (first call) | **21016 ms** | UNKNOWN (an SMB attempt; the board's event loop blocked throughout) |
| `fs.realpathSync.native` (repeat) | 0 ms | UNKNOWN (Windows caches the failed host) |

A junction aimed at a share is created by Node, but cannot be followed: `lstat` ENOENT, `readlink` EINVAL, while its
folder lists it as a link (Windows lets a junction name only a local volume). `realpathSync.native` and `statSync` on
`<dir>\NUL` give ENOENT here and open nothing; the name rule is kept anyway (cheap, and older Windows opens the device).

So the card's premise holds for symbolic links: **resolving is the contact**. The refusal must come before the first
realpath, and may use only `lstat` and `readlink`, which do not touch the network.

## The change (win32 only; `attach(..., { platform })` so the test can say which)

1. **By spelling, before any filesystem call** (`winSpellingRefusal`):
   - a `\\` or `//` start: a share, the `\\?\` and `\\.\` namespaces, the local `\\?\C:\` long spelling too (none is
     how an agent names its own file), BUT a plain `\\host\share\...` written inside one of the agent's own project
     folders that is itself written as that share (review 3 finding 2, **decided**: the card's first bullet refuses
     every `\\` start, but a project written as a share attached its files on main, the same "the person chose that
     share" case as a mapped drive, and the card's aim is to refuse BEFORE the contact what would be refused anyway,
     not a file the agent may send. Revertible in one change; said on #7221 for Renet);
   - a colon past the drive (an alternate data stream, `COM1:`), said as a stream, not a network path (review 3 NIT);
   - a last part that is a DOS device name (CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM0-9, LPT0-9 and the superscript
     digits, any extension, trailing dots and spaces dropped as Windows does);
   - a drive letter none of the agent's roots (its Files folder, the folders of the projects it is on) is written on
     or reaches through its own links. A mapped drive is a share under a letter, and a file on a drive no root reaches
     cannot be inside a root. The drives a root reaches are collected by walking its links, lstat and readlink only
     (review 4 finding 1: `C:\Users\me\work` as a junction to `D:\work` put a project's files on D:, which a written-
     only drive rule refused where main attached them), and only when the written drives do not answer, once per
     attach (review 5 finding 2): a file directly in Files touches no project folder, as on main, so a project on a
     mapped drive whose server is down never stalls it.
2. **The links, by lstat and readlink only** (`winLinkRefusal`): each part of the path is lstat'd; a link's target is
   read and followed ONLY when it is a drive path (`X:\...`, also written `\\?\X:\` or `\??\X:\`), a plain relative
   one, or a root-relative one (`\dir\x`, what `mklink` writes for a target typed without a drive: a path on the
   link's own drive, review 11 finding 3), but not `\Device\...` or `\GLOBAL...` (`followableLinkTarget`, an
   allow-list). One more link is followed no further and not refused: one of the agent's OWN project folders that is
   itself a link to a plain share (`C:\x\proj -> \\host\share\proj`), the person's choice of folder as a mapped drive
   is (review 11 finding 2, **decided**: it attached on main); the share it names then counts as one of the agent's
   project folders for the rest of the walk, which goes on down it and still refuses a link there that leaves for
   another server (review 12 finding 1). Anything else is refused unfollowed, and counted as "may reach another
   computer" unless it names a local volume (an allow-list for the local side too, review 14 finding 1: the object
   manager reaches the share redirector many ways, `\??\Global\UNC\...`, `\??\GLOBALROOT\GLOBAL??\UNC\...`,
   `\Device\LanmanRedirector\...`, and a deny-list of share spellings let another agent's project folder linked that
   way be resolved, which is the contact). Review 2 finding 1 measured a
   target written `\\?\GLOBALROOT\Device\Mup\<host>\<share>` reading back as `\??\GLOBALROOT\...` (one backslash, past
   a `\\` deny rule) whose realpath stalled 21 s. A followed target is resolved and walked the same way (rule 1
   applied to each, so a link to another drive is refused too). More than 64 links: refused. 64 is more than Windows
   itself follows (63 in one resolution), so a path the walk gives up on, Windows cannot resolve either: it holds no
   file and its realpath reaches no other computer (review 13 finding 1 set 32 and skipped such folders; review 16
   raised it past Windows' own limit, so a long chain of another agent's cannot be used to block anyone). A local
   file written in its long form (`\\?\C:\...`) is refused with its own sentence, not as a network path (review 13
   NIT): the rules that compare spellings against home and project folders do not see it. A part that lstats
   ENOENT but its folder lists (the junction above): refused, never handed to realpath. Any other lstat error: "could
   not be read".
3. **The real path, once resolved** (`winRealRefusal`): a device name there is refused before the open, and so is a
   network path, EXCEPT for a file written inside one of the agent's own project folders (review 1 finding 2, narrowed
   by review 2 finding 2 from "on a project drive", which on the usual box with Files and projects all on C: exempted
   every attach): projects.js supports a project on a mapped drive ("a Z:\ record whose realpath is \\server\share
   opens"), and those files attached on main. A file written inside the agent's Files folder is let through only when
   that folder ITSELF resolves to a share: a connected agent's Files sits beside its own working folder, which may be
   on a mapped drive or a share (review 17 finding 1: "Kosmos's Files is never on a share" was wrong for them, and
   their files attached on main); a Files folder on this computer keeps the guard. The Files folder also counts as one
   of the agent's folders for rule 1's share exception. `\\?\C:\` (realpath's long local spelling) is local and passes.
4. **allowedRoot resolves a project folder written as a share only for a file on that same share** (review 1 finding
   3, review 2 finding 3): any agent can register such a project (`kosmos project create`), and allowedRoot resolves
   every project folder to judge containment. A share's real path cannot be a folder above a local file or a file on
   another share, so skipping it changes no answer; one on the file's own share may hold it, so it is still resolved.
   A project folder written on a drive is walked by rule 2 first (lstat and readlink, no drive rule; a `\\?\C:\` or
   `\??\C:\` spelling read as its drive path), and skipped when its links leave for a share (review 3 finding 1:
   `C:\x\proj` as a link to `\\host\share` was still resolved). **Only another agent's folder is ever skipped, and only
   when its walk says "a share"** (review 11 findings 1 and 2): every other folder, a local link the walk will not
   follow included, is resolved as on main so identity decides (skipping those let a nested project's file through,
   reproduced); the agent's own folders are always resolved, a share among them included.
5. **A skipped project fails closed** (review 5 finding 1, a fail-open found in this branch): a nested project the
   agent is NOT on exists to keep its files from the outer project's agents, so skipping it must not let the outer
   project answer. When a project of another agent is skipped by rule 4 and its folder may hold the file by spelling
   (inside it as given or as resolved, or on a share whose path below the server matches whatever the server is
   called), the attach is refused. Erring toward refusal can refuse a file main allowed in one rare layout (another
   agent's OUTER project skipped while the agent's own nested one holds the file); refusing is the safe direction.
   Review 8 finding 1 (a second fail-open): a folder in a namespace spelling (`\\.\C:\`, `\\?\Volume{GUID}\`,
   `\\?\GLOBALROOT\Device\HarddiskVolumeN\`) was skipped and could not be placed by spelling. Now `\\.\C:\` reads as
   the drive path it is (like `\\?\C:\`); the Mup device and `\??\UNC` read as the shares they name; a local volume
   written without a letter is resolved as on main (local, no other computer is reached), so identity decides; and
   a folder written through the object manager's root (`\\?\GLOBALROOT\...`), which can name any drive's files,
   counts as "may hold", so it refuses. Any other namespace (`\\.\pipe\`, `\\.\COM1`) holds no files and answers
   "no", so one such project row cannot make every agent's project attach refuse (review 12 finding 2; refusing those
   rows at create time, existing rows included, is on #7229).
   **Review 16 finding 1 (a fourth fail-open in this class, reproduced) and the rule that ends the class:** a skipped
   folder is judged by WHERE ITS WALK LED, not by its own spelling alone. `otherFolderSkip` records, for a folder whose
   links lead to a plain share, the share path that link names (with the rest of the folder's path joined on);
   `skippedMayHold` then says: by its own spelling first; a folder that leads nowhere (a dead junction, a chain longer
   than Windows follows) holds nothing; a folder that leads to another computer cannot hold a file on this one; and
   for a file on a share, it holds it when the file is under the share it leads to (whatever the server is called),
   or when where it leads cannot be named. The repro: this agent's project is a share; another agent's nested project
   is a LOCAL link into that share; judged by its local spelling it held nothing, and its file attached.

On Windows `attach` reads `dmfiles.filesDir` and the projects list once and hands both on, so an attach still reads
each agent's instructions path once (#6726 r5-3) and parses the projects file once.

**Where the code lives** (review 6 findings 3 and 4): the pure rules for how Windows spells a path (shares, namespaces,
drive letters, the link-target allow-list, DOS device names, "written inside") are `engine/winpath.js`, functions of a
string with no disk access. The attachment policy that uses them (the agent's roots, the walk, the refusal sentences)
stays in `engine/replyfile.js`, since it is about what an agent may send. `winpath.WINDOWS_DEVICE_NAME` is now the one
device-name rule: `engine/backuprestore.js` and `engine/win32zip.js` import it in place of their own copies.
**Decided** (review 7 finding 2): no module's behaviour changes. The shared rule is exactly backuprestore's (the names
Microsoft documents, literal spaces before an extension, as Windows trims), so a Mac backup's `con<no-break space>.txt`
stays a name; a first draft used `\s*` and `clock$`, which widened restore on every platform. win32zip keeps refusing
the DOS-era `CLOCK$` as its own extra, in its own file, as it always has (a plain predicate, `isReservedSegment`, not
an object shaped like a RegExp: review 9). The link walk is one function, `walkLinks`, with a per-path callback:
`winLinkRefusal` refuses by the spelling rules at each path it reaches, `drivesReached` collects each path's drive
(review 9: the two had been copies, which would drift).

**Why the walk and the roots stay in replyfile.js** (review 18 finding 1, decided): `walkLinks`, `agentRoots`,
`otherFolderSkip` and the refusals touch the disk and produce ATTACH decisions (sentences, the attaching agent's roots,
which other agent's folder to leave unresolved); `winpath.js` is kept free of disk access on purpose. A separate
`winwalk` module now would have one caller and an interface shaped by one use. The second caller is #7232's work (the
same walk for every agent's recorded folder, before create.js and instructions.js touch it): extract the walk then,
with result codes in place of sentences, when two real uses can shape it. `winpath` exposes predicates only
(`isNamespaceSpelling`, `isLongDrivePath`), not its regexes (review 18 NIT).

**File ids are compared as BigInt** (found by review 9 finding 1, measured): `idOf` compared `dev:ino` as numbers, and
NTFS file ids are 64-bit. On the Windows box 434 of 2000 fresh files had an id past 2^53, where a number keeps 53 bits,
and 19 pairs of DIFFERENT files shared one `dev:ino` key. Every identity check in replyfile was exposed: containment (a
project root matched against the folders above the file), the folders Kosmos keeps, and readOwn's "the open file is the
one the check saw". A wrong match can refuse a file (the `r4-3` failure seen once below fits this) or, worse, attach
one: against iteration 8's code, a file in a folder whose number id equals a project folder's ATTACHED as that
project's, outside every project. This is on main too (#6726 code, Windows only in practice: macOS ids are small). Now
`idOf`, `attach`'s stat and readOwn's fstat and stat read `{ bigint: true }`; `sameFile` compares exactly when both sides
are BigInt and as numbers when a caller passes number stats (tests of readOwn do), as before. Other engine modules
compare `ino` as numbers too; they are #7229 (filed), not this branch, with refusing odd namespace folders at
`kosmos project create` (review 9 NIT).

## Rejected

- Checking only the real path after realpath (the card's literal second bullet): by then the contact has happened.
- Refusing every link in Files on Windows: links to local files in Files work today and are judged by where they land.
- Asking Windows for the drive type (`GetDriveType`) to find mapped drives: Node has no call for it; the root-drive rule
  covers the agent-named path without one.
- Refusing mapped-drive projects outright (review 1 finding 2's other option): they are a supported place for a
  person's project, and the person chose that share.

## Weakest part, named

1. A link swapped to point at a share between the walk and the realpath: the realpath may already have made the
   contact. The open is refused (rule 3) everywhere except inside the agent's own project folders, where a share path
   is allowed by design (a mapped-drive project). Node has no openat-style walk to hold each folder open. Same class
   as the double-swap the file header already names.
2. The OTHER folders an attach resolves to judge containment (review 1 finding 3): a project folder on a drive letter
   that is mapped to a share is still resolved on every attach (a written `\\`, and a local link out to a share, are
   skipped; telling a mapped letter apart needs a call Node does not have; the lstat walk of such a folder touches the
   share too, before its realpath does), and so are the folders Kosmos itself made (the Files folder and its parent,
   each agent's folder, `~/.ssh`, `~/.config`), which a person or a process of this user would have to replace with a
   link to a share; and (review 17 finding 2, stated more exactly) every agent's RECORDED folder, which for a
   connected agent is its own working folder and may simply be written as a share or a mapped drive: `keptRoots` stats
   it, and `instructions.fileFor` lstats it, on every project-file attach. No swap is needed for that contact. Main
   does the same; closing it means checking those folders before create.js/instructions.js touch them, added to #7232.
   Named in the code comment too.
3. A share is matched by how it is WRITTEN, not by identity (review 4 finding 2): a project written `\\fileserver\x`
   whose files' real paths read `\\10.0.0.5\x` (or a DFS path, or another name for the server) is not matched to them,
   and they are refused where main matched by identity. Narrow; the remedy is to write the project folder as Windows
   resolves it. Named in the code comment too.
4. The agent's own project written as a local volume without a letter (`\\?\Volume{GUID}\...`) adds no drive to
   its roots, so a file in it named by a drive-letter path on a drive no other root reaches is refused, where main
   attached it by identity (review 12 NIT). Rare; the safe direction. A share written `\\?\UNC\host\share` is read
   as the plain share it is.
5. A path on a drive no root is written on (any caller of `/api/reply` can name `Q:\x`) walks the agent's OWN roots'
   links to learn the drives they reach (review 6 finding 2). One of the agent's own projects on a mapped drive whose
   server is down then stalls that attach, as any attach of a file in that project already would. Named in the code.
6. Not changed here (review 6 finding 1; review 11 finding 4 asked for a card): every Windows attach of a project
   file walks every OTHER agent's project folder by lstat before `folderState` resolves it. For a folder on a mapped
   drive the walk touches the same server the realpath touches next, so it adds no new place contacted; it is what
   skips a folder that is a local link to a share (review 3 finding 1), which a spelling-only filter could not see.
   Cost and the dead-mapped-drive stall are #7232 (filed), with three options.
7. A link to a share ABOVE one of the agent's own project folders (`C:\x -> \\host\share\x`, project `C:\x\proj`) is
   refused, where main attached its files: only a link that IS the project folder is followed onto a share (review 15
   NIT). The safe direction; writing the project folder as the share, or linking the folder itself, works.
8. Another agent's project folder that is a junction aimed at a share (listed in its folder, unreadable by lstat) is
   left unresolved like a link to a share (review 15 finding 1), so whether realpath contacts the share through it is
   never put to the test. The earlier "0 ms ENOENT" for such a junction was measured just after a stalled realpath on
   the same host, so Windows may have answered from its cache of the failure; it is not relied on.

What would change my mind: a Windows build where `lstat` or `readlink` itself contacts a share (measured not to, here).

## Tests (`engine/replyfile.win32-7221.test.js`)

Named with `win32` so `tools/windows-tests.js` runs it on the Windows CI runner (review 1 finding 1; the
`engine/windows-tests-1777.test.js` guard checks this). Every refusal arm counts realpath calls through replyfile's own
test seam and asserts zero, and asserts it answered in under 2 s, so a refusal with the right words AFTER the contact
is red. Pure spelling arms run on every platform; the link and attach arms run on win32.

- CONTROL: an ordinary file in Files attaches (and does reach realpath).
- `\\host\share`, `//host/share`, `\\?\UNC`, `\\.\NUL`, `\\?\C:\...`: refused unresolved.
- A file symlink and a folder symlink in Files to a share; a junction to a share; a chain of two links ending at a
  share; a link to another drive: refused unresolved.
- NUL, nul.txt, COM1, com1.log, LPT1, CON, AUX.md, "NUL. ": refused unresolved.
- An alternate data stream; a drive no root is on: refused unresolved.
- Second guard: a real path that is a share or a device is refused; `\\?\C:\` real path is not.
- Review 1-2: a file named on the agent's mapped project drive that resolves to a share is not refused as a network
  path; the same share real path for a file named in Files is (the control).
- Review 1-3: with a share-written project of another agent and a local project of this one, a project file attaches
  and only the local project folder is resolved.
- Review 2-1: the link-target allow-list (drive, long, NT and relative forms followed; GLOBALROOT, `\??\UNC`, `\\.\`,
  root-relative, drive-relative, streams and volume GUIDs not); a GLOBALROOT symlink to a share in Files is refused
  unresolved.
- Review 2-2: with Files and a project on the SAME drive, a Files file that resolves to a share is refused, a file
  written inside the project is not.
- Review 2-3: through this box's own admin share (`\\127.0.0.1\C$`, a real share; skipped where unreachable), a file on
  a share resolves the share-written project on its own share and never one on another share.
- Review 3-2: the share-project spelling exception (inside the project, either slash, any case: passes; outside it, a
  sibling with the same prefix, another host, `\\?\UNC`, a device name inside, no share project: refused); through the
  admin share, a file in the agent's own share-written project attaches by its share path, and a share path beside it
  is refused unresolved.
- Review 3-1: a project folder that is a local link to a share, and a project folder under it, are never resolved
  while a local project file attaches.
- Review 4-1: with a second local drive made by `subst` for the arm (removed after; skipped where subst is missing), a
  project written under a C: link onto that drive attaches its files; once no root reaches the drive, a Files link
  onto it is refused unresolved (the control). The subst letter is picked at random among free ones, removed in
  `finally` and on process exit too (review 5 finding 3); every arm needing a free letter skips if Q to Z are taken.
- Review 5-1: a nested project of another agent written `\\?\C:\...\outer\nested` keeps its file from the agent on
  the outer project (refused, as on main; the outer project's own file still attaches); through the admin share, a
  nested share project written on `\\localhost` inside an outer one on `\\127.0.0.1` does the same.
- Review 5-2: an attach of a file directly in Files lstats nothing under the agent's project folder.
- Review 6: the device-name arm reads `winpath.isDevicePart`; the link-target arm reads `winpath.followableLinkTarget`.
  Every timing check is one named bound, `SOON_MS` (10 s: the measured stall is 21 s, and a slow CI runner needs
  room); the realpath count stays the exact guard.
- Review 7: the junction arm also types the junction's name in upper case (refused unresolved, as a junction lstats
  ENOENT in every case, so `listed()` matches names in any case); the shared device rule refuses `con  .txt` but not a
  no-break or ideographic space before the extension, nor `CLOCK$`; `driveOf` reads `C:\`, `\\?\D:\` and `\??\E:\`.
  Against iteration 6's code (74f929a): all three fail.
- Review 8: the namespace spellings (`\\.\C:\` is drive C and local; the Mup device and `\??\UNC` name shares; Volume
  GUID and HarddiskVolume spellings are local volumes; an unplaceable namespace "may hold"); a nested project of
  another agent written `\\.\C:\...` and one written by its volume GUID (read at run time with `mountvol`; skipped if
  none) each keep their file from the agent on the outer project. Against iteration 7's code (324f51b): all three
  fail, the two live arms by attaching the nested file. The six arms that make symbolic links now skip, with that
  reason, where the account cannot make them (no Developer Mode, not elevated); the junction arm needs neither.
- Review 9: up to 4000 folders are made until two DIFFERENT folders share a number id (skipped if none); with one as
  the agent's project folder, a file in the other is refused. Against iteration 8's code (8313e21) it failed by
  attaching that file (`ok: true`): the fail-open, shown.
- Review 10: `isNetworkSpelling` no longer counts a local volume (`\\?\Volume{GUID}\`) as another computer (it still
  counts an unplaceable namespace such as `\\.\pipe\` as not local, the safe reading), so a Files link to a local
  volume is refused unresolved as an unfollowable link, not as "on the network". Against iteration 9's code
  (1e8153e): fails. winpath exports only what other modules or the tests use.
- Review 11: the reviewer's repro, made faithfully (Node's `symlinkSync` fills a drive into a rooted target, measured,
  so root-relative links are made with `mklink`): another agent's nested project that is a root-relative link, and one
  that is a volume-GUID link, each keep their file from the agent on the outer project; a root-relative link in Files
  attaches; the agent's own project folder that is a link to a share (through the admin share) attaches, and the same
  link as another agent's project is refused unresolved. Against iteration 10's code (8126391): all 5 fail, both
  repros by attaching the nested file (`ok: true`).
- Review 12: past the agent's own project link to a share (through the admin share), a link on that share to another
  server is refused unresolved while the project's own file beside it attaches; another agent's project written in a
  pipe namespace no longer makes this agent's project files refuse; the agent's own project written
  `\\?\UNC\host\share` attaches a file named by its plain share path; `mayHold` answers no for a pipe and yes for
  `GLOBALROOT`. Against iteration 11's code (11d4bec): all 4 fail.
- Review 13: another agent's project folder at the end of a 34-link chain to an unroutable share is never resolved
  while this agent's project file attaches (against f2e3208: fails); `\\?\C:\` and `\\.\C:\` local paths are refused
  with the long-form sentence. `sameWrittenPath` now lives in winpath beside `writtenInside`, one normalizer for both.
- Review 14: a Files link to `\??\Global\UNC\<unroutable>\share` is refused unresolved as a network path, and the same
  link as another agent's project folder is never resolved while this agent's project file attaches. Against
  iteration 13's code (07f1a94): both fail, the second by resolving that folder (the contact, shown).
- Review 15: another agent's project folder that is a junction aimed at a share is never resolved while this agent's
  project file attaches (against f50df47: fails, by resolving it); a junction in Files is refused with its own
  sentence (`DEAD_LINK`: "leads nowhere this computer can read"). The Windows refusal sentences now sit with the
  module's other sentences at the top.
- Review 16: the repro through the admin share (this agent's project is the share; another agent's nested project is
  a local link into it): the nested file is refused, this agent's own file attaches (against 1929bc4: fails, by
  attaching the nested file, `ok: true`); a 70-link chain of another agent's is never resolved and does not block this
  agent's project file. The 34-link arm of review 13 now follows the whole chain (to the share at its end).
- Review 17: a connected agent whose Files folder is on a share (the admin share) attaches a file from it, and a share
  path beside Files is still refused unresolved (against 528edf1: fails, refused as a network path); review 2-2's arm
  (a LOCAL Files folder whose file resolves to a share is refused) still passes, so the local guard is intact. Another
  agent's folder whose link cannot be read is resolved as on main, by decision (comment in `otherFolderSkip`).
- Review 18: `\??\C:\...` is refused with the long-form sentence, not as a stream. No behaviour arm otherwise: the
  round changed shape (predicates for winpath's regexes, `inOwnShareFolder` named), and every arm still passes.

Negative controls: the first 12 arms against main's `replyfile.js`: 11 of 12 fail (only the control passes). The four
review-2 arms against iteration 1's `replyfile.js` (f61f537): all 4 fail. The three review-3 arms against iteration 2's
(5f08d3d): all 3 fail. The review-4 arm against iteration 3's (d5bced0): fails. The three review-5 arms against
iteration 4's (650ad2e): all 3 fail (the two 5-1 arms by attaching the nested project's file: the fail-open, shown).

## Verified on the Windows box

- `engine/replyfile.win32-7221.test.js`: 46/46 (none skipped). `engine/windows-tests-1777.test.js`: 23/23.
  `engine/windows-coupling-audit-1732.test.js`: 8/8. `engine.reachable.test.js`: 8/8.
- `server.reply-file-6726.test.js`: 53/56, the same 3 failures as main on this box, same reasons (NFD names, FIFO,
  O_NONBLOCK: Mac filesystem behaviours). Once (iteration 8's first full run) a 4th, `r4-3`, refused an ordinary
  project file as KEPT_FOR_KOSMOS; it did not recur in 2 more full runs on the branch, nor in 10 runs of that arm alone
  on the branch and 10 on main. Explained in iteration 9: a number `dev:ino` collision (see "File ids are compared as
  BigInt"), which a temp tree full of fresh ids makes likely; with BigInt ids, 3 more full runs: the same 3 as main.
- `server.attachment-stream-6734.test.js` (calls readOwn directly): 25/31 (+2 skipped), the same 6 failures as main
  (download streaming on win32), 2 runs before the BigInt change and 3 after. One early run showed a 7th (an upload
  arm) once; it passed in every later run.
- The shared device-name rule, A/B against main's three modules on this box: `engine/backuprestore.test.js` 24/24,
  `engine/backuprun.test.js` 19/19, `engine/backupsnapshot.test.js` 98/103 (the same 5 as main, by name and every
  error line: Mac backslash-name and FIFO cases), `engine/restoreresume-5536.test.js` 20 (+3 skipped),
  `engine/restoresink.test.js` 10 (+7 skipped), `engine/win32update.test.js` 133 (+1 skipped),
  `engine/win32zip.test.js` 22/22, `tools.win-zip-modes-6677.test.js` 12/12: identical counts on both.
- The full suite (`npm test`, tools/run-tests.sh) is not run on this box: it makes real schtasks calls here. CI runs it.

## After merge

The "one real Windows run" for #6726 can turn teaching `--file` on (engine/dmfiles.js); that is #6726's step, not this
branch's.
