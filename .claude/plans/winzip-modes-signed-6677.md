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
- The read-me keeps a line for the Open File box (Mark of the Web on a signed exe still raises it, now naming the publisher): "If a box asks whether to run Kosmos.exe from Kosmos Agent Manager, Inc., click Run." Only the false "could not be verified" wording went.
- The read-me's filename ("! READ ME FIRST - Windows will warn you.txt") stays: it is in the build's required-entries list and the updater's, and Windows still may warn.

## Consumers of manifest "signed" (checked)
engine/win32update.js (platform, version, arch, node only; Authenticode asked of Windows directly), tools/windows/publish-r2.ps1 (Authenticode directly), tools/win-staging-verify.js and tools/lib/win-staging-record.js (version, platform, arch, source_sha, source_dirty), tools/publish-kosmos-windows.sh (no manifest read), engine/manifest-verify.js (Mac release manifest). Test fixtures carry `signed: false` unread. None read the field.

## Weakest premise
That nothing outside the repos searched reads `manifest.signed`. Searched: this repo (the site is in it) and kosmos-relay (relay-3d83aacc checkout); neither reads it. The field was always false, so any reader would only ever have seen "unsigned".

## Measured (after)
Built from this branch on the Windows box through the bsdtar shim (KOSMOS_ALLOW_STALE_TUNNEL=1, a proof build): 349 files 0644, 14 programs 0755, 7 folders 0755, 0 world-writable, unzip -t clean. Manifest signatures both "Valid". The control (0.7.60 zip) fails the new check on all 369 entries.

## Review log
### Iteration 1 (opus)
- [WARNING] fixed: node was checked only inside the What's new block, so KOSMOS_CUT_NO_WHATS_NEW=1 let a node-less host download and zip before failing. One check now runs before staging.
- [WARNING] fixed: dropping the "could not be verified" line left the Open File box unexplained. The read-me now says to click Run when it names Kosmos Agent Manager, Inc.; both README tests pin it.
- [CONVENTION] fixed: two test comments in tools.build-windows-570 still called the package unsigned.
- [CONVENTION] fixed: the weakest premise was checkable. kosmos-relay searched; no reader.
- [NIT] fixed: check now requires 0755 for a program by extension; a test covers Kosmos.exe at 0644.
- [NIT] fixed (comment): relabelling a DOS-hosted entry Unix changes how Info-ZIP reads a non-ASCII name; all staged names are ASCII.
- [NIT] not taken: connector_authenticode's messages say "connector" when the launcher fails. The build's own line names Kosmos.exe first; the 4597 tests pin those messages.
### Iteration 2 (sonnet)
- [WARNING] fixed: check allowed a .js at 0755 (it cannot see a shebang). The build now passes the stage folder, and with it check requires exactly the mode set gives; a test covers a 0755 .js with and without the stage.
- [WARNING] fixed: an empty zip passed check. It is now refused.
- [WARNING] deferred: tools.build-windows-connector-4597 reads Kosmos.exe by a cwd-relative path. That file resolves every path from the cwd ('tools/build-kosmos-windows.sh', path.resolve('tools/lib/...')); one __dirname read would be the odd one out.
- [WARNING] fixed: tools/windows/README.md said re-signing a rebuilt exe was a habit no check forced. The build and a CI test now force it; the README says so.
- [NIT] noted: the 2>&1 >/dev/null capture order, the 65535-entry sentinel edge, zlib.crc32 needing Node 22.2+ (CI runs 24).
- [NIT] fixed: the module header no longer carries 0.7.60's exact counts.
### Iteration 3 (opus)
- [WARNING] fixed: a wrong stage path made set and check both read every #! script as 0644, so check agreed with set. zip-modes now refuses a stage folder that is not there (exit 2), and check names any file entry missing from the stage.
- [WARNING] fixed: the hand-made fixtures had no extra fields or comments, so the walk over them ran only in the win32 tar.exe arm. One entry now carries an Info-ZIP-style UT field and a comment.
- [CONVENTION] fixed (iteration 1's NIT, raised again with a side effect): the launcher's Authenticode check printed "connector" and set CONNECTOR_SIGNER. New pe_authenticode <file> <what> is the shared check; connector_authenticode wraps it with the same wording and alone sets CONNECTOR_SIGNER. Checked on this box: signed Kosmos.exe Valid; an unsigned copy (cert table zeroed) NotSigned, refused; the connector Valid.
- [NIT] fixed: the set failure no longer blames PATH (node is checked at the top).
- [NIT] fixed (comment): connector.signature repeats signatures' connector entry on purpose; symlink entries noted.
- [NIT] noted: a zip with exactly 65535 entries and no ZIP64 record would be refused; this zip has ~370.
### Iteration 4 (sonnet)
- [WARNING] fixed: my scripted edit turned `tr -d '\r'` into a literal CR byte inside the quotes. Restored the escape; every changed file now carries no CR byte (none on main either). Authenticode re-checked on this box after the fix: launcher and connector Valid.
- [NIT] fixed: set writes beside the zip and renames over it, so a failed write never leaves a torn zip.
- [NIT] noted: names are decoded as UTF-8 regardless of the flag (all staged names are ASCII); the message-prefix strips are tied to the function names.
