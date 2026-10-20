# winzip-modes-signed-6677: the Windows zip's file modes, and what it says about signing

Cards: kosmos#6677 (every zip entry stored world-writable), kosmos#6679 (the zip says it is unsigned; Kosmos.exe and the connector are signed).

**Posture:** production

## Finished looks like
- A Windows zip built by tools/build-kosmos-windows.sh, through Info-ZIP or the release box's bsdtar shim, carries no group- or world-writable entry: files 0644, programs 0755, folders 0755, and the build refuses a zip whose modes read back otherwise.
- The read-me says plainly that Kosmos.exe is signed and why Windows may still warn the first time; it keeps the More info, Run anyway steps and drops "The publisher could not be verified". No em dashes.
- manifest.json no longer says `"signed": false`; it records each signed program's signature as the build saw it, and nothing that reads the manifest starts trusting it.

## Measured (before)
The shipped 0.7.60 zip: 369 of 369 entries world-writable (359 `-rw-rw-rw-`, 3 `-rwxrwxrwx`, 7 `drwxrwxrwx`). Cause: the release box has no Info-ZIP; ~/kosmos-e2e/builds/shims/zip calls Windows' tar.exe -a, which records 0666 / 0777. CI never builds the zip.

## Decided
- Post-process, not a different zip tool: tools/lib/zip-modes.js rewrites each central-directory entry's "version made by" host (Unix) and external attributes in place, after `zip` and before the `.sha256`. Same result whichever tool made the zip; record sizes do not change, so nothing else moves. ZIP64 end records handled.
- Programs (0755): .exe .dll .cmd .bat, or a staged file that starts with `#!`. Rejected: .ps1 as 0755. It is only ever run through `powershell -File`, never exec'd, like a .js through node.
- A separate `check` reads the finished zip back and refuses, so the guard does not trust `set`'s own report.
- Manifest: per-file `"signatures"` for Kosmos.exe and app/bin/kosmos-tunnel.exe ("Valid" on Windows, "present (not verified: ...)" elsewhere). Rejected: `"signed": true`, which a reader could take as covering every file (node.exe and WebView2Loader.dll are other publishers').
- The read-me now claims Kosmos.exe is signed, so the build refuses an unsigned launcher: presence on any host, Authenticode Valid by Kosmos Agent Manager, Inc. on Windows. The launcher is PE32 (AnyCPU, machine i386), which connector_pe_signed refuses as not x86-64, so a new pe_signature_present reads the certificate table for PE32 and PE32+.
- The read-me's filename ("! READ ME FIRST - Windows will warn you.txt") stays: it is in the build's required-entries list and the updater's, and Windows still may warn.

## Consumers of manifest "signed" (checked)
engine/win32update.js (platform, version, arch, node only; Authenticode asked of Windows directly), tools/windows/publish-r2.ps1 (Authenticode directly), tools/win-staging-verify.js and tools/lib/win-staging-record.js (version, platform, arch, source_sha, source_dirty), tools/publish-kosmos-windows.sh (no manifest read), engine/manifest-verify.js (Mac release manifest). Test fixtures carry `signed: false` unread. None read the field.

## Weakest premise
That nothing outside this repo reads `manifest.signed`. Searched this repo only; the site and kosmos-relay were not searched. The field was always false, so a reader that existed would only have been reading "unsigned".

## Measured (after)
Built from this branch on the Windows box through the bsdtar shim (KOSMOS_ALLOW_STALE_TUNNEL=1, a proof build): 349 files 0644, 14 programs 0755, 7 folders 0755, 0 world-writable, unzip -t clean. Manifest signatures both "Valid". The control (0.7.60 zip) fails the new check on all 369 entries.

## Review log
