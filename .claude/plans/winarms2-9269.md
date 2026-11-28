# winarms2-9269 (kosmos#9269, slice 2: the Claude probe's stand-in)

**Problem.** engine/create.claude-probe-1916.test.js skipped six arms on Windows: its fake claude was a `#!/bin/sh` script, which Windows cannot run by its shebang, and the probe spawns the runner directly (execFile, no shell). The probe itself exists on Windows.

**Change.**
- **Production.** `defaultClaudeProbe` (engine/create.js) starts the runner through `tunnelCommand`, the seam slice 1 (#9295) gives codex and grok. A `.js`/`.cjs` path starts as this node with the script first, and a real claude (an executable) starts exactly as before.
- **Test.** The fake is `claude-fake.js`, a node script with the same five modes. It was compared to the shell fake mode by mode: exit codes, stdout and stderr match byte for byte, the middle dot in the 401 line included. A copy with one character changed showed the difference, so the comparison can fail. The six skips are gone.

**Measured.**
- GitHub windows-latest: claude-probe 7/7 three times (run 46131445901). On main before this change it was 1 pass, 6 skipped (run 46120990799).
- Mac: claude-probe 7/7, and the 59 test files that read create.js or the probe 1163 pass, 0 fail (8 skipped, as before); windows-tests-1777 24/24.

**Still owed on #9269:** handoff's stub git, filewho's UNC arm, and the chmod-forced-error arms.

**Weakest premise.** On a Mac the test would pass without the production line too, since the fake has a node shebang. Only the Windows job, which runs this file (ALSO), can see that line go missing.
