---
method: challenge-loop
branch: linuxrunners-5419
diff_hash: f78ca2bc5647f5f4cd9fb669e2497672f65fcdff4866bdee385db9fc6570a145
timestamp: 2026-10-07T14:31:58Z
converged: true
---

# Challenge-loop proof: linuxrunners-5419 (#5419 slice 2, provider runners on Linux)

Codex and Grok install on Linux from the npm registry's own per-CPU tarballs, each pinned with its registry sha512
(x64 and arm64); Gemini's one bundle serves every platform through the POSIX launcher; tar on Linux is /usr/bin/tar,
then /bin/tar, then tar from PATH. A CPU with no build is refused by name before a byte moves; the Mac and Windows
entries are unchanged. Blind reviewers alternated Opus and Sonnet for 12 iterations; iteration 12 found no blocker,
warning or convention, so the loop converged.

This branch is stacked on #5419 slice 1 (linuxclaude-5419); the diff hashed here is against main, as the gate measures.
Linux lane run 37571724460 (read per file): engine/runners went from 22 failing test names to 0 on Linux, every runner
and platform test file 0, the suite 83 failures to 60 (the rest are other cards').

#### Iteration 1
- [WARNING] engine/runners.js:307 (SELF): Grok Linux layout inherited from Mac base. FIXED: 67406d70c
- [WARNING] engine/runners.js:1352 (SELF): stale darwin/win32 gate comments. FIXED: 67406d70c
- [WARNING] engine/runners.js:842 (PRE-EXISTING): Linux npm-global copies not detected. DEFERRED: harmless extra managed copy; plan
- [WARNING] plan (BRANCH): Grok on musl unmeasured. DEFERRED: plan weakest premise
- [NIT] literal version (FIXED); no full Linux install test (left); trailing comments (FIXED).

#### Iteration 2
- [WARNING] engine/runners.js:1134 (PRE-EXISTING (now reached)): tar hard-coded to /usr/bin/tar. FIXED: 788e11215 (test planted red)
- [WARNING] engine/runners.js:300 (SELF(it1 deferral)): Grok on musl downloads then fails. FIXED: 788e11215 (pre-download refusal; test planted red)
- [NIT] grok-native docblock (FIXED); platform docblocks (FIXED); describe doc (FIXED); install wiring URL test (left); plan size (FIXED).

#### Iteration 3
- [WARNING] engine/runners.js:1439 (BRANCH): no Linux prove-failure test. DEFERRED: prove step is the guard, shared with the Mac; plan
- [WARNING] engine/runners.linux-5419.test.js (SELF): no end-to-end Linux install test. FIXED: 964a2801f (fixture tarball; planted red)
- [WARNING] engine/runners.js:1566 (BRANCH): busybox tar long options unmeasured. DEFERRED: Alpine busybox has them; plan
- [WARNING] engine/runners.linux-5419.test.js:67 (SELF(it2)): dead regex alternative. FIXED: 964a2801f
- [WARNING] engine/runners.linux-5419.test.js:72 (SELF(it2)): control leaves install running. FIXED: 964a2801f (awaited; download asked)
- [CONVENTION] engine/runners.js:1754 (BRANCH): legacy rungs read Mac-only. FIXED: 964a2801f (comment names the deferral)
- [NIT] platform.js comment placement (left); describe wording (left); isMusl named fn (left).

#### Iteration 4
- [WARNING] engine/runners.linux-5419.test.js (SELF): no Codex/Gemini end-to-end Linux install. FIXED: 408d77a2a (planted red)
- [WARNING] engine/runners.gemini-grok-3713.test.js:103 (SELF(it3)): Grok read-back not as Linux. FIXED: 408d77a2a
- [NIT] platform.test comment (FIXED); platform.js header (FIXED); musl wording (FIXED); tar-missing sentence (left).

#### Iteration 5
- [WARNING] engine/runners.js:1436 (SELF(it2)): musl refusal states an unmeasured vendor fact. FIXED: d04d6e135 (measured static; refusal removed; reverses row 6)
- [WARNING] engine/runners.js:1436 (BRANCH): host musl detector edge cases. DEFERRED: moot: refusal removed
- [WARNING] engine/runners.linux-5419.test.js (BRANCH): no end-to-end Linux install test. DEFERRED: not an issue: three exist in runners.gemini-grok-3713.test.js (Grok, Codex arm64, Gemini)
- [WARNING] engine/runners.js:829 (BRANCH): Linux npm-global copies not detected. DEFERRED: dup row 3
- [NIT] status() size for unsupported CPU (left); RUNNER_DOWNLOADS grammar (left); lazy require (moot).

#### Iteration 6
- [WARNING] .github/workflows/linux.yml:13 (BRANCH): runners/server.runners/muserun still red, credited to slice 2. FIXED: 0d201b868 (runners.test.js pinned darwin; header reassigns the rest to the sweep; lane re-dispatched)
- [NIT] dead musl seam (FIXED); musl test limit (FIXED); connect comment (FIXED); arm64 integrity literals (left); no-tar sentence (left).

#### Iteration 7
- [WARNING] engine/runners.js:1139 (SELF(it2)): tar fallback /usr/bin/tar when neither exists. FIXED: 4968cb440 (bare tar; planted red)
- [WARNING] engine/runners.js:1006 (PRE-EXISTING): status() x64 size on unsupported CPU. DEFERRED: Windows parity; plan
- [WARNING] engine/runners.linux-5419.test.js (SELF): Codex x64 not end to end. FIXED: 4968cb440
- [WARNING] engine/runners.js:277 (SELF(it5)): static claim stronger than evidence. FIXED: 4968cb440 (measured, unrun)
- [NIT] npm-global /usr/local/bin (plan deferral); file-wide monkeypatch (noted); header claim about other files (lane verifies). | 24 | 7 | CONVENTION | engine/platform.js:99 | SELF | split docblock | FIXED | b31bf0ec3 |

#### Iteration 8
- [WARNING] engine/runners.test.js:31 (SELF(it6)): darwin pin without arch; x64 runner refuses. FIXED: b2c6c1a7c (arm64 pinned; lane re-dispatched)
- [NIT] musl test is a tripwire, not coverage (noted in it6); tar docs (FIXED); unused t (FIXED); bare tar PATH residual (plan).

#### Iteration 9
- [WARNING] engine/runners.linux-5419.test.js:27 (SELF): arm64 integrity and sizes not literal-pinned. FIXED: deed76556 (planted red)
- [WARNING] engine/runners.linux-5419.test.js:80 (SELF(it5)): musl test title overclaims. FIXED: deed76556 (renamed)
- [NIT] connect pointer (FIXED); jobs reset (FIXED); bare tar test (left); gemini note (FIXED).

#### Iteration 10
- [WARNING] engine/runners.gemini-grok-3713.test.js:24 (SELF(it4/7)): CODEX_BIN override not cleared. FIXED: 2c9464996 (reviewer's repro now green)
- [WARNING] .github/workflows/linux.yml:14 (SELF(it6)): engine/runners green stated, not measured. FIXED: 2c9464996 (worded as expected; confirm with lane)
- [NIT] manifestFor doc (FIXED); tar both-present (FIXED); musl tripwire (noted).

#### Iteration 11
- [WARNING] engine/runners.js:1139 (SELF(it2)): agentbrowser second caller unmentioned. FIXED: 12ae21782 (comment + plan)
- [WARNING] engine/runners.linux-5419.test.js:77 (SELF): musl test cannot fail today. DEFERRED: dup of it8/it10 NITs; renamed at it9; plan records it as a tripwire
- [NIT] install pin with explicit undefined (left); static claim unreproduced (plan); homebrew rungs (plan); tar comment placement (left).

#### Iteration 12
- [NIT] NO BLOCKER/WARNING/CONVENTION. NITs: Codex "static" read off the musl target, not the binary (left; plan wording); openai job left 'installed' in the 3713 loop (left); describe() lacks codex/keyed fields (pre-existing, Windows too); musl tripwire (noted).
- No BLOCKER, WARNING or CONVENTION. CONVERGED.

## Summary
- Iterations: 12. Converged at 12.
- Deferred with reasons in the plan: the npm-global Codex copy is not looked for on Linux; the musl test is a tripwire
  (Grok's static linking rests on the measurement, not a test); describe() reports only the Claude download field.

Moved onto main 2026-10-07 21:12 CDT after #5453 (slice 1) merged as 87a415de1: rebase --onto origin/main of this branch's own 15 commits (clean). On the new base: its own and its touched modules' tests plus engine.reachable, 21 files, 319 tests, 0 fail.
