# winarms4-9269 (kosmos#9269, slice 4: handoff's git-erroring answer on Windows)

**Problem.** handoff.gitFact keeps "git could not read this folder" apart from "not a git repository" (#6506 axis 4). The arm that checks it put a `#!/bin/sh` stub named git on PATH. Windows finds a command on PATH by its .exe, so there the real git answered and the arm was skipped.

**Change (tests only).** A new arm, run on every platform, uses the REAL git:
- GIT_CONFIG_GLOBAL points at a config git cannot parse. Git stops with "fatal: bad config line 1", which is not "not a git repository", so gitFact must answer "git could not read this folder: fatal: bad config line 1".
- GIT_CONFIG_GLOBAL is restored in a finally.
- The control is the first assertion of the arm before it: the same kind of folder, with a readable config, answers "not a git repository".
- The stub arm stays (macOS and Linux), and its Windows skip reason now names this arm as its counterpart.

**Measured.**
- GitHub windows-latest: handoff 22 pass / 2 skipped three times (run 46134861504). Before, on main, it was 21/2 (run 46120990799), so the new arm runs and passes there.
- Mac: 24/24.
- Mutant: a gitFact that calls every git failure "not a git repository" turns the new arm red.

**Still owed on #9269:** the chmod-forced-error arms.

**Weakest premise.** It needs a git that reads GIT_CONFIG_GLOBAL (git 2.32 or later, 2021). An older git ignores the variable, and the arm would then fail loudly on 'not a git repository', not pass.
