# kosmos#7883: the Windows promote carries setup.ps1

## Goal
`https://installkosmos.com/setup.ps1` (the one-line Windows install, and step 1 of the Intune path) stays current
without a hand copy. Baron's decision on the card: part 1 (his) is a drift alarm, served vs main; part 2 (this
branch) is that `tools/windows/publish-r2.ps1 -Promote` carries `setup.ps1` and its `.sha256` to R2 beside
`latest-win.json`, and the site redirects `/setup.ps1` there, as it already does for `latest-win.json` (#3600).

## Done when
1. A staging publish uploads this tree's committed `tools/windows/setup.ps1` as `setup-<v>.ps1` with a `.sha256`
   sidecar naming itself, before the staging pointer, and reads both back.
2. `-Promote` puts that staged script up as `setup.ps1` + `setup.ps1.sha256`, pinned to what it read, after
   `latest-win.json` and its race checks, and reads both back. A build staged without a script leaves `setup.ps1`
   untouched and says so.
3. tools/test-publish-r2-3725.sh pins the new order, contents, pins and refusals.

## Design calls
- **The script comes from the cut's tree, not main at promote time.** Baron's weakest premise was a main script that
  expects a newer build than prod has. Staging the script with its build means the live script is always the one
  that was staged (and V2-verified on this box) with the build prod names.
- **Its bytes must be exactly the committed blob** (`git hash-object --no-filters` equals `HEAD:./setup.ps1`). An
  uncommitted edit, or a checkout that converts line endings, would publish bytes main never had, and the site's
  drift alarm compares against main. Rejected: reading `git show HEAD:...` bytes directly (binary-safe native
  stdout capture is unreliable in PowerShell 5.1).
- **setup.ps1 is written AFTER latest-win.json and its race checks**, not before. The card comment said "before";
  changed after reading the undo code: written after, an undo of a raced promote never has to restore the script,
  and the brief window between the two writes is "previous script on the new build" (the pair live a moment
  earlier), never "new script on the old build" (the case Baron flagged). A failure writing it leaves prod
  promoted and the old script live, and the refusal says to re-run the full -Promote, which is safe to repeat.
- **Pinned writes** (If-Match to what the promote read at its start, If-None-Match when absent), like every other
  overwritten object in this script.
- **Read back from the bucket's own address** (`-Bucket`), because the site does not redirect `/setup.ps1` to R2
  yet; that redirect is Baron's half. Until it lands the site's own copy (deployed 11-03) stays what people get.
- **Versioned script is overwritable on re-stage** (no-cache, unpinned beyond publish.lock): it is named by no
  pointer, and a re-stage of the same version from a corrected tree should replace it.
- **-ForSigning does not upload it**: it moves no channel and the stage that follows does.

## Measured on the Windows box (Windows PowerShell 5.1, the script's test transport)
The bash harness needs pwsh and python3, which this box does not have (Store stubs), so Mac CI runs it. The same
paths were driven on-box with a PowerShell runner (zip built with System.IO.Compression, real verification record
via tools/lib/win-staging-record.js):
- stage: order `zip, zip.sha256, setup-9.9.1.ps1, setup-9.9.1.ps1.sha256, latest-win-staging.json`, script bytes
  equal the repo's, sidecar `<sha>  setup-9.9.1.ps1`;
- promote: order `alias(copy), alias.sha256, latest-win.json, setup.ps1, setup.ps1.sha256`, both create-only;
  re-promote pins both with If-Match;
- older stage with no script: NOTICE, no setup write, setup.ps1 untouched;
- half a pair / a sidecar naming other bytes: refused, zero writes;
- control: an uncommitted edit to setup.ps1 makes staging refuse with zero writes.

## Review rounds
