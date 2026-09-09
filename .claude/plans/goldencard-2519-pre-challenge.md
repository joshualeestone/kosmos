---
pre_challenge: true
method: challenge-loop
branch: goldencard-2519
diff_hash: 22cadb329c155f6c6ff4ec7d1011244577a2a5a231c9a7df99b994074da0c054
validation: passed
subdir_audit: passed
timestamp: 2026-09-09T09:55:32Z
iterations: 28
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 28
**Converged:** Yes, at iteration 28 (6d), on a pass that reviewed the shipped bytes
**Total findings:** 130+ (10 BLOCKERs, 80+ WARNINGs, 3 CONVENTIONs, 40+ NITs)
**Fixed:** nearly all | **Deferred:** 3 (all named below) | **Asked (awaiting user):** 0

⚠️ **The totals for iterations 4 to 7 are approximate and this proof says so rather than
inventing them.** The on-disk ledger records iterations 1 to 3 in full; 4 to 7 predate a
context compaction, so their reviewer models and headline findings survive but their exact
category counts do not. Every other iteration's counts are exact.

### What this branch is

`docs/browser-checks/render-talk.js` is a browser check run during release cuts. Its reopen
arm needs a REAL agent card from `status.snapshot()`, so on a box with no agents of ours it
FAILED the cut. This adds a RECORDED card as a fallback, a capture tool that neutralises
identifying content before the recording is committed, and a NOTE channel that takes no
part in the exit code.

### The two defect classes this loop actually found

Counted across 28 iterations, the findings were overwhelmingly NOT ordinary code defects:

1. **A claim in a comment or document broader or narrower than the code it describes:
   40+ instances.** Six successive attempts to state the neutralisation guarantee were each
   wrong, each written one iteration after the previous was corrected. A "byte-identical"
   claim survived in three of four copies after being reported corrected. A deleted drift
   guard was referenced in the present tense in SEVEN places. A commit that claimed to make
   an enumeration mechanical took it from four copies to six.
2. **An instrument or guard that silently measures less than it claims: 15+ instances**,
   including instruments written to check the claims in (1): a regex matching `===` as
   assignment; a lookahead defeated by backtracking; a key extractor blind to shorthand
   properties; a document-accuracy arm using `match` so it checked one copy of three; an
   arm that drove three of the nine states its title claimed; two count-floors set below
   the true count.

⭐ **The remedy that finally worked was mechanical, not editorial.** Prose discipline failed
repeatedly, so the load-bearing claims are now DERIVED and arm-checked: the pin enumeration
is extracted from the code by right-hand-side kind and cross-checked against four documents
in both directions inside sentinel regions; the category list is checked for ascending,
gap-free numbering, matching items and a word-count that matches its item count; the context
key-set count is derived by scanning status.js; the state/`because` pairings are driven from
`ENUMS.state` and red if a state is added with no pairing.

### Per-Iteration Breakdown

Models strictly alternated opus/sonnet from iteration 1, per kosmos#2032.

#### Iterations 1 to 3 (opus, sonnet, opus) - from the on-disk ledger
**New findings:** 2 BLOCKERs, 18+ WARNINGs, 2 CONVENTIONs, 7+ NITs
**Self-generated:** several; iteration 1 states "several were regressions I introduced"
- [WARNING] `liveCard()` swallowed EVERY error, turning a loud red into a quiet green: on a
  POPULATED box where status.js failed, the fallback took over and the cut PASSED, where
  before this branch it failed 3b --> FIXED (error and empty board now distinct)
- [WARNING] My own false claim excused a real gap: "the quiet box that needs it is the only
  one that cannot check it". `test-support/fleet.js` drives the REAL snapshot() over a fake
  pane source --> FIXED, box-independent arm added
- [BLOCKER] The nested drift guard fired on BOARD COMPOSITION. Measured: 18 pane cards, two
  legitimate `profile` shapes --> REMOVED, with the measurement recorded
- [BLOCKER] `liveCard()` took the first pane card while the capture preferred one with
  evidence, so a cut's red depended on tmux ordering --> moot once the guard went
- [WARNING] Profile neutralisation was list-based while the tree writes absolute paths into
  `profile`; the fixture was clean only by luck of which agent was captured --> FIXED

#### Iterations 4 to 7 (sonnet, opus, sonnet, opus) - counts not recorded
**New findings:** at least 2 BLOCKERs; exact category counts lost to a context compaction
- [BLOCKER] A WARNING triaged away at iteration 3 (the unsandboxed suite) returned as a
  BLOCKER at iteration 4 --> FIXED
- [BLOCKER] `neutralise()` re-pinned `model`/`modelName` from the UNSCRUBBED producer.
  Measured leaking `/Users/realoperator/secret` verbatim into a committed file, and
  unbounded because `readModel()` regex-extracts from the last 64KB of a transcript
  --> FIXED (pinned to constants)
- [WARNING] The same shape one iteration earlier: raw `context` cloned back after the scrub

#### Iteration 8 (sonnet)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
Quiet. **Not converged on:** mutation upgraded one NIT into an unguarded scrub (below).

#### Iteration 9 (opus)
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 0 NITs
**Self-generated:** 1 (the arm that read the artifact rather than the producer)
- [WARNING] Six fields pinned UNCONDITIONALLY, writing a string where the producer wrote
  null; `readModel()` returns `{model: null}` on three paths --> FIXED
- [WARNING] The `require.main === module` guard was pinned by nothing. Measured by removing
  it: the test run overwrote the committed fixture from this box's live board --> FIXED
- [WARNING] `scrubStrings`' comment claimed "nothing identifying can survive"; the guarantee
  is string-only --> FIXED
- [WARNING] A comment claimed an arm tests the producer when it reads the neutralised
  fixture --> FIXED
- [WARNING] The removal pin's escape hatch gated only one of its two assertions, making it a
  BARRIER to the fix the branch says is owed --> FIXED

#### Iterations 10 to 21 (alternating sonnet/opus)
**New findings:** 4 BLOCKERs, 47 WARNINGs, 1 CONVENTION, 28 NITs
**Self-generated:** high; five of the arms added to close a class contained that class
- [BLOCKER] `profile` is free-form, so `profile.doctrineVersion` (a producer NUMBER) reached
  the recording unscrubbed. The invariant sentence one iteration earlier said "there is no
  third category" --> FIXED structurally (`scrubNonStrings` over the whole subtree)
- [BLOCKER] "byte-identical unless the shape moved" was FALSE and survived in three of four
  copies after being reported corrected --> FIXED
- [WARNING] The pin-enumeration arm checked three documents while claiming four (its first
  document was the file it extracted from, so `includes` was true by construction), and
  matched anywhere in the file. While green, the tool's own list named FOUR of 21 pins
  --> FIXED with PIN-LIST sentinels and a both-directions check
- [WARNING] The inventory arm could not descend a null, so it never saw `disruption`, the
  one subtree its own comment cites --> FIXED
- [WARNING] A file-scope safety net sat above the `const` it reads, so it hit the temporal
  dead zone, its `catch` swallowed the ReferenceError, and it disabled itself while looking
  like a working guard --> FIXED (and the fixture it failed to protect was restored twice)
- [WARNING] `context.confidence`/`because` were `example-` strings the producer cannot emit
  --> FIXED (pinned to `measuredResult`'s own siblings)
- [WARNING] The NOTE arm extracted only the FIRST fragment of a concatenated write --> FIXED

#### Iterations 22 to 25 (sonnet, opus, sonnet, opus)
**New findings:** 3 BLOCKERs, 14 WARNINGs, 0 CONVENTIONs, 7 NITs
**Self-generated:** 4 (each blocker was introduced by the immediately preceding fix)
- [BLOCKER] status.js has THREE context result shapes and my fix for two broke the third:
  `noCeilingResult` sets a NUMERIC tokens with `percent: null` and CONFIDENCE.STRUCTURED, so
  a both-numbers predicate wrote `confidence: 'none'` beside a non-null tokens, which the
  producer never emits --> FIXED
- [BLOCKER] The `because` pin covered five of NINE states; `blocked`, `rate_limited` and
  `auth_failed` carried a sentence status.js emits only for UNKNOWN --> FIXED
- [BLOCKER] Nothing would have noticed: the arm for this drove three of nine states, and a
  `blocked` re-capture landed silently green --> FIXED, driven from `ENUMS.state`
- [WARNING] "a paneless card has its own KEY SET" was measurably FALSE: status.js:5883 keeps
  SHAPE PARITY on purpose, and both emit the same 30 top-level keys. That sentence was the
  justification for the top-level-only comparison --> FIXED

#### Iteration 26 (sonnet)
**New findings:** 0 BLOCKERs, 1 WARNING (deduped), 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
Quiet. **Not converged on, and the reason was mechanical:** this iteration changed files, so
the next pass was the first to read the shipped bytes.

#### Iteration 27 (opus)
**New findings:** 1 BLOCKER, 8 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 3
- [BLOCKER] `because` was pinned to "it is mid-task" for EVERY working card, but status.js
  emits that only as `{WORKING, SCRAPED, reported: false}`. A reported working card is
  STRUCTURED, so `chooseCard` PREFERS it: the likeliest capture on a healthy box was one the
  producer cannot emit --> FIXED
- [WARNING] My own tests were a BARRIER to that fix for the second time on this branch: the
  sentence map left `working` and `unknown` as constants, positively certifying two
  contradictions --> FIXED
- [WARNING] Three documents call the "eleven" count derived while the arm asserted `>= 8`
  --> FIXED (exact)
- [WARNING] The category arm's title said "the same in both documents" and it compared how
  MANY, not WHICH --> FIXED

#### Iteration 28 (sonnet)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Duplicates of prior findings (confirmed resolved or deferred):** 3
**Self-generated:** 0
**Converged** - no new actionable findings. Verified it reviewed the SHIPPED bytes: clean
worktree, HEAD == origin/goldencard-2519 == 57d06456, no commit after it was spawned.

### Final Ledger (deferrals and the closing gate)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 3 | BLOCKER | render-talk.js reopen arm | BRANCH | Nested drift guard fires on board composition | DEFERRED | Removed; gap tracked as kosmos#2553 |
| 2 | 17 | CONVENTION | .claude/plans/ | BRANCH | Work began in the shared main checkout | DEFERRED | Self-disclosed, remediated at the time, checkout verified clean |
| 3 | 25 | WARNING | render-talk.js | BRANCH | The check has never been RUN with the recorded card | DEFERRED | Cannot run from here; recorded as a cut note |
| 4 | 28 | BLOCKER | final-validation | BRANCH | 6j failed: tools.release-gate.test.js SIGTERM at 97.8s | FIXED | Load timeout, not the diff: 26/26 in isolation, 5371/5371 on re-run |

### Deferred, with reasons

1. **Nested drift is unguarded.** A rename inside `context` or `profile` leaves `yarn test`
   green while the recording drives `openDetail` with a shape the page no longer consumes.
   `openDetail` reads `context.percent`, so it is not hypothetical. The guard that would
   catch it was built and removed because it redded on real board composition, and a guard
   that reds a cut on composition is worse than no guard. **Tracked as kosmos#2553**, which
   carries the 18-agent measurement, three candidate replacements, and the note that the
   pin's `COMPOSITION-AWARE DRIFT GUARD` escape hatch keeps the fix unlocked.
2. **The branch is at mechanism-built, not behaviour-measured.** Nobody has watched the
   recorded card drive `openDetail` through a real page, because that needs the shared
   browser. Every guard here is static or unit-level. The first cut that runs
   `render-talk.js` on a quiet box is the first observation of the behaviour this fixes.
   Recorded in the README as a cut note rather than only in the plan.
3. **The convention breach is historical.** Work began in the shared main checkout before
   moving to this worktree. Self-reported, remediated, and verified at the time that nothing
   of a colleague's was swept.

### NITs (non-blocking, across all iterations)
- [NIT] The volume of "this claim was wrong N times" narrative in shipped comments is high
  (iteration 28). **Declined, with a reason:** every one of those comments records a defect
  that recurred AFTER being fixed once, several three and four times, and reviewers on this
  branch repeatedly used those exact sentences to catch the next instance.
- [NIT] `hasAvatar` is pinned to `true` even when the producer said `false` (iterations 15,
  21). Deliberate: `Boolean(safeAvatar(key))` depends on whether an avatar file exists on the
  capture box, so recording it faithfully makes the fixture differ between machines.
- [NIT] The gate-word neutralisation covers the four words and not `^\s*(FAIL|✖)`
  (iteration 25). Unreachable with today's single-line throwers; named in the residual list.

### Strengths (across all iterations)
- Record-not-invent: the fixture is a capture from the real producer, and `fixture-discipline`'s
  hand-built-card lint caught this work FOUR times, each time answered by changing the code
  rather than the guard (iterations 1, 9, 17, 19)
- The load-bearing claims are derived from source and arm-checked rather than restated, and
  the derivation arm carries a control on its OWN extractor (iterations 13, 20, 24, 25)
- The I/O guard is proved three ways and cannot itself do the damage it guards: bytes held
  before a child spawn, the child absorbing `process.exit(1)`, plus a file-scope restore net
  (iterations 9, 18)
- The release-gate pattern is READ out of `tools/browser-checks.sh` rather than restated, the
  poison is built from the gate's own alternation, and the interpolated path is driven at
  runtime (iterations 14, 16, 21)
- Error and empty are separated at the right seam, so a broken producer on a populated box
  still reds the cut instead of being masked by the fallback (iteration 1)
