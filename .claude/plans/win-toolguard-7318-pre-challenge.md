---
pre_challenge: true
method: challenge-loop
branch: win-toolguard-7318
diff_hash: ecbc83225343b9ce2223dfe7609f80311a627e4a03f4dfdb62947cf1a36dafc8

validation: tools.command-words-7262.test.js + engine/windows-tests-1777.test.js + tools.windows-tests-schtasks-7247.test.js on the Windows box 73/73, 0 skipped, 0 of 10 runs fail; all 87 engine/*win32*.test.js with the schtasks and tool-guard preloads 1588 tests 0 fail 0 refusals; POSIX proven identical to main (review 5); full suite via CI
subdir_audit: passed
timestamp: 2026-10-27T10:56:20Z
iterations: 5
converged: true
---

# Pre-PR review proof: win-toolguard-7318

**Iterations:** 5
**Converged:** Yes. The last round found no BLOCKER and no WARNING; its NITs are recorded below.
**Per-round record:** .claude/plans/win-toolguard-7318.md

## Rounds

#### Iteration 1
- Round 1: 1 BLOCKER, 2 WARNINGs, 3 NITs. BLOCKER FIXED: an env holding both PATH and Path was read by insertion order;
  node sorts the keys and the child gets the first (PATH), so the standard fake-first setup on a Path-spelled box was
  refused and the reverse let a real gh through (reviewer measured both); envVar now sorts the same way. WARNINGs FIXED:
  an env with no PATH searches the parent's PATH, as node does; .exe and .com by path count whatever PATHEXT says, and
  PATHEXT entries are trimmed. NIT FIXED: within() with a drive-root allowed dir. NITs ACCEPTED: a not-yet-existing file
  under a mixed 8.3/long temp path is refused (conservative); a Git Bash /c/... path resolves to C:\c\... (pre-existing).
  Reviewer confirmed POSIX unchanged and the real gh.exe on this box refused in every ordinary shape. Negative control:
  the new test fails against round 0. 59/59.

#### Iteration 2
- Round 2: 1 BLOCKER, 3 WARNINGs, 1 NIT. BLOCKER FIXED: PATH lookup tried every PATHEXT extension per directory, but
  node without a shell tries only .com/.exe (measured: node ran the real git past a fake git.cmd first on PATH), so a
  fake gh.cmd ahead of the real gh.exe hid it. onPath now returns the first find of each lookup (node: .com/.exe and cwd
  unless this process has NoDefaultCurrentDirectoryInExePath; cmd: the child env's PATHEXT and its copy of that
  variable; Git Bash: name then .exe, PATH only) and any real one refuses. The "Weakest part" claim that every-PATHEXT
  was a safe superset was wrong. WARNINGs FIXED: the NoDefaultCurrentDirectoryInExePath cwd skip (above); a URL cwd no
  longer throws; cmd's %VAR% is expanded on Windows. NIT noted: test-support.tool-guard-4326.test.js still fails 12 on
  Windows at base (POSIX fixtures); not this card. Negative control: the new test fails against round 1. 60/60; 87 win32
  files with both preloads: 1588 tests, 0 fail, 0 refusals.

#### Iteration 3
- Round 3: no BLOCKER (POSIX unchanged line by line; every common Windows call right; 89 win32 files with both
  preloads 0 fail 0 refusals). 3 WARNINGs, 2 NITs. FIXED: PATH: undefined is dropped as node drops it, so the parent's
  PATH is searched; a relative PATH entry resolves against the call's cwd (node ran rel\bin\x.exe, measured); node's
  lookup of a name with an extension also tries .com/.exe after it; a non-file cwd URL no longer throws in the guard.
  ACCEPTED and said in the onPath comment: every lookup applies to every bare word, so a fake cmd or Git Bash would
  really run (gh.cmd, an extensionless gh) is refused when node's lookup reaches a real gh.exe later on PATH; it can
  only refuse, and telling lookups apart needs the shared reader to say which program reads each word. Negative
  control: the new test fails against round 2. 61/61; win32 sweep below.
- After rebasing onto main (2fbb0884c1, #7316 merged): the drift test failed 2 of 20 runs here because #7262's fill()
  rewrote a capital P inside its own base64 (77 of 2000 realistic paths). Reported; Renet fixed it on main in #7325
  (f60741b125), so the fix carried here for a while was dropped from this branch.

#### Iteration 4
- Round 4: 1 BLOCKER (strict rule a), 3 NITs; the test file passed 30/30 runs; the real gh.exe refused in every
  ordinary shape; controls allowed. BLOCKER FIXED: the non-string cwd conversion and within()'s trailing-separator case
  were not gated to Windows, so POSIX behaviour changed (a URL cwd no longer threw; a TMPDIR of / allowed everything);
  both are now WIN-only, so POSIX is unchanged. NITs: plan line on the 4326 file corrected (12 fail at main, 2 here);
  a fake reached as \<drive path> counts as real (existing missing-path policy, accepted). 61/61, 10/10 runs.

#### Iteration 5
- Round 5: no BLOCKER, no WARNING, 1 NIT (realDirs computed before the lookup; no side effect; left). POSIX proven
  identical to origin/main: both versions loaded with process.platform forced to linux, 526,500 inputs each, twice
  (once with execute bits patched in so the bare-name lookup runs), byte-identical output; a negative control without
  the force differs on 132,330 lines. Windows: the real gh.exe refused in every ordinary shape. Converged.
- Rebased onto main after #7325 (fill fix, mine dropped) and #7326 (#7299+#7320 reader): both append tests to
  tools.command-words-7262.test.js; resolving the join lost #7320 review 4's closing brace, caught by the file failing
  to load, restored; all 9 of main's tests plus 4 of this branch's present. 73/73, 0 skipped, 0 of 10 runs fail; 87
  win32 files with both preloads (this guard on #7326's reader): 1588 tests, 0 fail, 0 refusals.

### Final Ledger
- [NIT] realDirs is computed before the PATH lookup even when the name is found nowhere (no side effect) --> ACCEPTED
- [NIT] every Windows lookup applies to every bare word, so a fake that cmd or Git Bash would really run (gh.cmd, an extensionless gh) is refused when node's lookup reaches a real gh.exe later on PATH (refusal only) --> ACCEPTED, said in the onPath comment
- [NIT] a fake reached as \<drive path> counts as real (the existing missing-path policy) --> ACCEPTED
- [NIT] test-support.tool-guard-4326.test.js still fails 2 tests on Windows (its /bin/echo and bash -lc fixtures are POSIX-only; 12 fail at main) --> ACCEPTED, out of scope
