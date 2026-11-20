---
method: challenge-loop
branch: homer-win-kosmoscmd-8770
diff_hash: 70cd008b7fbe44ad45f908da3e3bd2b780f0d2bddaf90a68ccf0c28936cfd6dc
rounds: 4
converged: true
blockers_open: 0
date: 2026-11-19T23:50:07Z
---

# Pre-PR review proof: homer-win-kosmoscmd-8770 (#8770)

Four fresh blind review agents, each given the code, the issue and the questions, not my conclusions. Each ran its own measurements in a scratch folder outside the worktree, against the committed exe.
- Round 1: 0 BLOCKER, 2 WARNING, NITs. All fixed.
- Round 2: 0 BLOCKER, 2 WARNING, 2 NIT. All fixed except one NIT accepted (see below).
- Round 3: 0 BLOCKER, 1 WARNING, 2 NIT. All fixed.
- Round 4: 0 BLOCKER, 0 WARNING, 3 NIT. Converged; the NITs were fixed afterwards.

Hash taken against origin/main at 899048805f, HEAD 8151459225.

## Findings, round 1
- [WARNING] (fixed) No Ctrl+C handler: the CLR ended the exe at once, so cmd got its prompt back while node was still writing. Fix: Ctrl+C cancelled in the exe and left to node.
- [WARNING] (fixed) A caller's timeout killed only the exe; node was orphaned holding the caller's pipes, so a caller waiting for them hung. Fix: kill-on-close job object. Measured: the old exe left node alive; the new one does not.
- [NIT] (fixed) A lone surrogate became U+FFFD silently; now refused with exit 1.
- [NIT] (fixed) kosmos-cli.js said "the arguments PowerShell passed" to every launcher.
- [NIT] (fixed) verify-launcher.ps1 header comments named only Kosmos.exe.
- [NIT] (no change) The exe run through a file symlink reports "the runtime is missing" cleanly; junctions and 8.3 paths work.

## Findings, round 2
- [WARNING] (fixed) A gap between Process.Start and AssignProcessToJobObject in which a kill orphaned node. Fix: the exe joins the job before node starts, so node is created inside it.
- [WARNING] (fixed) CancelKeyPress cancelled Ctrl+Break too, which would hang if node ever handled SIGBREAK. Fix: only Ctrl+C is cancelled.
- [NIT] (accepted) An argv file can stay in TEMP if the exe is killed before node reads it; same as kosmos.ps1.
- [NIT] (fixed) A format-operator precedence reliance in verify-launcher.ps1, now bracketed.

## Findings, round 3
- [WARNING] (fixed) Started with no console (node spawn detached, piped), Process.Start passed node no std handles, so all output was lost. Fix: CreateProcess with STARTF_USESTDHANDLES and inheritable copies of the exe's three handles. A detached-spawn test was added: it failed before and passes now.
- [NIT] (fixed) The job handle leaked if SetInformationJobObject failed.
- [NIT] (fixed) Header warning added: anything node starts ends with the command, because of the job.

## Findings, round 4 (converged)
- Checked: P/Invoke layouts on x86 and x64; handle hygiene in every path; interactive console, ConPTY, pipes, detached, file output, hidden console; Ctrl+C live (node exits 0xC000013A, and the exe returns it).
- [NIT] (fixed) With no std handle and no console, node saw an invisible console and a TTY stdin, so a y/N prompt could wait for good. Now a missing stream becomes NUL (measured: stdinTTY true before, false after).
- [NIT] (fixed) GetConsoleWindow()==0 is not "no console"; now GetConsoleCP()==0.
- [NIT] (fixed) WaitForSingleObject's result is now checked.

## Verification on the box (final signed exe)
- transport-test.js 18/18 PASS: argv fidelity (quotes, &, %, ^, !, newline, non-ASCII, empty, trailing backslash); exit codes 1, 2, 3; stdin piped; stderr passed; argv file removed; cmd bare name; caret-escaped & stays text; node shell:true; detached spawn; timeout kill; REAL `kosmos agent list` from spawn without a shell and from cmd.
- Controls: without the exe the bare spawn fails with ENOENT; the same cmd line through a `.cmd` wrapper DOES inject.
- A real scheduled task running `kosmos agent list` through the exe: exit 0, the agents are listed.
- verify-launcher.ps1 -Cli OK (signature Valid, Kosmos Agent Manager, Inc.); plain verify-launcher.ps1 still OK for Kosmos.exe. A flipped byte and a one-word source change both fail it.
- 59 test files (Windows build, launcher, CLI and update tests, plus policy tests) on branch and main: 0 failures either side; the CLI, launcher and build tests rerun green on the later commits.
