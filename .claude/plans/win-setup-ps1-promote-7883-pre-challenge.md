---
pre_challenge: true
method: challenge-loop
branch: win-setup-ps1-promote-7883
diff_hash: 5c596fb4e5d0f0f5aff2edf95fb9aeedfcf64bd0f7e0a4ac1f8918419d58036f
validation: passed
subdir_audit: passed
timestamp: 2026-11-04T00:11:43Z
iterations: 5
converged: true
---

# Pre-PR review proof: win-setup-ps1-promote-7883

**Iterations:** 5
**Converged:** Yes. The last round found no BLOCKER; anything it raised is recorded below.
**Per-round record:** .claude/plans/win-setup-ps1-promote-7883.md

## Rounds

#### Iteration 1
- Round 1 (blind reviewer): 0 BLOCKER, 4 WARNING, 4 NIT. Fixed: W1 the script is held to the build's source commit
  (zip manifest.json source_sha must equal HEAD; a zip without one is staged with HEAD's script and says so). W2
  setup-<v>.ps1 is create-only like the zip (different bytes need -ReplaceVersioned, never for prod's version), and
  Josh's approval line records setup_sha256. W3 tools/windows/.gitattributes `setup.ps1 -text`, so Git for Windows'
  default autocrlf cannot make every stage refuse. W4 the installer writes moved after the served checks and the
  promoted=yes log line. NIT1 explicit null checks and empty-script refusals; NIT2 the NOTICE says a rollback keeps
  the newer installer; NIT3 the BucketBase comment. NIT4 (harness precheck for a dirty local setup.ps1) not taken:
  CI checkouts are clean, and the refusal text already names the cause.

#### Iteration 2
- Round 2 (blind reviewer): 1 BLOCKER, 3 WARNING, 3 NIT. Fixed: BLOCKER the harness grep had setup_sha256 and
  approval=given in the wrong order (would red Mac CI). W1 a zip that records source_sha gets that commit's blob read
  from git through a process stream (no working-tree or HEAD coupling, no line-ending risk); measured on-box with
  an older commit whose setup.ps1 differs: the staged bytes equal that blob's sha256 exactly. W2 the installer under
  a staged version changes only together with a replaced zip, so the zip sha Josh approves pins it (source_sha is
  inside the zip). W3 is covered by that: a setup change implies a zip replace, whose existing post-upload prod
  re-read runs before the setup PUT. NIT1 git calls run with ErrorAction Continue and check exit codes. NIT2 the
  refusal names the re-checkout commands. NIT3 not taken (a dry run reads every gate a real run reads before writing).
  Known gap, for a follow-up card: on-box V2 does not yet run the staged setup-<v>.ps1 itself.

#### Iteration 3
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

#### Iteration 4
- Round 4 (blind reviewer): 0 BLOCKER, 4 WARNING, 4 NIT. Fixed: W1 a -ReplaceVersioned that died after its zip PUT
  can now be finished (with -ReplaceVersioned, when the installer comes from the zip's own recorded commit, never
  for prod's version); measured on-box (refused without the switch, finished with it). W3 the header says both
  modes need the zip's source commit in the checkout. NIT1 the node comment is back on Get-NodeExe. NIT3 the git
  process is disposed. Not taken, for the follow-up card: W2 the site redirect of /setup.ps1 (Baron's half; after
  it, add a site-address served check), W4 log the setup.ps1 sha left live on a rollback, NIT2 hash the exact bytes
  read on the no-source_sha path, NIT4 mark the no-source_sha installer unverified in the approval line, and on-box
  V2 running the staged setup-<v>.ps1.

#### Iteration 5
- Round 5 (blind reviewer): 0 BLOCKER, 2 WARNING, 3 NIT. Converged. Not taken, all on #7890: W1 a promoting checkout
  without the build commit refuses the whole release (documented in the header; skip-installer alternative to
  decide), W2 a zip with no source_sha has its installer taken on its sidecar, NIT1 rollback note, NIT2 harness
  compares against the working file, NIT3 a source_dirty NOTICE.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/windows/publish-r2.ps1 | BRANCH | installer not tied to the build's commit | FIXED | d48e9bfae5, then 4ea8df394a (read from git at source_sha) |
| 2 | 1 | WARNING | tools/windows/publish-r2.ps1 | BRANCH | setup-<v>.ps1 overwritable, not covered by approval | FIXED | d48e9bfae5, 4ea8df394a |
| 3 | 1 | WARNING | tools/windows/.gitattributes | BRANCH | autocrlf makes every stage refuse | FIXED | d48e9bfae5 |
| 4 | 1 | WARNING | tools/windows/publish-r2.ps1 | BRANCH | setup failure skipped checks and promoted=yes | FIXED | d48e9bfae5 |
| 5 | 2 | BLOCKER | tools/test-publish-r2-3725.sh | BRANCH | approval grep field order wrong | FIXED | 4ea8df394a |
| 6 | 2 | WARNING | tools/windows/publish-r2.ps1 | BRANCH | HEAD coupling, line-ending risk | FIXED | 4ea8df394a |
| 7 | 3 | BLOCKER | tools/test-publish-r2-3725.sh | BRANCH | copy-header check read the wrong run | FIXED | df8a2c953c |
| 8 | 3 | WARNING | tools/windows/publish-r2.ps1 | BRANCH | promote trusted the staged installer | FIXED | df8a2c953c |
| 9 | 3 | WARNING | tools/windows/publish-r2.ps1 | BRANCH | no outcome line for the installer | FIXED | df8a2c953c |
| 10 | 3 | BLOCKER | tools/windows/publish-r2.ps1 | SELF | 5.1 did not load System.IO.Compression (found on-box) | FIXED | df8a2c953c |
| 11 | 4 | WARNING | tools/windows/publish-r2.ps1 | BRANCH | interrupted -ReplaceVersioned could not finish | FIXED | d4754afed3 |
| 12 | 4 | WARNING | tools/windows/publish-r2.ps1 | BRANCH | site redirect not in this branch | DEFERRED | #7890 item 1 (Baron's half) |
| 13 | 4 | WARNING | tools/windows/publish-r2.ps1 | BRANCH | rollback pairs newer installer with older build | DEFERRED | #7890 item 5 |
| 14 | 5 | WARNING | tools/windows/publish-r2.ps1 | BRANCH | missing build commit refuses whole promote | DEFERRED | documented in header; #7890 item 4 |
| 15 | 5 | WARNING | tools/windows/publish-r2.ps1 | BRANCH | no-source_sha installer taken on its sidecar | DEFERRED | #7890 item 3 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- Fixed: explicit null checks and empty-script refusals, BucketBase comment, NOTICE wording, git calls under Continue, trimmed -C path, helpers at script scope, approval count pinned, process disposed, node comment placement.
- Deferred to #7890: hash exact bytes on the no-source_sha path, source_dirty NOTICE, harness compares against the committed blob, V2 runs the staged installer.

### Validation
- Windows PowerShell 5.1 on the Windows box, through the script's own test transport: stage and promote order, pins, contents, refusals, interrupted replace, promote re-check against git, all as recorded in the plan. The bash harness needs pwsh and python3, not on this box; macOS CI runs it.
- tools/test-gnu-only-forms-6808.sh: all passed.
