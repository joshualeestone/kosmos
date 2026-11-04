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
- Round 1 (blind reviewer): 0 BLOCKER, 4 WARNING, 4 NIT. Fixed: W1 the script is held to the build's source commit
  (zip manifest.json source_sha must equal HEAD; a zip without one is staged with HEAD's script and says so). W2
  setup-<v>.ps1 is create-only like the zip (different bytes need -ReplaceVersioned, never for prod's version), and
  Josh's approval line records setup_sha256. W3 tools/windows/.gitattributes `setup.ps1 -text`, so Git for Windows'
  default autocrlf cannot make every stage refuse. W4 the installer writes moved after the served checks and the
  promoted=yes log line. NIT1 explicit null checks and empty-script refusals; NIT2 the NOTICE says a rollback keeps
  the newer installer; NIT3 the BucketBase comment. NIT4 (harness precheck for a dirty local setup.ps1) not taken:
  CI checkouts are clean, and the refusal text already names the cause.
- Round 2 (blind reviewer): 1 BLOCKER, 3 WARNING, 3 NIT. Fixed: BLOCKER the harness grep had setup_sha256 and
  approval=given in the wrong order (would red Mac CI). W1 a zip that records source_sha gets that commit's blob read
  from git through a process stream (no working-tree or HEAD coupling, no line-ending risk); measured on-box with
  an older commit whose setup.ps1 differs: the staged bytes equal that blob's sha256 exactly. W2 the installer under
  a staged version changes only together with a replaced zip, so the zip sha Josh approves pins it (source_sha is
  inside the zip). W3 is covered by that: a setup change implies a zip replace, whose existing post-upload prod
  re-read runs before the setup PUT. NIT1 git calls run with ErrorAction Continue and check exit codes. NIT2 the
  refusal names the re-checkout commands. NIT3 not taken (a dry run reads every gate a real run reads before writing).
  Known gap, for a follow-up card: on-box V2 does not yet run the staged setup-<v>.ps1 itself.
- Round 3 (blind reviewer): 1 BLOCKER, 3 WARNING, 3 NIT. Fixed: BLOCKER the alias-copy header check read .calls
  after the #7883 block had replaced it (moved up to just after the first promote). W2 -Promote no longer trusts
  the staged installer: when the staged zip (the approved bytes) records source_sha, the installer is read again
  from that commit in git and must match, else refused before any write (harness case added). W3 a separate
  `installer=published setup_sha256=` outcome line after the installer writes (promoted=yes stays before them, per
  round 1). NIT5 the -C path is trimmed of a trailing slash; NIT6 the zip and git helpers moved to script scope;
  NIT7 the approval count is pinned (-eq 2). W4 (installer can lag or lead the build on a rollback) is by design
  and already said by the NOTICE and setup_sha256=none.
  Found on-box while measuring round 3: Windows PowerShell 5.1 does not load System.IO.Compression with
  .FileSystem, so the promote's zip read crashed (UNEXPECTED); it is now loaded explicitly. Also caught: a regex
  `\z` lost its backslash in an edit script, which made source_sha never match; fixed, and every added line with
  a backslash was re-checked.
- Round 4 (blind reviewer): 0 BLOCKER, 4 WARNING, 4 NIT. Fixed: W1 a -ReplaceVersioned that died after its zip PUT
  can now be finished (with -ReplaceVersioned, when the installer comes from the zip's own recorded commit, never
  for prod's version); measured on-box (refused without the switch, finished with it). W3 the header says both
  modes need the zip's source commit in the checkout. NIT1 the node comment is back on Get-NodeExe. NIT3 the git
  process is disposed. Not taken, for the follow-up card: W2 the site redirect of /setup.ps1 (Baron's half; after
  it, add a site-address served check), W4 log the setup.ps1 sha left live on a rollback, NIT2 hash the exact bytes
  read on the no-source_sha path, NIT4 mark the no-source_sha installer unverified in the approval line, and on-box
  V2 running the staged setup-<v>.ps1.
- Round 5 (blind reviewer): 0 BLOCKER, 2 WARNING, 3 NIT. Converged. Not taken, all on #7890: W1 a promoting checkout
  without the build commit refuses the whole release (documented in the header; skip-installer alternative to
  decide), W2 a zip with no source_sha has its installer taken on its sidecar, NIT1 rollback note, NIT2 harness
  compares against the working file, NIT3 a source_dirty NOTICE.
