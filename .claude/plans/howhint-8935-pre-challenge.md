---
pre_challenge: true
method: challenge-loop
branch: howhint-8935
diff_hash: c7aca7ce57bae40427e9fb4eec245cb291fe0fe72d622046743d508ca27ff492
validation: full suite PASSED on cddbb5569a (validation-log hash c7aca7ce57ba; node 30121 pass, 0 fail; test:shell 4 shards all green)
subdir_audit: passed (rc 0)
timestamp: 2026-11-23T17:32:29Z
iterations: 9
converged: true
---

# Challenge-loop proof: howhint-8935 (kosmos#8935)

Iterations alternated sonnet and opus, each a fresh blind read-only reviewer. Full findings per round are in .claude/plans/howhint-8935.md.

- Iteration 1 (sonnet): [WARNING] stdin could be read by the hint, fixed with </dev/null; [WARNING] dispatch coverage untested, fixed.
- Iteration 2 (opus): [BLOCKER] Windows half never fired (agents carry only a token), fixed with a hashed launch key; [BLOCKER] the report hook used up the pointer, fixed (bare and --auto calls skip); [BLOCKER] report --help showed the pointer, fixed.
- Iteration 3 (sonnet): [WARNING] new tests missing from tools/windows-tests.js, fixed; record now written via store.saveFlushed and kept in store.currentDataRoot().
- Iteration 4 (opus): [WARNING] the record write could create the data folder, fixed; [WARNING] a sandbox under temp could be written, fixed.
- Iteration 5 (sonnet): [WARNING] Mac --auto skip matched substrings, fixed to whole arguments.
- Iteration 6 (opus): [WARNING] test-run guard checked only the env handed in, fixed to check this process too; Windows test asserts a local usage error.
- Iteration 7 (sonnet): no new findings (code only).
- Iteration 8 (opus, tests and hook): [WARNING] the test-run guard's test was vacuous, fixed with a case per half, each mutation red; [NIT] Windows record now checked.
- Iteration 9 (sonnet): no new findings over the whole diff. Converged.

Open items: none at BLOCKER or WARNING. One NIT deliberately not done (a test of the shell's own --auto short-circuit; node makes the same decision, so a break costs speed only).
