# museturnlog-9270 (kosmos#9270)

**Problem.** On Windows, the Muse turn log (engine/musefront.js logTurn) stopped for good once it was full and its `.1` could not be replaced. The cut opened the file with O_APPEND and then called ftruncate. libuv opens an O_APPEND file on Windows with append access only, so the truncate threw. The outer catch swallowed it, nothing was written, and the file stayed over the limit for every later turn.

**Change.** A file that must be cut is opened without O_APPEND. Its truncate still comes only after the existing fstat check (regular file, one link). O_TRUNC at open was rejected: it would cut a hard link before that check. The write then lands at offset 0 of the emptied file. An ordinary append is unchanged. musefront.test.js moves from HOST_BRANCH_EXCLUDED to ALSO, so the Windows job runs it.

**Measured.**
- GitHub windows-latest: musefront.test.js 79/79 three times (run 46125861530). At main before this change it was 78 pass, 1 fail on `#5636 F7a: logTurn ... never throws` (run 46120990799; the measurement job always reports success, and its per-file line holds the counts).
- This measurement also settles the card's "reasoned, not measured" cause: removing O_APPEND from the cut is what makes it pass.
- Mac: musefront and the five files that name musefront.js or logTurn (rawwrites-8718, caches.fsync-5434 and three supervisor/server files) pass 138/138; windows-tests-1777 24/24.

**Weakest premise.** On the Mac the cut path never failed, so a Mac run cannot tell old from new there. Only the Windows run tells them apart, and it does.
