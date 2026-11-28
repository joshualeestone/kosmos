# winarms5-9269 (kosmos#9269, slice 5: the chmod-forced-error arms)

**Problem.** Fourteen test arms used chmod to make a read or write fail (EACCES, EPERM, ENOTEMPTY). Windows does not enforce POSIX permission bits, so they skipped there, though what they check exists on Windows.

**Change (tests only).**
- On macOS and Linux each arm is unchanged, with the real chmod.
- On Windows, and on a Mac with KOSMOS_TEST_CHMOD_STUB=1, the same arm forces the same error through the exact fs call the production code makes. That call is wrapped for the protected paths only, with every other path passed to the original, and restored in a finally. The arm then asserts the same outcome.
- Every production call site reads `fs.X` when it runs, so each wrap reaches it.
- A "running as root" shortcut now applies to the chmod path only, since root cannot pass a stub.

**The arms and the call each forces:**

| file | arm | call and error |
|---|---|---|
| grokaccounts.reauth-3391 | the two failed renames | renameSync, EACCES |
| grokaccounts.reauthcancel-6000 | a failed move | renameSync, EACCES |
| grokaccounts.reauthcancel-6000 | delete part way, and delete while whole | rmSync, ENOTEMPTY |
| messages | read-only-Inbox hard link | unlinkSync, EACCES |
| feedbacksend | unsaved mark | the temp file's openSync 'wx', EACCES |
| instructionadds | unreadable store | readFileSync and openSync, EACCES |
| instructionadds | unreadable CLAUDE.md | openSync, EACCES |
| instructions | a file that cannot be opened | openSync, EACCES |
| instructions | a folder that cannot be reached | lstat and friends inside it, EACCES |
| handoff | unreadable self-report | openSync, EACCES |
| create.setprovider-writes-2811 | brief rename | renameSync, EACCES |
| create.setprovider-writes-2811 | profile write | openSync 'wx', EACCES |
| geminisettings.wrote-8362 | unreachable file | realpathSync, EACCES |

**Found on the way.** instructionadds' unreadable-CLAUDE.md arm could not fail, even on the Mac: its fixture's unrecorded Apply makes a READABLE file be refused too, as 'applied'. The arm now asserts the code is not 'applied' and that the reason names the unreadable file. With an inert stub it fails.

**Measured.**
- GitHub windows-latest (run 46137174016): all nine files 0 fail, 15 more arms run than on main.
- Mac: each file's counts are unchanged with 0 skipped, both normally and with KOSMOS_TEST_CHMOD_STUB=1.
- With the stub made inert (not throwing), every stubbed arm fails, and only those arms.
- windows-tests-1777 24/24.

**Weakest premise.** On Windows an arm proves how the code handles the error, not that Windows would raise that error in that place. A stub cannot show what a real Windows ACL denial looks like. That would need a Windows ACL, which is beyond a test sandbox.
