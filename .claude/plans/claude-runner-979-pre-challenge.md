---
pre_challenge: true
method: challenge-loop
branch: claude-runner-979
diff_hash: e5bf4c4f87178fb5a7c0cf22636bad10076ecd8bec12dc6d3bc4fb802c8b25cd
subdir_audit: passed
timestamp: 2026-08-26T20:59:04Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. **Stopped deliberately at the churn line**, and the reasoning is below rather
than hidden, because "converged" would have been the flattering word and it is not the true one.

### Why it stopped here rather than at a clean pass

The rule I applied, set from a previous branch where I ran twelve rounds and every round from
three onward found its worst defect inside the previous round's fix:

> **If the last two rounds mostly found problems in code that did not exist before the review
> started, the loop has stopped reviewing the work and started reviewing itself.**

By that test this branch is at the line:

- **Round 7's** BLOCKER was in round 6's fix (a comment recording an edit that never wrote).
- **Round 8's** two BLOCKERs were both in comments I wrote during rounds 6 and 7.
- Neither round found anything wrong with the design or the shipped behaviour.

⚠️ Each further round is a fresh chance to break something that works. So this stops, and what is
unproven is written down instead of ground away.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] engine/runners.js - shell-injection surface: URL/log/script interpolated into `sh -c` --> FIXED (positional args)
- [WARNING] engine/runners.js - `curl | sh` without pipefail reports curl's failure as sh's success over an empty script --> FIXED (sequenced)
- [WARNING] engine/runners.js - a launchd board's stock PATH hides Homebrew/npm-global installs from `which` --> FIXED (explicit rungs)
- [WARNING] engine/runners.js - present meant EXISTS, so a directory at a runner path vouched for a runner that cannot start (#133) --> FIXED (isRunnable)
- [CONVENTION] engine/runners.js - the status/job contract was undocumented --> FIXED

#### Iteration 2
**New findings:** 2 BLOCKERs, 3 WARNINGs
- [BLOCKER] engine/runners.js - executes remotely-fetched bytes with NO integrity check, while `engine/connect.js` installs the SAME product against a published per-platform SHA256 --> FIXED (delegate, then removed entirely in iter 3)
- [BLOCKER] engine/runners.js - `curl -fsSL` follows redirects with no protocol floor, so https can silently become http --> FIXED (mechanism removed)
- [WARNING] engine/runners.js - `AGENT_WORKFORCE_CLAUDE_INSTALL_URL` repoints the URL whose bytes are EXECUTED --> FIXED (retired)
- [WARNING] engine/runners.js - unconditional `rmSync(force)` deletes a vendor-owned file, and throws a raw ERR_FS_EISDIR on a directory --> FIXED (clearForLink)
- [WARNING] engine/runners.js - findElsewhere keyed on real HOME while resolveBin honoured the sandbox seam --> FIXED (homeDir)

#### Iteration 3
**New findings:** 2 BLOCKERs, 7 WARNINGs
- [BLOCKER] engine/runners.js - no `track` handle, so `connect.cancel()` aborts a runner download it knows nothing about, and vice versa --> FIXED (download removed to #997)
- [BLOCKER] engine/runners.js - a Connect flow and a runner install share `store.ROOT/downloads` with no mutual exclusion; either can delete the other's verified binary --> FIXED (download removed to #997)
- [WARNING] engine/runners.js - the ~281MB download is never removed --> FIXED (removed with the branch)
- [WARNING] engine/runners.js - `execFileSync` runs inside the HTTP handler --> FIXED (async, iter 5)
- [WARNING] engine/runners.js - the child lacked TERM=dumb, maxBuffer and a cancellable handle that connect.js's `run()` gives it --> FIXED (removed to #997)
- [WARNING] engine/runners.test.js - every test seams the delegation out, so the branch's central claim is exercised by nothing --> FIXED
- [WARNING] engine/create.js - the new default arm is covered by nothing; every suite passes claudeBin explicitly --> FIXED (direct assertion)
- [WARNING] tools/browser-checks.sh - sandbox 4 sets AGENT_WORKFORCE_HOME but not the claude bin, so it reached the operator's real Claude --> FIXED
- [CONVENTION] engine/connect.js, engine/subscription.js - two more copies of claudeBinPath disagreeing on the seam --> FIXED

#### Iteration 4
**New findings:** 0 BLOCKERs, 9 WARNINGs, 2 CONVENTIONs
- [WARNING] engine/runners.js - `await Promise.resolve()` does not unblock the event loop; the board is frozen exactly as long --> FIXED in iter 5 (this round's fix was itself wrong)
- [WARNING] engine/runners.js - `vendor-verified` is published over the API and promises a trust property this branch does not deliver --> FIXED (renamed vendor-external)
- [WARNING] engine/runners.js - the module header, installVendor's JSDoc and the plan all describe a mechanism iteration 3 deleted --> FIXED
- [WARNING] engine/runners.js - `job.linked` outlives the link it names after a failed-prove teardown --> FIXED
- [WARNING] engine/runners.js - the override refusal says "does not exist" while present now means runnable --> FIXED
- [WARNING] engine/runners.test.js - a test name claims more than its assertions check, and its fixture supplies the premise --> FIXED
- [WARNING] engine/runners.test.js - the link-teardown test passes on a link that was never made --> FIXED (pinned to the prove branch)
- [WARNING] tools/browser-checks.sh - the fake claude has no `auth status` arm, which subscription.js now reaches --> FIXED
- [CONVENTION] engine/runners.js - the null-not-missing rule is broken by two shapes in the same file --> FIXED (blankJob)

#### Iteration 5
**New findings:** 0 BLOCKERs, 6 WARNINGs, 3 NITs
- [WARNING] engine/runners.js - the iteration-4 fix was a MICROTASK, drained before the event loop returns; the freeze was unchanged and the comment asserted the opposite --> FIXED (async execFile)
- [WARNING] tools/browser-checks.sh - the stub answers snake_case where the parser reads camelCase, and exits 0 where the real command exits 1 --> FIXED (captured shape)
- [WARNING] engine/runners.js - "both branches key on homeDir()" is false; openai goes through managedRoot --> FIXED
- [WARNING] engine/runners.js - "the screens branch on this" is present tense for a consumer that does not exist --> FIXED
- [WARNING] engine/runners.test.js - the network guard passes by construction --> FIXED (pinned by `because`)
- [WARNING] engine/runners.js - mkdirSync and symlinkSync can still hand a person a raw errno --> FIXED
- [NIT] engine/runners.js - `downloadBytes` relies on every entry spelling the key by hand --> FIXED (`?? null`)

#### Iteration 6
**New findings:** 0 BLOCKERs, 3 WARNINGs, 4 NITs
- [WARNING] engine/runners.js - an errno reaches a person from the one clearForLink arm with no test, and it drops the finding --> FIXED
- [WARNING] engine/runners.js - the refusal says Kosmos cannot download Claude Code, which is false of the product: the sign-in flow does --> FIXED
- [WARNING] engine/runners.js - the MEASURED comment misattributes the synchronous cost to statSync --> FIXED
- [WARNING] engine/runners.js - the MANIFEST heading still says "the pinned artifacts" after a kind with no pin was added --> FIXED
- [NIT] engine/runners.js - the override refusal never names the variable a person must unset --> FIXED
- **Found by the new route test rather than a reviewer:** the pre-job refusal arms omitted receivedBytes/totalBytes while every real job spells them null --> FIXED (`refuse()` helper)

#### Iteration 7
**New findings:** 1 BLOCKER, 4 WARNINGs, 5 NITs
- [BLOCKER] engine/runners.js - the MEASURED comment is still false and THIS PLAN recorded it as fixed; the edit was batched with a failing assertion so the write never happened --> FIXED, and re-grepped to confirm
- [WARNING] engine/runners.js - `version` and `linked` are undefined in two arms and null in a third, for the same provider --> FIXED (blankJob everywhere)
- [WARNING] engine/runners.js - the refusal re-derives the env var name the resolver exists to carry --> FIXED (`envName` on the resolver)
- [WARNING] engine/connect.js - the HOME rationale misdescribes what the old code did --> FIXED
- [NIT] engine/runners.js - the canonical rung hardcodes 'claude' while its sibling reads MANIFEST --> FIXED

#### Iteration 8 (plus one post-review correction, below)
**New findings:** 2 BLOCKERs, 3 WARNINGs, 3 NITs
- [BLOCKER] engine/runners.js - the job-shape docblock still carves out "the tarball job has no linked, the synthetic has no version"; blankJob is spread into both, and this branch's own test asserts the second --> FIXED
- [BLOCKER] engine/runners.js - "NO version field at all" was true of main and falsified by this branch --> FIXED
- [WARNING] engine/runners.js - `proved` is the surviving fifth spelling of an absence on the same route --> FIXED
- [WARNING] engine/runners.js - the MEASURED figures are impossible: the spawn cannot cost more than the whole synchronous return it sits inside --> FIXED (figures removed, ordering stated)
- [WARNING] engine/runners.js - a raw child-process error reaches a person from the one prove arm without a guard --> FIXED
- [STRENGTH] - the link-teardown test asserts presence before absence and pins the failure to the prove branch
- [STRENGTH] - clearForLink refuses a path it did not write instead of rmSync(force), and the test asserts the file's CONTENTS survive
- [STRENGTH] - the consolidation is production-identical for all four callers, verified against main rather than assumed

### ⚠️ What is NOT proven, stated rather than ground away

1. **The default `findElsewhere` is exercised by no test.** It probes absolute machine paths and
   then `which claude`, which on any machine with Claude installed answers with the operator's
   REAL binary. A sandboxed test would link the sandbox at the live install. **I wrote that
   warning down and then walked into it anyway** in a route test, which returned HTTP 200 instead
   of the expected refusal and announced itself. The shipped route test goes through the
   override-refusal arm, which cannot reach outside the sandbox. The honest fix is a
   candidate-roots seam; it is not worth doing inside a branch about something else.
2. **The real `prove` is never run.** Every case injects one, so the person-facing sentence is
   pinned by SHAPE (no errno, names the act that happened) rather than by the true message.

### Strengths worth keeping

- `clearForLink` replaced an unconditional `rmSync(force)` with a symlink-only replacement and a
  by-name refusal, and its test asserts the untouched file's **contents** survive, not merely that
  the job failed.
- The link-teardown test asserts the link is present **before** proving it gone, and pins the
  failure to the prove branch, so "it was removed" cannot pass on a link never made.
- Both #133 tests run their positive control **first**, so "absent" is a verdict about the mode
  bits rather than about a path that could never read present.
- `tools/browser-checks.sh` sandbox 4 was genuinely reaching the operator's real Claude before
  this branch; it is sealed with a stub whose `auth status` arm is a capture (camelCase
  `loggedIn`, exit 1) rather than a plausible guess.


### Post-review correction (after the loop stopped, and worth recording as such)

Not a review finding: a naming decision settled in the channel after this branch's loop had
already stopped. Recorded here because it changed shipped code and the hash above covers it.

- [WARNING] engine/runners.js - `MANIFEST.openai.name` was literally `'OpenAI runner'`, and it
  flows into six person-facing sentences via `${m.name}`. **"Runner" is our word**: it appears
  nowhere OpenAI publishes, so a person who reads it and searches finds nothing, and a person who
  later watches `Codex` download has no way to connect the two. Same class of noun as `tmux`,
  which this codebase has two rulings against --> FIXED (`"OpenAI's Codex"`), plus the word
  removed from a refusal describing a folder, with an assertion that fails if it returns.

⚠️ **I proposed "OpenAI's runner" in that discussion, one hour after carding the tmux version of
the same defect.** Mona Lisa's deciding argument is the one worth keeping: *a name that can go
wrong loudly beats a name that stays true forever while quietly meaning something else.* That is
the shape of nearly everything that cost time today.
