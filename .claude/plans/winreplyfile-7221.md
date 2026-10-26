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
   read and followed ONLY when it is a drive path (`X:\...`, also written `\\?\X:\` or `\??\X:\`) or a plain relative
   one (`followableLinkTarget`, an allow-list). Anything else is refused unfollowed: review 2 finding 1 measured a
   target written `\\?\GLOBALROOT\Device\Mup\<host>\<share>` reading back as `\??\GLOBALROOT\...` (one backslash, past
   a `\\` deny rule) whose realpath stalled 21 s. A followed target is resolved and walked the same way (rule 1
   applied to each, so a link to another drive is refused too). More than 32 links: refused. A part that lstats
   ENOENT but its folder lists (the junction above): refused, never handed to realpath. Any other lstat error: "could
   not be read".
3. **The real path, once resolved** (`winRealRefusal`): a device name there is refused before the open, and so is a
   network path, EXCEPT for a file written inside one of the agent's own project folders (review 1 finding 2, narrowed
   by review 2 finding 2 from "on a project drive", which on the usual box with Files and projects all on C: exempted
   every attach): projects.js supports a project on a mapped drive ("a Z:\ record whose realpath is \\server\share
   opens"), and those files attached on main. A Files folder Kosmos made is never on a share, so a file named there
   that resolves to one is refused. `\\?\C:\` (realpath's long local spelling) is local and passes.
4. **allowedRoot resolves a project folder written as a share only for a file on that same share** (review 1 finding
   3, review 2 finding 3): any agent can register such a project (`kosmos project create`), and allowedRoot resolves
   every project folder to judge containment. A share's real path cannot be a folder above a local file or a file on
   another share, so skipping it changes no answer; one on the file's own share may hold it, so it is still resolved.
   A project folder written on a drive is walked by rule 2 first (lstat and readlink, no drive rule; a `\\?\C:\` or
   `\??\C:\` spelling read as its drive path), and skipped when its links leave for a share (review 3 finding 1:
   `C:\x\proj` as a link to `\\host\share` was still resolved).
5. **A skipped project fails closed** (review 5 finding 1, a fail-open found in this branch): a nested project the
   agent is NOT on exists to keep its files from the outer project's agents, so skipping it must not let the outer
   project answer. When a project of another agent is skipped by rule 4 and its folder may hold the file by spelling
   (inside it as given or as resolved, or on a share whose path below the server matches whatever the server is
   called), the attach is refused. Erring toward refusal can refuse a file main allowed in one rare layout (another
   agent's OUTER project skipped while the agent's own nested one holds the file); refusing is the safe direction.

On Windows `attach` reads `dmfiles.filesDir` and the projects list once and hands both on, so an attach still reads
each agent's instructions path once (#6726 r5-3) and parses the projects file once.

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
   link to a share. Named in the code comment too.
3. A share is matched by how it is WRITTEN, not by identity (review 4 finding 2): a project written `\\fileserver\x`
   whose files' real paths read `\\10.0.0.5\x` (or a DFS path, or another name for the server) is not matched to them,
   and they are refused where main matched by identity. Narrow; the remedy is to write the project folder as Windows
   resolves it. Named in the code comment too.

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

Negative controls: the first 12 arms against main's `replyfile.js`: 11 of 12 fail (only the control passes). The four
review-2 arms against iteration 1's `replyfile.js` (f61f537): all 4 fail. The three review-3 arms against iteration 2's
(5f08d3d): all 3 fail. The review-4 arm against iteration 3's (d5bced0): fails. The three review-5 arms against
iteration 4's (650ad2e): all 3 fail (the two 5-1 arms by attaching the nested project's file: the fail-open, shown).

## Verified on the Windows box

- `engine/replyfile.win32-7221.test.js`: 25/25 (none skipped). `engine/windows-tests-1777.test.js`: 23/23.
  `engine/windows-coupling-audit-1732.test.js`: 8/8. `engine.reachable.test.js`: 8/8.
- `server.reply-file-6726.test.js`: 53/56, the same 3 failures as main on this box, same reasons (NFD names, FIFO,
  O_NONBLOCK: Mac filesystem behaviours).
- `server.attachment-stream-6734.test.js`: 25/31 (+2 skipped), the same 6 failures as main, two runs each (download
  streaming on win32). One run showed a 7th (an upload arm) once; it passed in both re-runs on this branch: a flake.
- The full suite (`npm test`, tools/run-tests.sh) is not run on this box: it makes real schtasks calls here. CI runs it.

## After merge

The "one real Windows run" for #6726 can turn teaching `--file` on (engine/dmfiles.js); that is #6726's step, not this
branch's.
