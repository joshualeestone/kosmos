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
     how an agent names its own file);
   - a colon past the drive (an alternate data stream, `COM1:`);
   - a last part that is a DOS device name (CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM0-9, LPT0-9 and the superscript
     digits, any extension, trailing dots and spaces dropped as Windows does);
   - a drive letter none of the agent's roots (its Files folder, its projects) is written on: a mapped drive is a
     share under a letter, and a file there could never be inside a root anyway. Read from how the roots are written,
     no filesystem call.
2. **The links, by lstat and readlink only** (`winLinkRefusal`): each part of the path is lstat'd; a link's target is
   read and refused when it is a network spelling, otherwise resolved and walked the same way (rule 1 applied to each
   target, so a link to another drive is refused too). More than 32 links: refused. A part lstat cannot read but its
   folder lists (the junction above): refused, never handed to realpath.
3. **The real path, once resolved** (`winRealRefusal`): a network path or a device name there is refused before the
   open. A second guard; `\\?\C:\` (realpath's long local spelling) is local and passes.

`attach` reads `dmfiles.filesDir` once on Windows and hands it to `allowedRoot`, so an attach still reads each agent's
instructions path once (#6726 r5-3).

## Rejected

- Checking only the real path after realpath (the card's literal second bullet): by then the contact has happened.
- Refusing every link in Files on Windows: links to local files in Files work today and are judged by where they land.
- Asking Windows for the drive type (`GetDriveType`) to find mapped drives: Node has no call for it; the root-drive rule
  covers the same case without one.

## Weakest part, named

A link swapped to point at a share between the walk and the realpath: the open is still refused (rule 3), but the
realpath may already have made the contact. Node has no openat-style walk to hold each folder open. Same class as the
double-swap the file header already names.

What would change my mind: a Windows build where `lstat` or `readlink` itself contacts a share (measured not to, here).

## Tests (`engine/replyfile-win-7221.test.js`)

Every refusal arm counts realpath calls through replyfile's own test seam and asserts zero, and asserts it answered in
under 2 s, so a refusal with the right words AFTER the contact is red. Pure spelling arms run on every platform; the
link and attach arms run on win32.

- CONTROL: an ordinary file in Files attaches (and does reach realpath).
- `\\host\share`, `//host/share`, `\\?\UNC`, `\\.\NUL`, `\\?\C:\...`: refused unresolved.
- A file symlink and a folder symlink in Files to a share; a junction to a share; a chain of two links ending at a
  share; a link to another drive: refused unresolved.
- NUL, nul.txt, COM1, com1.log, LPT1, CON, AUX.md, "NUL. ": refused unresolved.
- An alternate data stream; a drive no root is on: refused unresolved.
- Second guard: a real path that is a share or a device is refused; `\\?\C:\` real path is not.

Negative control: the same file against main's `replyfile.js`: 11 of 12 fail (only the control passes).

## Verified on the Windows box

- `engine/replyfile-win-7221.test.js` + `engine/windows-coupling-audit-1732.test.js`: 20/20 pass.
- `server.reply-file-6726.test.js`: 53/56, the same 3 failures as main on this box, same reasons (NFD names, FIFO,
  O_NONBLOCK: Mac filesystem behaviours).
- `server.attachment-stream-6734.test.js`: 25/31 (+2 skipped), the same 6 failures as main, two runs each (download
  streaming on win32). One run showed a 7th (an upload arm) once; it passed in both re-runs on this branch: a flake.
- `engine.reachable.test.js`: 8/8.

## After merge

The "one real Windows run" for #6726 can turn teaching `--file` on (engine/dmfiles.js); that is #6726's step, not this
branch's.
