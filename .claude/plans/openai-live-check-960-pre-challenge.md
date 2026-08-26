---
pre_challenge: true
method: challenge-loop
branch: openai-live-check-960
diff_hash: f1cf667b41c9a1d84f681f955f9c6586dfcedff1ba243f2af9d0da360c1b9d97
subdir_audit: passed
timestamp: 2026-08-26T10:47:05Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4: zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 12 across 4 iterations (0 BLOCKERs, 5 WARNINGs, 3 NITs; STRENGTHs each round)
**Fixed:** 6 | **Deferred with reasoning:** 4

This closes kosmos#960: the OpenAI row's Connected badge was hardcoded/unconditional
markup, exactly the class of defect PR #881/#959 already fixed for the Claude/Anthropic
provider, filed by Josh the moment #959 shipped and made the contrast between the two
providers visible. Four rounds of review consistently probed the same real axis (the
NONE/UNKNOWN three-state asymmetry, applied to a brand-new external API integration)
and found genuine, escalating refinements each time -- iteration 2 in particular caught
a real false-negative risk (a legitimately scoped/restricted OpenAI key answering
401/403 for a permissions reason, not a revoked-key reason) that would have quietly
excluded working accounts from the create-agent dialog.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 WARNING, 3 NITs, 3 STRENGTHs
- [WARNING] `checkLive()`'s `!who` branch collapsed "no auth.json at all" (a genuine NONE)
  and "auth.json exists but is corrupted/unparseable" (should be UNKNOWN) into the same
  NONE -- the exact asymmetry this module's own header rules against, and untested.
  --> FIXED: new shared `readAuthFile(dir)` helper (`{kind: 'absent'|'unreadable'|'ok'}`)
  used by both `identityOf()` and `checkLive()`, plus two new regression tests, verified
  to fail without the fix.
- [NIT] `checkLive()` re-read and re-parsed `auth.json` a second time (duplicating
  `identityOf()`'s own read) just to extract the raw key. --> Folded into the
  `readAuthFile()` fix above: the key is now read from the same parsed data.
- [NIT] Test assertions used raw string literals ('connected'/'none'/'unknown') instead
  of `subscription.STATE.X`, diverging from the codebase's established enum convention.
  --> FIXED across `engine/openaiaccounts.test.js` and `server.connect.test.js`.
- [NIT] `listLive()`'s `module.exports.checkLive` self-reference (needed so a test can
  monkey-patch it) is a different testing idiom than this file's other seams
  (`setFetcher`). --> DEFERRED: correctly justified, working, and disciplined about
  restoring the original in the one test that uses it.

Own catch, found while fixing the above: the network-unreachable `because` sentence
originally concatenated the raw `err.message` (e.g. "ENOTFOUND") into the user-facing
text -- caught by this branch's own new test before it ever shipped, not by review.
--> FIXED alongside the WARNING above.

#### Iteration 2
**New findings:** 2 WARNINGs, 1 NIT, 3 STRENGTHs
- [WARNING] Any 401/403 from OpenAI was treated as a confirmed "key is bad" (NONE) --
  but a legitimately scoped/restricted OpenAI project key can also answer 401/403 for a
  *permissions* reason (e.g. lacking `models.read` scope) while remaining fully valid for
  what an agent actually does with it. A false NONE here would silently exclude a working
  account from `fillCreateAccounts()`'s list. --> FIXED: only OpenAI's own
  `invalid_api_key` error code now counts as a positive NONE; any other 401/403 shape is
  UNKNOWN. Four tests updated/added to cover both the positive case (with the code) and
  the new UNKNOWN cases (without it, and with no body at all), each verified against the
  reverted code to confirm they actually catch the regression.
- [WARNING] `checkLive()` still called `identityOf(dir)`, which internally re-read and
  re-parsed the SAME file `readAuthFile()` had already read -- redundant I/O and a narrow
  TOCTOU (the file could change between the two reads). --> FIXED: extracted a pure
  `identityFromData(parsed)` helper with no I/O; `identityOf()` and `checkLive()` both use
  it against data each already has, so the file is read exactly once per check.
- [NIT] The default fetcher's response body was parsed but effectively unused (until the
  WARNING above started using it). --> Resolved as a side effect of the 401/403 fix.

#### Iteration 3
**New findings:** 0 BLOCKER, 1 WARNING, 1 NIT, 5 STRENGTHs
- [WARNING] Whether `invalid_api_key` is the ONLY OpenAI error code that should confirm a
  dead key (vs. an expired key, an account suspension, possibly a different/absent code).
  Explicitly unverifiable from this machine (no suspended account to test against) and
  explicitly the SAFE direction per this module's own rule (a real gap here costs an
  honest "we could not tell," not a false Connected). --> DEFERRED, documented in the
  plan file's own new section rather than guessed at; a follow-up issue if it ever proves
  out in practice.
- [NIT] `askModels()`'s real production fetcher path (the actual `fetch`/timeout branch,
  not the test seam) has no direct test. Confirmed this matches an identical, pre-existing
  convention in the established sibling module `tokendoor.js`. --> DEFERRED, left
  consistent with that convention rather than fixed in isolation.

#### Iteration 4
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 5 STRENGTHs

**CONVERGED.** This round deliberately looked away from the NONE/UNKNOWN axis three
prior rounds had focused on -- the credential-handling path end to end, `listLive()`'s
parallelism/isolation code, the actual rendered HTML output of all three web/index.html
call sites (escaping, aria attributes, cross-provider rendering on one page), and the
git history's coherence with the plan file -- and found nothing new. Ran the full suite
directly rather than trusting prior rounds' reports (51/51 relevant tests, full suite
exit 0).

### Final Ledger (condensed -- full detail in the per-iteration breakdown above)

| # | Iter | Category | Area | Status |
|---|------|----------|------|--------|
| 1 | 1 | WARNING | absent-vs-unreadable NONE/UNKNOWN collapse | FIXED |
| 2-4 | 1 | NIT | duplicate read, raw-string state assertions, self-ref idiom | FIXED (2) / deferred (1) |
| 5-6 | 2 | WARNING | 401/403 permission-scoping false negative, duplicate `identityOf()` read | FIXED |
| 7 | 2 | NIT | unused response body | resolved as a side effect |
| 8 | 3 | WARNING | other possible OpenAI error codes (unverifiable) | DEFERRED (documented) |
| 9 | 3 | NIT | untested real-fetch branch (matches sibling convention) | DEFERRED |
| -- | 4 | (none) | -- | CONVERGED |

### Deferred, with reasoning (none blocking)

- Whether other OpenAI error codes beyond `invalid_api_key` should also confirm a dead
  key: unverifiable from this machine, and the current behavior already errs in this
  module's own stated-safe direction (UNKNOWN over a guessed NONE). See the plan file's
  own "Deferred" section.
- `askModels()`'s real fetcher branch has no direct test: matches the identical,
  pre-existing convention in `engine/tokendoor.js`, not a gap introduced by this diff.
- `listLive()`'s `module.exports.checkLive` self-reference test idiom: correctly justified
  (this module has no separate consumer module the way `accounts.js`/`subscription.js`
  do), working, and disciplined in its one test's cleanup.

### Strengths (recurring across iterations, not restated per-round above)

- The three-state asymmetry (CONNECTED/NONE/UNKNOWN) is applied correctly and
  independently re-verified across every real branch of `checkLive()` by all four rounds:
  no file, unreadable file, unrecognized shape, non-apikey mode, unreadable key, network
  failure, unexpected status, and now the 401/403-without-`invalid_api_key` case -- every
  UNKNOWN/NONE path carries a hand-written, non-leaking `because` sentence.
- Credential handling verified end to end, repeatedly: the raw key is read once, sent only
  as the `Authorization: Bearer` header value to OpenAI's own endpoint, never logged,
  never in a `because` sentence, never echoed back -- and the chatgpt-mode branch never
  even attempts a network call, proven by a dedicated test.
- All three `web/index.html` call sites this diff touches were correctly generalized from
  their Claude-only #881 shape to a provider-agnostic one, with a fourth (`paintAccountPicker()`)
  correctly identified as genuinely out of scope rather than missed -- and every test that
  guards this asserts the OLD bypass pattern is GONE (`assert.doesNotMatch`), not just that
  the new pattern is present.
- Every non-trivial fix in this branch has a regression test verified (by deliberately
  reverting the fix and confirming red, then restoring it) to actually fail without the
  corresponding code, not just tests that happen to pass.

### Full suite

`bash tools/run-tests.sh`: 0 failures throughout every iteration's final check.
`node --test engine/openaiaccounts.test.js`: 18/18. Full relevant-file run (engine +
server + web tests for this feature): 51/51.
