---
pre_challenge: true
method: challenge-loop
branch: worldundo-8402
diff_hash: dff8c115c0249cb0d68fad54240ad70bdc13c07d15ab5322049727d2ffc30ba4
validation: passed
subdir_audit: passed
timestamp: 2026-11-11T22:38:12Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4, reviewers alternating opus and sonnet, each blind and each on the whole diff
**Converged:** Yes (iteration 4 found no BLOCKER, WARNING or CONVENTION; NITs only)
**Total findings acted on:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, plus NITs
**Fixed:** all 4 WARNINGs and most NITs | **Deferred:** the "Kosmoses" wording NIT (the product's own plural) | **Carded:** 0 | **Asked:** 0

Built on Renet's boundednode-8388 (#8399) and rebased onto main 9dba90b47a after it merged, with no conflict. All nine
install.uninstall-*.test.js and install.launchguard-6650.test.js files pass on the rebased head (70 of 70). Full run-tests
validation PASSED on it (hash dff8c115c024). The subdir CLAUDE.md audit passed. Main has since moved 15 commits, none
touching install/setup.sh or its test.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] a stalled mount cost one bound per named Kosmos, each node possibly left running. FIXED: _gw_stopped ends the loop and the person is told once. Test with control.
- [WARNING] the second call site (install already gone) untested for named Kosmoses. FIXED: re-run test.
- [NIT] folder names the engine could not make were read; the same line once per record. FIXED (filter, _gw_say_once). Control for each.

#### Iteration 2 (sonnet)
- [WARNING] the here-document that replaced the pipe is a temp file in bash 3.2, so a full TMPDIR ends the uninstall under set -e. FIXED: split with parameter expansion in this shell.
- While fixing it, a scripted splice left the here-document body in place, which ran the node output as commands. The tests caught it at once (8 red). Fixed before any push, and re-tested.
- [NIT] wording; worlds/default untested. FIXED.

#### Iteration 3 (opus)
- [WARNING] in a UTF-8 locale, macOS sh's [!a-z...] matches capitals, so a hand-made worlds/Foo was read (measured by the reviewer). FIXED: letters spelled out. Test under en_US.UTF-8; control red with a-z.
- [NIT] the no-node opening line once per record; plainer stop note; the main-folder-empty case. FIXED.

#### Iteration 4 (sonnet)
- No BLOCKER, WARNING or CONVENTION. Nine files, 62 tests, 0 fail. Probes under sh, bash and dash: glob characters and command text in a message stay literal, and the loop ends.
- [NIT] "your other Kosmoses" wording: kept (the product says Kosmoses).
