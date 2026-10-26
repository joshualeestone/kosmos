---
pre_challenge: true
method: challenge-loop
branch: win-usage-tests-7247
diff_hash: 4caa473b58c74b4f310daffc4ee28b0d2eca427e2f14444ca1473e2e4d0622cf
validation: tools.windows-tests-schtasks-7247.test.js + engine/windows-tests-1777.test.js under the guard, 42/42 on the Windows box after rebase onto main (full suite via CI; npm test cannot run on Windows yet, #7257)
subdir_audit: passed
timestamp: 2026-10-26T23:38:17Z
iterations: 8
converged: false
---

# Pre-PR review proof: win-usage-tests-7247

**Iterations:** 8
**Converged:** No. Stopped after round 8 by the fleet review-loop rule (Splinter HEADS-UP, 2026-10-26 16:08 CDT: a loop stops at 8 rounds unless a BLOCKER is open; WARNINGs go to a follow-up card). Round 8 had no BLOCKER; its 2 WARNINGs and 3 NITs are on #7270 (one NIT taken into the PR body).
**Per-round record:** .claude/plans/win-usage-tests-7247.md (Rounds 1 to 8).

## Rounds


#### Iteration 1
- Round 1: no BLOCKER. Fixed: promisify shape (the wrappers dropped util.promisify.custom); the word schtasks in an
  argument was refused (now only calls that RUN it); async refusals unlike a missing program (now Node's own ENOENT);
  thin tests; comments repeating the unreproduced "thousands" claim; the rule written twice (run-tests.sh now runs the
  JS rule); another copy of the preload counted as this one; no cygpath fell back to a path node cannot load (now
  stops); the run was silent when the guard was off (now prints either way).
  Verified after round 1: install.reachable-1662 (16 pass / 30 fail) and cli.connections-4451 (1 / 5), both of which
  call promisify(execFile), give identical counts with and without the guard on this box (their reds are this box's
  baseline); windows-tests-1777 23/23; this file 8/8.

#### Iteration 2
- Round 2: no BLOCKER. Fixed: quoted shell forms (cmd /c "schtasks ...", powershell -Command "...") slipped through, and
  so did value-taking PowerShell switches (-ExecutionPolicy Bypass) and start /b; the matcher is now a small tokenizer
  that walks past cmd, powershell/pwsh, call and start (nested, quoted), decodes -EncodedCommand, and stops at
  -File (a script it cannot read, named in its header). run-tests.sh's bridge is tested with the node snippet read
  out of run-tests.sh itself. NITs taken: an explicit undefined args slot; one split per call; the header says the
  shell arms fail with ENOENT, not a shell's status, and that the log holds command lines; CI=false and CI=0 are not
  CI. Negative control: against round 1's code the two new behaviour tests fail. This file 11/11; with
  windows-tests-1777 34/34; under the guard 0 fail.

#### Iteration 3
- Round 3: no BLOCKER. Fixed: a refused call with null or undefined in its options slot lost its callback (a guarded
  test would hang rather than see ENOENT); the probe now covers execFile and exec with both (against round 2's preload
  the arms test fails). Decided, not changed: a process started with an environment of its own that leaves
  NODE_OPTIONS out runs unguarded, as does everything it starts. Re-adding the preload there was rejected because
  those callers strip NODE_OPTIONS on purpose (engine/manifest-verify.js does, and tests check that env); it is now
  said in the preload's header and in the runner's comment, and it is the guard's main gap (see Weakest part). The
  matcher's header lists what it does not read (script blocks, Start-Process, cmd /c with no space). 34/34 with
  windows-tests-1777.

#### Iteration 4
- Round 4: no BLOCKER. Fixed: run-tests.sh's no-cygpath fallback read CI=false as CI (now read as onCi does, and it
  prints the REAL-scheduler line when it goes on unguarded); bash, sh (with -c, -lc, -ec) and env in front of schtasks
  were not read, and tests do start bash -c (Git Bash's is an MSYS program NODE_OPTIONS never reaches); the docs said
  npm test "cannot reach" the scheduler, now "every node process" with test:shell's bash scripts named as unguarded.
  NITs taken: a source check that main() hands each file childEnv's env; one shared options-then-tail helper; the
  matcher's header names a lone apostrophe in a cmd line, wsl and npx. Negative control: against round 3's matcher and
  run-tests.sh the two new behaviour tests fail. 37/37 with windows-tests-1777; under the guard 0 fail.

#### Iteration 5
- Round 5: no BLOCKER. Fixed: zsh, dash, ksh and fish read as sh is, and -o/+o options (which take a value) no longer
  end the scan (against round 4's matcher the new test fails); seven win32 test headers named the outside copy of the
  preload and now name tools/no-schtasks-preload.cjs; the env gap now says "replaces NODE_OPTIONS or leaves it out".
  Answered in the plan: what win32job.js already refuses and what this layer adds. Decided: a second command reader
  beside tool-guard's, with the reasons under Rejected; one shared reader is #7262. NIT taken: the matcher's header
  names its known false positive (a parenthesis: "echo (schtasks)"). 38/38 with windows-tests-1777.

#### Iteration 6
- Round 6: no BLOCKER. Fixed: the seven win32 test headers I repointed in round 5 said `node -r tools/...`, which node
  resolves as a package and fails to load; now `./tools/...` (checked on the box: it loads). run-tests.sh's Windows
  block had never run (#7257): two tests now cut the block out of run-tests.sh and run it in bash with uname and
  cygpath stubbed, covering the export, the scheduler line, and the stop when cygpath is missing (CI unset, false or
  0) and the run when the real scheduler was asked for. Mutation control: with that block's `exit 2` replaced, the
  stop test fails. `env -u NAME`, `-C DIR` and `-S STRING` are read past their values (against round 5's matcher the
  new test fails). The matcher header names PowerShell's parameter prefixes (-Com, -enco) as unread. 41/41 with
  windows-tests-1777; bash ran here (no skip).

#### Iteration 7
- Round 7: no BLOCKER. Fixed: a launcher given by a quoted path with a space ("C:\Program Files\Git\bin\bash.exe" -c,
  "...\pwsh.exe" -Command) was re-read as a command line and missed (now read as that launcher; against round 6's
  matcher the new test fails); bash -O/+O and --rcfile/--init-file are read past their values; -c is matched
  case-sensitively, so bash -C (noclobber) is not taken for it. This file alone: 19/19; with windows-tests-1777 under
  the guard: 42/42.
- Round 8 (last; the fleet rule stops a loop at 8 rounds unless a BLOCKER is open): no BLOCKER. Reviewer re-ran this
  file 19/19 and ten existing win32 test files under the preload (green, zero refusals), and checked every refusal path
  ends ENOENT without hanging. Two WARNINGs and three NITs, all in the matcher, none a call the code makes today, are
  DEFERRED to #7270: prefixes that end the scan (NAME=value, @, if exist, nohup/exec/time/timeout, `>` with no space,
  backticks) and launcher args joined without their quoting (refuses `cmd /c echo "a & schtasks"` and heredoc bodies).
  NIT taken into the PR body: run-tests.sh's Windows block is proven only under stubbed uname until #7257.
  Converged: no (stopped by the round cap; round 8 had no BLOCKER).

### Final Ledger (iteration 8)
- [WARNING] tools/lib/schtasks-call.cjs wordsRun: prefixes end the scan (NAME=value, @, if exist, nohup/exec/command/time/timeout, `>` with no space, backticks) --> DEFERRED (#7270)
- [WARNING] tools/lib/schtasks-call.cjs callRuns: launcher args joined without quoting, refuses `cmd /c echo "a & schtasks"` and heredoc bodies --> DEFERRED (#7270)
- [NIT] cmd's `""C:\path with space\schtasks.exe" /End"` form missed --> DEFERRED (#7270)
- [NIT] `env -S "schtasks /End"` reads -S's value as an option, not a command line --> DEFERRED (#7270)
- [NIT] run-tests.sh Windows block proven only under stubbed uname until #7257 --> TAKEN (stated in the PR body)
