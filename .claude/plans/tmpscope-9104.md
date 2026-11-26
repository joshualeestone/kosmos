# tmpscope-9104: every suite test file that calls tmpdir() requires tmpscope first (kosmos#9104)

## Why
#9098 was one site of a class: a raw `fs.mkdtempSync(path.join(os.tmpdir(), ...))` swept only in `test.after()` leaves its
folder when the process ends early, and a full validation of an unrelated branch goes red on the #4273 leak check.
Earlier single-site fixes: #8225, #7442, #6017, #9098.

## Change
- 1,114 test files (root and engine/, the suite's globs) that mention `tmpdir(` and never required tmpscope get
  `require('./test-support/tmpscope')` (or `../` in engine/) before their first code (after any shebang, leading
  comments and 'use strict'). Measured on origin/main 803efc5d58.
- 2 files that required a helper before tmpscope (server.decline-imports-8039, engine/trust.decline-imports-8039)
  have it moved to the top.
- Guard: test-support.tmpscope-first-9104.test.js. Any suite file that mentions `tmpdir(` must require tmpscope (or
  tmpscope-outside-home) before any tmpdir() call and before any non-builtin require. Two named exemptions with reasons:
  test-support.tmpscope.test.js (tests tmpscope itself) and engine/status.test.js (#5334, tmux socket path length).

## Decisions
- Scope is every file that mentions `tmpdir(`, not only `mkdtemp(path.join(os.tmpdir()` (the card's 843). Wider, and
  requiring tmpscope where it is not needed costs nothing. Rejected: the narrower pattern, which misses
  `const { tmpdir } = require('os')` and helper-built paths.
- engine/status.test.js is exempt rather than converted: its socket tests need the short real temp path. Converting it
  (deriving the real root as the parent of scopeDir()) is a separate change; noted on the card.
- Weakest premise: that no test asserts on the real os.tmpdir() value or a temp path length. The full validation is
  what checks it; a sample of 25 changed files (307 tests) passed.

## Measured
- Guard green on the branch; control (guard over origin/main's test files) red with 1,116 files named, 1,114 + 2.
- Sample: 25 random changed files, 307 tests, 0 fail.

## Challenge round 1 (20:56): no blocker; fixed
- SHOULD-FIX: 13 files made temp folders through helpers (mkTemp in test-support/tmpdir.js, catalogue-fixture), which
  sweep on 'exit' only, so the guard (looking for tmpdir( in the file) could not see them. Fixed: the guard finds every
  test-support helper whose source calls tmpdir(, counts a file that loads one as a user, and the 13 now require
  tmpscope (123 tests pass). Reviewer measured mkTemp + SIGTERM leaving a folder, and none with tmpscope first.
- SHOULD-FIX: a tmpscope mention in a comment counted as the require. Fixed: the require is matched in code only.
- NIT fixed: `${os.tmpdir()}` in a template before the require is now seen (parens kept in blanked strings).
- NIT left: supervisor.macrestart-8988.test.js socket path is about 99 of ~104 bytes under run-tests (reasoned, it
  passes 14/14 alone). Left: the full validation measures it; if it fails there, exempt with reason.
- NIT left: regex literals in codeOnly are not modelled (documented, no live instance).

## Challenge round 2 (21:05): no blocker; fixed by changing the rule
- SHOULD-FIX (measured false pass): product code makes temp folders too (engine/store.js test home, sweep on 'exit'
  only; 58 files load it without tmpscope; reviewer left kosmos-test-home-* on SIGTERM). SHOULD-FIX: the helper scan
  read raw text, so a comment in test-support/page.js would turn 166 files red.
- Call: the rule is now EVERY suite test file requires tmpscope first (two named exemptions). 694 more files get the
  one line. Rejected: teaching the guard each temp-making module (round 1 helpers, round 2 product code: the detector
  kept missing paths). Weakest premise: that no suite file breaks under a per-process TMPDIR; the full validation
  checks it. Sample of 25 from the new batch: 195 tests, 0 fail.
- Byte check: every inserted file equals origin/main apart from the one line (1,822 files), so the utf8 rewrite
  corrupted nothing. test-support.stray-processes.test.js already required tmpscope as a const: left unchanged.
- NITs left: test-leak-allowlist.txt not trimmed (families now leave nothing; a trim is a separate change); one
  spelling of the require is enforced (path.join form fails, cannot false-pass); codeOnly regex/nested template limits
  (documented); macrestart socket ~95/104 bytes (computed, passes).

## Challenge round 3 (21:14): one BLOCKER, fixed
- BLOCKER (computed): unix socket paths under tmpscope's extra 11 bytes (`/kts-XXXXXX`) near or past macOS's 104-byte
  sun_path in engine/win32presence-8415.test.js, engine/win32channel.owner-1765.test.js, engine/win32channel.test.js,
  and supervisor.macrestart-8988.test.js close to it. Fixed: shorter mkdtemp prefixes (wp8415-, wo1765-, wc570-, mr-);
  each prefix appeared only in its own file. Measured under a run-root-shaped TMPDIR ($TMPDIR/kt99999, 64 bytes real):
  presence, owner-1765 and macrestart pass; socket paths now ~95 bytes.
- win32channel.test.js went red twice under that root at load ~149 (stand-in supervisor not up in 8 s; a helper that
  only calls process.exit(1) outlasting a 2 s budget), and green twice alternating with main's file at load ~36-42
  (main green all four times). Call: load, not tmpscope. Weakest premise: main also ran in the spike and passed, so
  this is reasoned; the full validation decides.
- SHOULD-FIX (guard cannot see socket budget): noted in the EXEMPT comment of the guard.
- NITs left: textual-only guard (require inside a callback, createRequire, import(), a TMPDIR read before it); a lazy
  require in a function above the line reads as a require before it. None occur today.

## Challenge round 4 (21:29): CONVERGED, no blocker, no should-fix
- Clean (measured): tmux -L sockets ignore TMPDIR; other unix sockets under os.tmpdir() within budget; no file asserts
  on the old/new prefixes; leak guard counts a kts- folder only when it survives its sweep; heavy-gate and store
  run-root checks still match; heavy-gate, store.real-root, fixture-discipline, one-derivation, uncaught-handler,
  comment-deferral green under a run-root-shaped TMPDIR, root left empty.
- NITs left: Windows unmeasured (231 of the 303 Windows-runner files change; TEMP/TMP also scoped there; the
  pull_request Windows workflow decides); an open PR adding a new test file goes red on the guard until it adds the
  line (said in the PR text); run-tests.sh:745's tmux comment is stale (tmux reads TMUX_TMPDIR, not TMPDIR), the
  guard's 104-byte note is about net.listen sockets, which is right.

## Validation 1 (Mortals 00:37): RED, a real defect, fixed
- Node part 31,296 tests, 0 failed; shell shards 2-4 green; shard 1 red on tools/test-bc-quarantine.sh (36 passed,
  3 failed): it copies browser-checks-quarantine-guard.test.js into a fixture folder with no test-support/, and the
  inserted require threw "Cannot find module './test-support/tmpscope'".
- Fixed: the shell test copies tmpscope.js and what it loads (remove-at-end.js, remove-tree.js) beside the copy.
  Measured: 39 passed, 0 failed. [CORRECTED by round 5: not the only one, see below] It looked like the only suite script that runs a suite test file outside the repo (the node
  part, which would have failed the same way on any other, was 0 failed; tools/test-install-gate-control.sh is only
  `bash -n` and names no .test.js). release.sh step 1e runs the file in the repo, unaffected.

## Challenge round 5 (00:45): one SHOULD-FIX, fixed
- tools.release-gate.test.js:539 also copies browser-checks-quarantine-guard.test.js into its release sandbox, with
  no test-support/, and its arms run release.sh step 1e on it. It stayed GREEN because step 1e inherits
  NODE_TEST_CONTEXT, with which a file that fails to load exits 0: the arms passed without step 1e checking anything.
- Fixed: the sandbox gets tmpscope.js, remove-at-end.js, remove-tree.js. Measured: release-gate 71 of 71; the same
  layout run by hand without the masking variable: without test-support rc 1 "Cannot find module", with it 14 of 14.
- The masking is older than this branch: filed #9120 (unclaimed).
- NIT left: both copy sites list the three files by hand; a new tmpscope require turns them red loudly, not green.
- Ruled out by the reviewer: Linux/Windows build and bundle scripts skip *.test.js; CI workflows run from the
  checkout; other tests copy only non-test files; a real cut runs step 1e in the repo.
