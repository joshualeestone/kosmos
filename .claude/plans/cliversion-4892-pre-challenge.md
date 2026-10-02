---
pre_challenge: true
method: challenge-loop
branch: cliversion-4892
diff_hash: ba13da01c825ce009cccb3c65cfbcd3f384dcbf564038027c74d244c8245267c
subdir_audit: passed
timestamp: 2026-10-02T04:13:50Z
converged: true
---

## Challenge loop: 2 blind rounds, Opus and Sonnet alternating; the last found no new BLOCKER, WARNING or CONVENTION

Ledger in `.claude/plans/cliversion-4892.md` (Review rounds: every finding and its disposition).

## [WARNING] Round 1 (opus)
W (no test through a symlink, how every install runs it): ADDED a test through a two-link chain 
(absolute, then relative). Its feared failure cannot happen through this check, measured: with the script's link 
resolution disabled the test stays green, because cmp reads through links and compares the same bytes. So the test 
pins the real-world behaviour (no warning via ~/.local/bin), not the resolution. FIXED NITs: the warning says the 
copy's commands "may not match this version" (a dev checkout can be newer); the identical-copy test checks the 
exit code; the new comment wraps at the file's width. Left NIT: a missing cmp would warn falsely (macOS always has 
/usr/bin/cmp; this file is Mac only).

## [WARNING] Round 2 (sonnet)
its W restates the weakest premise above and calls the behaviour correct (DUPLICATE). NITs only 
otherwise (the link test pins behaviour, not resolution, as noted; a missing cmp; say's indent). CONVERGED.

## After convergence
Mortals validation (b004e911b) was red on one test only: cli.exit-code-mapping-3628 found that the new version test used an exit code without checking it is a number. Fixed (10ba69fa6); both files green locally. CI runs the full suite on the PR.
