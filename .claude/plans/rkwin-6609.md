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
- Skip the mode asserts on win32, and skip the read-only arm there as it is already skipped for root ("cannot be exercised"). Rejected: asserting the Windows access list. The record is only consulted by the Mac update path (Windows updates are checked by Authenticode in engine/win32update.js and never call trustedKeys), so the Windows ACL of a record no Windows path reads is not worth a check.
- The CI windows job does NOT add this test, for the same reason: on Windows it would exercise a path no Windows install takes. Weakest premise: if a Windows update path ever starts taking the release key list, this test (and its ACL question) must join the Windows job then.

## Review log
