---
pre_challenge: true
method: challenge-loop
branch: win32-board-copy
diff_hash: a5820d70a5df865d860c7b32fcd39840cde0e50f24bac41f02ae1d2c2ea16498
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T04:40:40Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (opus, opus, sonnet).
**Converged:** yes. Round 3 found NO NEW FINDINGS.
**Fixed:** everything from rounds 1-2: 3 SAFETY, 1 BUG (a11y), 3 CONVENTIONs, 4 NITs, 2 TEST-GAPs, plus 2 residuals taken. After convergence, two CI failures on PR #2984 were also fixed (see "After convergence: CI").

**Asked (awaiting user):** 0. The coordinator made these design calls:
- an allow-list for opening documents on Windows; anything else is revealed;
- UNC and device paths refused, mapped drive letters accepted, the rule applied to the path the project record names;
- one quoted Explorer argument with `windowsVerbatimArguments`;
- `.rtf` dropped from the open list;
- a 1.5 s powercfg cache.

**How the hash was taken:** `diff_hash` is the sha256 of the raw bytes of `git diff origin/main HEAD -- . ':!.claude/plans/win32-board-copy-pre-challenge.md'`, computed with node over git's own output.
- It was re-taken after the CI fixes at `04bc30a3` (261,625 bytes), against `origin/main` `169c1a33`.
- The branch's merge-base is `c05c662d`; the branch is 14 commits ahead and 3 behind.
- Because that recipe diffs two trees, the hashed bytes also carry `origin/main`'s three commits since the base (#2977: `engine/create.js`, `engine/worldstarts.js`, their tests, `server.world-switch-agents-1704.test.js` and its plan files). None of those files overlap the 34 this branch changes, so the branch was not rebased.
- The earlier hash (`ca9f2dd6…`, taken at `db765875` on `c05c662d`) is superseded.
- The pre-challenge-gate hook isn't installed on this Windows box, so the recipe is written out here.

## Validation of record

All runs used the Kosmos runtime node v24.19 via PowerShell, the schtasks guard (`NODE_OPTIONS=--require=C:\Users\joshu\kosmos-scripts\no-schtasks-preload.cjs`), and APPDATA/LOCALAPPDATA pointed at scratch.

- **Round 2 fixes, builder:** the same 238 files on the branch and on a `git archive` of `c05c662d`. Both sides have 111 failures, with 0 differences by name and first error line (ports, temp suffixes and hashes normalized). The shared failures are Mac-assumption suites that fail on this box on main.
- **Round 3, reviewer:** 17 named suites in the worktree, 145/145 pass. The archive comparison of the 13 overlapping files is identical; the one failure on both sides is `fixture-discipline`'s `git ls-files` check, which can't run in a `.git`-less archive.
- **Harness scan:** no source-extraction harness newly fails. Every harness that lifts page functions loads the copy layer via `PLATFORM_COPY_FNS`.
- **Block log:** only read-only `schtasks /Query` calls from pre-existing suites. No test launched Explorer, Settings or a powercfg change; everything went through runner seams.
- **Mac unchanged:** a headless Edge render of head vs base (round 1 and round 2) showed only new elements hidden on the Mac. Every Mac painter's output and the wizard walk match.
- **CI browser check:** `render-win32-board-copy.js` is in `KOSMOS_BC_CI_ALLOWLIST`. Its in-page logic replayed in headless Chromium/Edge passed 31/31, but that replay could not see the WebKit-only failure described below.
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

PR #2984 at head `f5938bb3` was red on two jobs. Both causes were in files this branch added; neither changes product code.

1. **Test jobs (runs 34737981633, 34737983327): `✖ the browser-checks README names every script, and no script it does not have`.**
   - **Cause:** the new `docs/browser-checks/render-win32-board-copy.js` had no row in `docs/browser-checks/README.md`, which `browser-checks-indexed.test.js` requires for every script.
   - **Fix:** a row after `render-connect-win32-install-570.js`, in the same format as its neighbours.
   - **Local result:** `browser-checks-indexed.test.js` and `tools.browser-checks-wired.test.js` pass 9/9. `browser-checks-reason-grep` and `browser-checks-selectors` are 8/9 here; the one miss ("could not run the real grep") fails identically on the `c05c662d` archive, because this box has no grep to spawn, and it passed on CI's macOS runner.
2. **browser-checks job (run 34737983351): `render-win32-board-copy (failed twice)`, webkit only.**
   - **Cause:** the failing arm was "win32 page raised no errors". Over file:// the page's own boot reads (`/api/status`, `/api/worlds`, `/api/first-run` and ten more) cannot load, and WebKit reports each as a page error ("... due to access control checks."). Chromium does not, so the Chromium/Edge replay passed. The two file:// checks that passed in webkit in that same job, `render-firstrun-connect-fires` and `render-observed-consumers-1959`, never count page errors, so they cannot hit it.
   - **Fix:** copied from `render-autohello-2686.js`, an allowlisted check that asserts zero page errors on the same page. Its `initStub` is installed with `addInitScript` before any page script runs and replaces `window.fetch` with a benign `{ agents: [] }` answer. The boot fetches never reach file://, so no message is filtered, and every page error that still arrives is a real one.
   - **Still fails on a real script error:** a new CONTROL throws a real error on each page and requires the listener to catch it, in both engines, and the Mac page gained the same no-errors arm.
   - **Not run locally:** Playwright is not on this Windows box. The file is `node --check` clean, and the pattern is already green in that CI job.
