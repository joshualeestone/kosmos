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
- **So the record's Windows ACL is not yet checked by anything, and this test does not join the Windows CI job yet**, because nothing on Windows reaches the code it tests. **The same fact is a new gate for #6609:** with the recovery check on, a revoked key would still open a WINDOWS update, since win32update checks with the built-in keys. When win32update takes the list (a phase 2 slice), the record is written on Windows, and in that change the 0600/0700 asserts become a real Windows ACL check and this file joins the Windows CI job.

## Review log
