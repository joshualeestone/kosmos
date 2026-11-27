---
pre_challenge: true
method: challenge-loop
branch: markwords-9179
diff_hash: ecd46cad29699dbe22d727870ac8641d801b3abe663a4ff2a982a2e65b2e62e9
validation: passed (this Mac, tools/run-tests.sh alone, KOSMOS_SUITE_MAX=1) at c46b8aff87 (origin/main merged in, including #9184's pgrep fix), ended 00:14 CST 11-27: 31,645 node tests 0 failed, all four shell shards status 0; validation-log hash ecd46cad2969 equal to diff_hash. Before queueing: the static set from the worktree 4,211/4,211 and the browser-check surface gate rc 0.
subdir_audit: passed
timestamp: 2026-11-27T06:15:01Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (opus and sonnet alternating), each over the whole branch.
**Converged:** Yes, at the last allowed round. Round 8: NO NEW FINDINGS.

### Iterations 1 to 4 (the first design: neutralise the bracket that opens a mark word)
- [IMPORTANT] forms a model reads as a mark (a hyphen, markdown, a combining accent, angle quotes); markdown padding past the 48-character window; a list of allowed endings that kept missing one (";", ".", a spaced dash); words after the mark word; control characters --> each FIXED in turn
- [NIT] comment order, test oracles copied from the code --> FIXED

### Iteration 5 (opus) --> REDESIGN
- [IMPORTANT] an unspaced dash, an emoji before the word, a closing quote used as an opener, math and fullwidth brackets still opened a mark --> a title that uses a mark word ANYWHERE is printed quoted with "(the task's own words, not a mark)"; no opener list needed

### Iteration 6 (sonnet)
- [IMPORTANT] the "built-" exception let "[built-done ...]" pass --> FIXED; the rule moved to engine/markwords.js for #9188 to share

### Iteration 7 (opus)
- [IMPORTANT] a fullwidth double quote and the CJK double primes could close the quotation --> FIXED (NFKC before the quote check, as forAgent does)

### Iteration 8 (sonnet)
- NO NEW FINDINGS. Residuals stated in engine/markwords.js and the plan: lookalike letters; more than six non-letters between "on" and "hold".

Correction recorded in the plan: rounds 2 to 4 claimed the files were pure ASCII on a check that false-zeros; measured with tr, the module, the test and the projects.js diff add 0 non-ASCII bytes.
