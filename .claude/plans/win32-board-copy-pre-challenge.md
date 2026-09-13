---
pre_challenge: true
method: challenge-loop
branch: win32-board-copy
diff_hash: 03f1df25f5eac559c3ec0b46a9b7868bfaa34e95d4e9cf4a3f729ccfe6c87004
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T05:01:04Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (opus, opus, sonnet).
**Converged:** yes. Round 3 found NO NEW FINDINGS.
**Fixed:** everything from rounds 1-2: 3 SAFETY, 1 BUG (a11y), 3 CONVENTIONs, 4 NITs, 2 TEST-GAPs, plus 2 residuals taken. After convergence, three CI failure causes on PR #2984 were also fixed (see "After convergence: CI").

**Asked (awaiting user):** 0. The coordinator made these design calls:
- an allow-list for opening documents on Windows; anything else is revealed;
- UNC and device paths refused, mapped drive letters accepted, the rule applied to the path the project record names;
- one quoted Explorer argument with `windowsVerbatimArguments`;
- `.rtf` dropped from the open list;
- a 1.5 s powercfg cache.

**How the hash was taken:** `diff_hash` is the sha256 of the raw bytes of `git diff origin/main HEAD -- . ':!.claude/plans/win32-board-copy-pre-challenge.md'`, computed with node over git's own output.
- It was re-taken after the CI fixes at `91bc02af` (328,213 bytes), against `origin/main` `c6812e0a`.
- The branch's merge-base is `c05c662d`; the branch is 17 commits ahead and 4 behind.
- Because the recipe diffs two trees, the hashed bytes also carry `origin/main`'s four commits since the base: #2977 (`engine/create.js`, `engine/worldstarts.js`, their tests, `server.world-switch-agents-1704.test.js`) and #2985 (`install/kosmos`, `install/setup.sh`, `package.json`, installer tests), plus their plan files.
- Those 16 files overlap none of the 34 this branch changes. `git merge-tree` onto `c6812e0a` is clean, and GitHub reports the PR `MERGEABLE`, so the branch was not rebased.
- Earlier hashes (`ca9f2dd6…` at `db765875`, `a5820d70…` at `04bc30a3`) are superseded.
- The pre-challenge-gate hook isn't installed on this Windows box, so the recipe is written out here.

## Validation of record

All runs used the Kosmos runtime node v24.19 via PowerShell, the schtasks guard (`NODE_OPTIONS=--require=C:\Users\joshu\kosmos-scripts\no-schtasks-preload.cjs`), and APPDATA/LOCALAPPDATA pointed at scratch.

- **Round 2 fixes, builder:** the same 238 files on the branch and on a `git archive` of `c05c662d`. Both sides have 111 failures, with 0 differences by name and first error line (ports, temp suffixes and hashes normalized). The shared failures are Mac-assumption suites that fail on this box on main.
- **Round 3, reviewer:** 17 named suites in the worktree, 145/145 pass. The archive comparison of the 13 overlapping files is identical; the one failure on both sides is `fixture-discipline`'s `git ls-files` check, which can't run in a `.git`-less archive.
- **Harness scan:** no source-extraction harness newly fails. Every harness that lifts page functions loads the copy layer via `PLATFORM_COPY_FNS`.
- **Block log:** only read-only `schtasks /Query` calls from pre-existing suites. No test launched Explorer, Settings or a powercfg change; everything went through runner seams.
- **Mac unchanged:** a headless Edge render of head vs base (round 1 and round 2) showed only new elements hidden on the Mac. Every Mac painter's output and the wizard walk match.
- **CI browser check:** `render-win32-board-copy.js` is in `KOSMOS_BC_CI_ALLOWLIST`. After the fetch stub, CI run 34738491929 showed every assertion passing in both chromium and webkit except the since-removed probe (see below).
- **Real powercfg:** a read-only `powercfg /qh SCHEME_CURRENT SUB_SLEEP STANDBYIDLE` capture from this box is the en-US fixture.

## Control runs

36 of 36 went red, run in a scratch worktree that was restored and confirmed clean. They cover:
- every safety arm: the allow-list, ADS, UNC/device and drive-relative paths, the quoting, and the project route;
- both halves of the a11y label;
- the inline Windows string, the one-comparison test, and the Documents sentence;
- the cache and the TTL, `.rtf` back on the list, and `/qh`;
- NIT 1, NIT 2, and both halves of NIT 3;
- every round-0 control.

## Iteration 1 (opus): 3 SAFETY, 1 BUG, 2 CONVENTIONs, 1 NIT, 2 TEST-GAPs

- **[SAFETY]** Opening a document via Explorer RAN executables: agent-written `.bat`, `.lnk`, `.hta`, `.vbs` and similar files carry no Mark of the Web. The fix is `OPENABLE_FILE_EXTENSIONS` checked on the resolved target's extension. Anything else is revealed with `/select,` and a sentence the page shows.
- **[SAFETY]** UNC and device paths were accepted, which could leak the person's NTLM hash. They are now refused.
- **[SAFETY]** Commas in a path split Explorer's arguments. The fix is one quoted argument with `windowsVerbatimArguments`.
- **[BUG]** The Terminal section's `aria-label` still said "Terminal". It now uses "Live output" from the same copy key.
- **[CONVENTION]** The browser check was missing from the CI allowlist, and some Windows strings sat outside `windowsCopyTable`.
- **[NIT]** powercfg now uses `/qh` with a cache.
- **[TEST-GAP]** `PLATFORM_COPY_FNS` was incomplete, and `web.reload-button-995` didn't load the layer.

## Iteration 2 (opus): no SAFETY, no BUG; 3 NITs

- **Bypasses probed,** all revealed or refused: 8.3 names, symlinks, junctions, look-alike dots, RTLO, `::$DATA`, `.lnk` and `.url`, capitals, drive-relative paths, `\??\`, a trailing backslash.
- **Merge:** `merge-tree` onto `49c81470` was clean, with no overlap with #2975.
- **[NIT]** A stale "revealed instead" sentence under the next open. Now cleared.
- **[NIT]** The Windows update-abort remedy wrongly said to double-click Kosmos.exe. It now says to sign out and back in.
- **[NIT]** Mapped drives were handled inconsistently. They are now accepted for both paths, with the rule applied to the path the project record names; literal UNC is still refused.
- **Residuals taken:** `.rtf` removed from the open list; the powercfg TTL is now 1.5 s.

## Iteration 3 (sonnet): NO NEW FINDINGS

- **Record path vs resolved target:** every branch was walked. A symlinked `a.pdf` resolving to `.hta` is revealed, never opened, and an escaping symlink is refused by the existing project-root check.
- **`namedAs`:** it has exactly one call site, computed server-side; no route accepts it.
- **`setFsWorldForTests`:** test-only, excused in `engine.reachable`, the same pattern as existing setters.
- **NIT 1/2:** confirmed.
- **Mac:** unchanged.
- **Rebase:** no overlap with #2972.

## After convergence: CI

PR #2984 went red at head `f5938bb3`, and a first fix at `84790346` surfaced a third cause. All three were in browser-check files and gates; none changes product code.

1. **Test jobs (runs 34737981633, 34737983327): `✖ the browser-checks README names every script, and no script it does not have`.**
   - **Cause:** the new `docs/browser-checks/render-win32-board-copy.js` had no row in `docs/browser-checks/README.md`, which `browser-checks-indexed.test.js` requires for every script.
   - **Fix:** a row after `render-connect-win32-install-570.js`, in the same format as its neighbours. On the next CI run the node suite reported `fail 0`.
   - **Local result:** `browser-checks-indexed.test.js`, `tools.browser-checks-wired.test.js` and `browser-checks-selectors.test.js` pass 13/13. `browser-checks-reason-grep`'s "agrees with the real grep" arm fails here and identically on the `c05c662d` archive, because this box has no grep for it to spawn; it passed on CI's macOS runner.
2. **browser-checks job (run 34737983351): `render-win32-board-copy (failed twice)`, webkit only.**
   - **Cause:** the failing arm was "win32 page raised no errors". Over file:// the page's own boot reads (`/api/status`, `/api/worlds`, `/api/first-run` and ten more) cannot load, and WebKit reports each as a page error ("... due to access control checks."). Chromium does not, so the Chromium/Edge replay passed. The two file:// checks that passed in webkit in that same job, `render-firstrun-connect-fires` and `render-observed-consumers-1959`, never count page errors, so they cannot hit it.
   - **Fix:** copied from `render-autohello-2686.js`, an allowlisted check that asserts zero page errors on the same page. Its `initStub` is installed with `addInitScript` before any page script runs and replaces `window.fetch` with a benign `{ agents: [] }` answer. The boot fetches never reach file://, so no message is filtered, and every page error that still arrives is a real one. The Mac page gained the same no-errors arm.
   - **Verified on CI run 34738491929:** both no-errors arms pass in chromium and webkit.
   - **Removed on that same evidence:** a control added on top of the copied pattern threw an error from a `setTimeout` scheduled in `page.evaluate` and required the listener to hear it. It passed in chromium but failed in webkit (65/66), and no existing check proves such a probe in webkit, so it was removed rather than replaced with a second guess. The check is now exactly autohello's pattern, which still reds on a real script error.
3. **Test jobs on `84790346` (runs 34738490621, 34738491954): the #2518 browser-check surface gate.**
   - **Cause:** `web/index.html` changes the surface tokens of two checks the branch did not touch: `fr-success` in `render-first-run.js` (the S7 Dock wrapper gained `data-win-hide`) and `fr-cmd` in `render-connect-win32-install-570.js` (the command moved into `.fr-cmd-row` beside a Copy button).
   - **Neither check is affected:**
     - `render-first-run.js` only anchors its S7 screenshot on `#fr-success`, and `data-win-hide` applies only under `html[data-kosmos-platform="win32"]`, which a Mac board never stamps.
     - `render-connect-win32-install-570.js` asserts the `.fr-cmd` text, its pre-wrap wrapping, the Try again tail and the platform plus `canInstallClaude` gate, all unchanged.
   - **Fix:** the gate's own per-check override, two `Browser-check-surface:` trailers with those reasons, in commit `66d2f98b`.
   - **Local result** through Git bash against origin/main: the surface gate (#2518) exits 0 and names both overrides; the coarse gate (#1720) exits 0.
   - **CONTROL:** the same surface gate with the two trailers withheld from the commit messages refuses, naming exactly the two checks CI named, and exits 1.
