# #9024: node tests give pwsh a startup cache of their own

Card: https://github.com/joshualeestone/kosmos/issues/9024 (claimed: april, night shift 2026-11-25 00:03 CST)

## Measured first (is the card live?)
- #6352 already gave SHELL tests their own cache (tools.pwsh-cache-6352.test.js) and names node tests that spawn pwsh off Windows as "Not covered". That is where the 11-24 red was: engine/delete-leftover.win32-recyclebin-7820.test.js. Live.
- pwsh 7.6.5 on this Mac honours XDG_CACHE_HOME: with it set, pwsh writes powershell/StartupProfileData-NonInteractive there and the shared ~/.cache/powershell file's mtime does not change.
- Node tests that start a real pwsh off Windows: 7820 (fixed paths), win32-psquote-8213 and win-publish-node-sigwhy-8316 (pwsh on PATH). 7951 already sets its own XDG_CACHE_HOME. 6213, 8285 and win-setup-ps1 start pwsh only on Windows.
- 8213 and 8316 probe pwsh with `has()`; a broken pwsh fails the probe and every arm SKIPS as "no PowerShell", which hides it.

## The call
- test-support/pwsh.js: `pwshEnv(extra)` (process.env + extra + XDG_CACHE_HOME = one temp folder per test process, removed on exit; nothing changed on Windows) and `pwshState(exe)` ('missing' / 'ok' / "pwsh broken on this machine (startup cache?): ..." with the signal, the first stderr line and the recovery: move the file aside, never delete it).
- 7820, 8213, 8316 start pwsh with pwshEnv. 7820 asserts pwshState first; 8213 and 8316 register a failing "pwsh starts on this machine" test when pwsh is here but broken, instead of skipping.
- tools.pwsh-cache-9024.test.js: a sweep (every *.test.js naming pwsh and loading child_process must be classified: uses its own cache, or the reason it starts none off Windows; a new file fails until classified), plus unit tests of the helper with stand-in pwsh scripts. 6352's "Not covered" note now points here.

## Rejected
- Exporting XDG_CACHE_HOME suite-wide in tools/run-tests.sh. It would cover future tests for free, but on CI's Linux runners Playwright, pip, fontconfig and others read XDG_CACHE_HOME (Playwright keeps its browsers under it), so it could break unrelated tests. Narrow helper plus a sweep that cannot be forgotten instead.
- A fresh cache per pwsh start. Per test process is enough: two validations no longer share a file, and one file's tests run in order.

## Weakest premise
- That concurrent writers are the cause. The card says "likely, not proven", and so do I: the control below shows concurrent runs REWRITE the shared file, not that they corrupt it. The fix removes the exposure either way, and the damaged-file arm proves the tests no longer depend on the shared file at all.
- The sweep finds pwsh by the literal 'pwsh' / bin/pwsh. A test that builds the name another way is not seen (said in its header).

## What would change my mind
- A corruption of ~/.cache/powershell with no validation running (then the cause is elsewhere, e.g. a fleet tool, and this fix still protects the suite but does not stop the damage).

## Measured (this branch)
- Damaged-profile arm: XDG_CACHE_HOME pointing at a copy of 11-24's damaged profile (pwsh rc 134 on `1+1`, the control). origin/main's 7820: "#7820 the PowerShell scripts parse" FAILS (34 pass, 1 fail). origin/main's 8213: 27 of 27 SKIPPED, 0 run. Branch 7820 + 8213 + 8316: 75 pass, 0 fail, 0 skipped.
- Guard arm: a stand-in pwsh first on PATH that prints the FileLoadException and SIGABRTs itself: 8213 and 8316 each fail with "pwsh broken on this machine (startup cache?): pwsh could not run 1+1 (ended by SIGABRT): Unhandled exception. System.IO.FileLoadException ... never delete it" (2 fail, 28 skipped), where origin/main skipped silently.
- Concurrency: 4 parallel loops x 3 runs of branch 7820 (12 runs, 24+ pwsh starts): all pass, shared ~/.cache/powershell file mtime and md5 unchanged. Control: the same 12 runs of origin/main's 7820 against a scratch copy of the shared profile (never the fleet's real one): the file was rewritten (md5 changed), still valid (`1+1` = 2). Exposure shown, corruption not reproduced.
- tools.pwsh-cache-9024 + 6352 + the three tests + test-support.* + fixture-discipline + 1934 (from the repo root) + tools.windows-tests*: all pass.

## Challenge loop ledger

### Round 1 (sonnet, 00:08 CST): no BLOCKER, no MAJOR, 4 MINOR
- M1 the per-file check passed on any mention of pwshEnv( or XDG_CACHE_HOME, comments included: now each listed file pins its child_process call count and its pwshEnv( count, in code with comments taken out. Control: one 7820 start put back on the shared cache, with "pwshEnv(" left in a comment beside it, fails the check.
- M2 a 60 s timeout (a cold cache on a loaded Mac) was blamed on the startup cache: it now says "pwsh did not answer 1+1 within N s on this machine (busy?)". Tested with a stand-in that sleeps, at a 500 ms limit.
- M3 the cache folder is left on a SIGKILL: kept; it sits in the run root, which run-tests.sh removes.
- M4 'pwsh.exe' or a built name is not swept: kept, said in the header; nothing in the repo does it today.
- Measured: the five files, 85 pass, 0 fail, 0 skipped.

### Round 2 (opus, 00:12 CST): 1 BLOCKER, 2 MINOR
- BLOCKER tools.pwsh-cache-9024's two win32 skips are host branches, and engine/windows-tests-1777 requires every such file to be selected for Windows or excluded with a reason: it failed, and would have turned every full run red. I had picked meta tests by name and missed it. Fixed: listed in HOST_BRANCH_EXCLUDED with its reason (the converted tests still run on Windows).
- M2 strip() cannot see strings or regex literals: said beside it; a miscount fails loudly, never passes. No pinned file has one today.
- M3 the "fine" stand-in proves less if XDG_CACHE_HOME is already set: kept, the notEqual assertion covers it.
- Measured: every test file that lists *.test.js files (57, chosen by content, not name), run from the repo root: 1732 pass, 0 fail, 17 skipped.

### Round 3 (sonnet, 00:23 CST): nothing material, 5 MINOR
- M4 with pwsh broken, the skipped arms still said "no PowerShell on this machine": fixed in 8213 and 8316, they now say "pwsh is here but broken: see "#8213 pwsh starts on this machine"" (with the stand-in that SIGABRTs: 27 + 1 skips say so, 2 fail).
- M1 strip() and strings: already said beside it (round 2). M2 the cache folder on a SIGKILL: kept (round 1, the run root). M3 a busy machine's 60 s timeout fails the file: kept on purpose; it says "busy?", never the cache. M5 the pinned calls count goes stale if has() is deleted: that is what the pin is for.
- The reviewer ran 1777, fixture-discipline, test-support.tmpscope, engine.reachable, 9024, 6352: all pass.
- Measured: 8213, 8316, 9024, 7820: 83 pass, 0 fail, 0 skipped.

### Round 4 (opus, 00:27 CST): nothing material, 2 MINOR
- M1 8213 asked pwshState twice, so a first start that timed out and a second that worked could disagree (a failing test beside skips saying "no PowerShell"): it now asks once (`PWSH`) and every line reads that answer.
- M2 on Windows with only a broken pwsh, the skips kept the old wording: the platform check is gone with the single answer.
- Measured: with the SIGABRT stand-in, 27 skips say "pwsh is here but broken: see ..."; healthy 8213 + 9024 35 pass 0 fail 0 skipped; 1777 24 pass.
