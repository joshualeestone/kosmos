# parityrace-4478: the Windows CLI parity scan tolerates a file that vanishes mid-scan

Card: #4478 (filed from Kano's validation of #4356; night shift, claimed by pigeonpete 22:58).

## The defect
tools.windows-kosmos-cli-verbs-parity.test.js walks every source file in the repo and reads each one. server.test.js (#4435, #4408) makes `.probe-freshness-<pid>/x.js` at the repo root and removes it. When the two files run together, the scan lists the folder or file and it is gone before the read: ENOENT, a red on any branch, green alone.

## Built
- `listIfThere` and `readIfThere` in the parity test: an ENOENT on the folder walk or the read is skipped. Nothing else is: any other error still fails.
- A test of the race: a folder listed, removed as server.test.js does, then read and walked. Both skip. An EISDIR read still throws, as the control that "gone" is not "any error".
- server.test.js's comment said the probe folder is one "no other suite walks". False: it now says the parity scan walks it and skips a vanished file.

## Decided
- Fix the SCAN, not the probe. The card offers either. The probe must sit under the checked root (that is what #4408 tests), so moving it out is not available. Adding it to SKIP_DIRS by prefix would fix this one folder, while the scan would stay fragile to the next test that writes a temp file in the tree. A scan that skips vanished files fixes the class.
- Rejected: catching every read error. A permission error or a read of the wrong kind of thing would then pass silently, and the scan would look thorough while reading nothing. The existing asserts that the scan saw server.js's `task message` and projects.js's `task add` still guard the scan from reading nothing.

## Weakest premise
That skipping a vanished file can never hide a real teaching. It can only be skipped if it was deleted during the run, and a file deleted during the run is not in the tree the product ships.

## Tests
- tools.windows-kosmos-cli-verbs-parity.test.js: 11 tests pass (was 10).
- Mutants, each red: no guard on the folder walk; no guard on the read; every error counted as gone.

## Review round 1 (sonnet, blind): 0 BLOCKERs, 1 WARNING, 3 NITs
- **WARNING** The race test called the helpers directly, so the scan loop's own read was untested: putting fs.readFileSync back in the loop would stay green. Fixed: the loop is `taughtIn(files, root)`, used by both the whole-tree test and the race test, which passes a vanished file beside a real one. Mutant (a plain read back in the loop): red.
- **NIT** A dangling symlink reads as gone and is skipped. Said in the comment (harmless: it teaches nothing).
- **NIT** EISDIR/ENOTDIR from a path replaced by another type are not skipped. KEPT deliberately: only "gone" is skipped.
- **NIT** "a read of the wrong thing" was vague. It now names EISDIR.
- Confirmed: `e.isDirectory()` reads the listing's d_type and makes no new call, so the walk has no third vanish point. The coverage asserts still prove the scan reads real content.

## Review round 2 (opus, blind): 0 BLOCKERs, 2 WARNINGs, 2 NITs
- **WARNING** engine/projects.test.js walks the repo root and reads every non-test .js file with a plain read, and it does not skip dot-folders. So it has the same race with both probe folders. Fixed in the same way (listIfThere / readIfThere, ENOENT only), because the card is the class, not the one file. Also guarded: tools.all-node-tests-considered-1934.test.js, which lists folders (a narrower window: a probe folder gone between being listed and walked).
- **WARNING** server.engine-restart-4408.test.js carried the same false comment ("no other suite walks") for its `.probe-restart-<pid>` folder. Corrected. Both probe comments now name the three walkers.
- **NIT** The parity comment named only one probe. It now names both.
- **NIT** Nothing checked that the walk (not only the read) still fails on errors other than ENOENT. Added: walking a file as a folder throws ENOTDIR. Mutant (the walk alone swallows every error): red.
- Confirmed by the reviewer: fixture-discipline and engine.runnable-not-directory skip dot-folders; one-derivation walks only engine/; communitysend and setprovider-writes walk sandboxes.
- Weakest premise: the two sibling guards are the same pattern as the parity helpers, but only the parity helpers have a deterministic race test. The siblings are inline walks inside larger tests; they are checked by reasoning and by their tests passing (167 across the three files), not by a race test of their own.

## Review round 3 (sonnet, blind): 0 BLOCKERs, 2 WARNINGs, 2 NITs
- **WARNING** The dangling-symlink note was tested for files only. The comment now says exactly which case is which (a symlink to a missing file reads as gone; one to a missing folder is not a directory to the walk, so it is read and skipped the same way).
- **WARNING** The race test does not prove the whole-tree test calls taughtIn. KEPT: that test is one line, `taughtIn(sourceFiles(REPO, []), REPO)`, and a revert to a bare read would reopen the real race and show in the suite. The reviewer judged it acceptable.
- **NIT** isDirectory() is a race-free dirent read. Noted, no change.
- **NIT** Three copies of the ENOENT guard. KEPT: each test file stays self-contained, and there is no shared test-support helper for it yet.
- Confirmed: every list and read in the three walkers is covered; each keeps a control that it read real content; no other repo-root walker reads files without skipping dot-folders (the git ls-files tests never see untracked probes).

## Review round 4 (opus, blind): 0 BLOCKERs, 0 WARNINGs, 2 NITs (converged)
- **NIT** The EISDIR and ENOTDIR asserts will run on Windows (the file matches tools.windows-*), where those codes are unmeasured. Fixed: they assert any code other than ENOENT, which still proves gone is not every error. All five mutants still red after the change.
- **NIT** server.test.js's comment split a file name across two lines, so a rename sweep would miss it. Each name is now on its own line.
- Confirmed: no other walker descends from the repo root; the board's freshness check uses require.cache, not a walk; the probes hold only `module.exports = N`, so they could teach no verb anyway.
