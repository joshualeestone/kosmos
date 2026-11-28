# winarms3-9269 (kosmos#9269, slice 3: filewho's UNC share arm)

**Problem.** filewho's review-5 arm checks that a path on a network mount no project uses is answered as outside without being resolved, because resolving it could stall the board. On Windows that arm skips: it names the macOS mount paths /net, /Volumes and /Network. The rule exists on Windows too (filewriters.js matches `\\host` and `//host`), but nothing tested it there.

**Change (tests only).**
- A Windows-only arm takes `\\somehost-9269\share\a.md` and `//somehost-9269/share/a.md`. Each answers outside, and no path on the share reaches realpath.
- Its CONTROL is a project on that share, which lets the path through to be resolved.
- The stub answers share paths itself, throwing ENOENT, so no run waits on a network lookup.
- The macOS arm's skip reason now names this arm as its Windows counterpart, not as owed.

**Measured.** GitHub windows-latest: filewho 16 pass / 4 skipped three times (run 46132988589). Before, on main, it was 15/4 (run 46120990799), so the new arm runs and passes there. On the Mac, 19 pass and the new arm skips (a UNC path is not absolute on POSIX); windows-tests-1777 passes 24/24.

**Still owed on #9269:** handoff's stub git (a script on PATH cannot be found by name there: Windows finds only an .exe that way), and the chmod-forced-error arms.

**Weakest premise.** The CONTROL can fail only if a project on the share were refused, and the stub never lets a real share be reached. So this arm proves the rule's logic on Windows path forms, not behaviour against a real SMB server.
