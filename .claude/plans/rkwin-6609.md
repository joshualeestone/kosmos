# rkwin-6609: the #6609 recovery-key test passes on Windows

Card: kosmos#6609. Reported by Homer via Splinter (04:59): engine/manifest-verify.recovery-6609.test.js fails 2 of 17 on win32 on plain main.

## Finished looks like
The test passes on Windows without weakening what it checks on a Mac or Linux.

## Cause (reproduced)
Two arms assert POSIX permissions, which Windows does not have:
- the record's file is 0600 and its folder 0700 (Node reports 0666 and 0777 on Windows);
- a home chmod-ed to 0500 refuses the record write (a folder mode does not stop writes on Windows).
Reproduced on this Mac with a preload that sets process.platform to win32, reports 0666/0777 modes, and makes chmodSync a no-op (TEMP set, as os.tmpdir reads it on win32): the file from main fails exactly those 2 of 17; this branch passes 17/17. Without the preload, 17/17 as before.

## Decided
- Skip the mode asserts on win32, and skip the read-only arm there as it is already skipped for root ("cannot be exercised"). Rejected for now: asserting the Windows access list.
- **Measured on main after #6607 (9d3d4fa696, which this branch contains), corrected at Splinter's 05:07 check:** engine/win32update.js now requires manifest-verify and refuses an update unless its manifest verifies, but with `manifestKeys` defaulting to manifestVerify.KEYS (the built-in keys), through signedManifest, win32HeaderRefusal, filesRefusal and listFiles. It never calls trustedKeys, so the recovery-key record is neither read nor written on win32 today. (The first version of this bullet said Windows updates are checked by Authenticode only: stale since 04:34.)
- **The test JOINS the Windows CI job** (tools/windows-tests.js ALSO, as orgkeypin-5686 does with its 0600 skip). Reversed in review: the platform checks this adds trip the windows-tests-1777 guard (a file that branches on win32 must be run there or excluded with a reason), and the arms that remain are the record's file operations (a hard link and its EEXIST race, rename over a damaged record, the folder fsync that fails and is caught on Windows), which is exactly what a Windows run should test; Homer's report already says those 15 pass on win32. No path calls trustedKeys yet on any platform (phase 2a and 2b, which add the Mac callers, are open PRs), so "Mac only" was also wrong. **The same fact is a new gate for #6609:** with the recovery check on, a revoked key would still open a WINDOWS update, since win32update checks with the built-in keys. **Trigger:** when win32update takes the list (a phase 2 slice), the record is written on Windows, and that change must replace the 0600/0700 skip with a real Windows access-list check.

## Review log
### Iteration 1 (opus, resumed once with Splinter's 05:07 question)
- [BLOCKER] fixed: the new win32 checks tripped engine/windows-tests-1777.test.js (a file that branches on a win32 host must be in tools/windows-tests.js ALSO or HOST_BRANCH_EXCLUDED). Added to ALSO, with the reason; the guard passes (with the test itself, 40/40).
- [WARNING] fixed: "only the Mac update path consults the record" and "Windows is Authenticode only" were both false. Traced by the reviewer: win32update.js uses listFiles, signedManifest, win32HeaderRefusal, KEYS and filesRefusal from manifest-verify; storedKeyList is called only inside trustedKeys, which nothing calls on any platform yet. Comment and plan now say so.
- [WARNING] decided, reversing my first call: the test runs on Windows now, since what remains are the record's file operations (hard link, rename over a damaged record, folder fsync), which differ on Windows; Homer's report says those 15 pass there. The access-list check replaces the mode skip when win32update takes the list (the trigger in Decided).
- Mac side checked: with the record written 0644 in a copy, the Mac run fails on the mode assert, so the skip hides nothing off Windows. A simulated win32 run passes 17/17; main's file fails exactly Homer's 2 under the same simulation.
