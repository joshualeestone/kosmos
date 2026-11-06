# win-inplace-acl-1765-v2: kosmos#1765, Kosmos.exe refuses a run folder other people on the PC can change

**Posture:** production

**Card:** kosmos#1765 (pre-beta security pass 3, Windows-native build). Rebuilds `win-inplace-acl-1765` (pushed 2026-10-18, never opened as a PR) on current main, with the launcher rebuilt and re-signed on the Windows box.

## What finished looks like (from the person's side)

1. A copy of Kosmos opened from a folder outside the person's own user folder that other accounts on the PC can change (C:\Kosmos, say) does not run anything from that folder, the uninstall included, and does not point the Start menu, Settings > Apps or the logon task at it.
2. The person sees one plain message: why, and exactly what to do instead (extract a fresh copy into their own Downloads folder and open it there).
3. The normal path is unchanged: a copy in Downloads, or the installed copy in %LOCALAPPDATA%\Programs\Kosmos, starts as before.

## Pieces

- `tools/windows/KosmosLauncher.cs`: `UnsafeRunFolderReason` (reads the run folder's ACL, the code inside it that the launcher starts or loads, runtime\WebView2Loader.dll included, and each folder above it), `OtherWriterOf`, `UnsafeFolderMessage`, `RefuseUnsafeFolder`, called before any errand.
- `tools/windows/Kosmos.exe`: rebuilt with the README's csc line and Authenticode-signed (Kosmos Agent Manager, Inc.); `verify-launcher.ps1` OK.
- `tools.win-inplace-acl-1765.test.js`: compiles the launcher and checks safe and unsafe folders on Windows.
- `tools/windows/README.md`: what the check guards and does not.

## Decisions

- **Refuse, not lock the folder down.** Kosmos never creates such a folder (the person extracted the zip there), so there is no moment to set a safe ACL, and the files may already have been changed. Rewriting the ACL of a folder the person chose could also remove access they meant to give. Rejected: rewriting the ACL; warning and running anyway (the code would still run as this person).
- **Trust by SID: this user, SYSTEM, Administrators, TrustedInstaller** (plus CREATOR OWNER and OWNER RIGHTS, which stand for the owner, who is checked). A domain group is not trusted; such a folder is refused, and a copy in the profile is the way round it.
- **A folder inside the profile is trusted by where it is.** The profile is this person's. Reading every file would cost far more than the few milliseconds the check takes.
- What would change these: people routinely running Kosmos from IT-managed shared folders, which would call for an explicit opt-in rather than silent trust.

## Weakest premise

This Kosmos.exe, and a Kosmos.exe.config beside it, come from the same folder and are loaded before the check runs, so it is not a boundary against a folder that was already changed. It stops Kosmos from running node and app code from, and pointing the system at, a folder others can change. A copy already running in place from before this check carries on (its logon task and the in-app updater) until a copy installed in the profile takes over; the README says so, including that anything that starts Kosmos.exe from that folder again (the window reopened after an update) now shows the refusal box while the board keeps serving. A junction or symlink outside the profile is read at its target, but the folders above the target are not walked.

## Validation (Windows box)

Launcher tests (`tools.win-inplace-acl-1765`, `tools.win-launcher-*`, `tools.win-taskbar-badge-3996`, `tools.win-installer-native`) with the no-schtasks preload; `verify-launcher.ps1`; the six policy tests; a live run of the signed exe from `C:\kt-1765` (Authenticated Users: Modify) showing the refusal, and from a folder in the profile reaching the next check.
