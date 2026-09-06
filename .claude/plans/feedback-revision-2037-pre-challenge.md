---
pre_challenge: true
method: challenge-loop
branch: feedback-revision-2037
diff_hash: 28143f4426e205595ba975796050468b0da2a63bc81b1dca4b457fddd932f332
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T00:57:19Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 8 (0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs)
**Fixed:** 5 | **Deferred:** 3 (documented backstop residuals + a verified-safe tradeoff) | **Asked:** 0

Card: kosmos#2037 (report revision). Scope: engine/roles.js PM daily-feedback
prompt -> 3-question structured prompt + explicit no-identifiers rule (PM-scoped,
per Josh's recorded #2037 single-author design); engine/feedbacksend.scrub()
extended beyond home paths to redact this install's identifying names (agent
names via profile display name + on-disk key + worker folder, project names, OS
account name) as a BACKSTOP, with the prompt rule as the primary defence.

### Validation note

The comprehensive full node suite is run on **CI** (GitHub Actions, off-box): the
local machine was reserved for Baron's 0.6.37 release (`run-tests.sh` refuses to
share the box during a release, to avoid corrupting both results). Locally
verified green on the final HEAD: engine/feedbacksend.test.js (35 tests, the only
runtime exerciser of scrub()), roles.feedback-2037b.test.js (2), and the pre-fix
full suite (4752/0). Other tests that reference feedbacksend were checked to be
static-source or web assertions unaffected by the scrub change, and they sandbox
AGENT_WORKFORCE_WORKERS so none reads the real workers dir.

### Per-Iteration Breakdown

#### Iteration 1 (blind review, scrub attacked hard)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs.
- [WARNING] feedbacksend.js — `\b` fires only at ASCII word chars, so a
  Cyrillic/CJK/accented or punctuation-bordered name leaked both edges -->
  FIXED (b06f7ca9): Unicode-aware lookarounds `(?<![\p{L}\p{N}_]) ... (?![\p{L}\p{N}_])` + `u`.
- [WARNING] feedbacksend.js — agent enumeration missed an agent with only a
  worker folder (no profile) --> FIXED (b06f7ca9): also enumerate
  create.WORKERS_DIR. (Live tmux-only agents left to the prompt rule -- a send
  path must not depend on tmux.)
- [WARNING] feedbacksend.js — NAME_MINLEN=4 exempts short names --> DEFERRED
  (documented): lowering to 3 or per-word would gut common words; the prompt
  rule is the primary defence.
- [NIT] test isolation -- profiles/projects persisted across tests --> FIXED
  (b06f7ca9): fresh() resets profiles/projects/workers; AGENT_WORKFORCE_WORKERS
  sandboxed.
- [CONVENTION] coverage gaps --> FIXED (b06f7ca9): added unicode/punctuation
  name, regex-metacharacter escaping, malformed-profile throw-safety, and
  worker-folder-only agent tests.

#### Iteration 2 (blind review, scrub attacked again)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 NITs -- all deduplicate to deliberate
deferrals; no new actionable code defect.
- [WARNING] NAME_MINLEN short-name gap -- DUPLICATE of iteration 1's deferral.
- [WARNING] multi-word fragment ("Kitty" from "Ice Cream Kitty") + digit-adjacent
  ("Flimwaddle2") --> DEFERRED (documented f533f5a5): inherent to whole-name
  matching, chosen to avoid over-redacting "Ice"/"Cream" or breaking digit
  boundaries.
- [NIT] whitespace / Unicode-normalization variants of a stored name --> DEFERRED
  (documented f533f5a5): rare-variant leak; widening trades it for gutting common
  text.
- [NIT] require('./create') load cost --> DEFERRED: the reviewer verified no
  cycle, a lazy WORKERS_DIR getter, no throw, and server.js already loads create;
  an accepted single-source tradeoff (the comment justifies it).
**Converged** -- the doc-only clarification (f533f5a5) names these residuals in
the code; no behavior changed, so no re-review is owed.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | feedbacksend.js | `\b` leaks non-ASCII/punctuation-bordered names | FIXED | b06f7ca9 (Unicode lookarounds) |
| 2 | 1 | WARNING | feedbacksend.js | profile-only enumeration misses folder-only agents | FIXED | b06f7ca9 (WORKERS_DIR) |
| 3 | 1 | WARNING | feedbacksend.js | NAME_MINLEN exempts short names | DEFERRED | prompt rule primary; documented |
| 4 | 1 | NIT | feedbacksend.test.js | tests not isolated | FIXED | b06f7ca9 (fresh() + WORKERS sandbox) |
| 5 | 1 | CONVENTION | feedbacksend.test.js | coverage gaps | FIXED | b06f7ca9 (4 new tests) |
| 6 | 2 | WARNING | feedbacksend.js | multi-word fragment / digit-adjacent | DEFERRED | whole-name matching by design; documented |
| 7 | 2 | NIT | feedbacksend.js | whitespace / NFC variants | DEFERRED | rare-variant; documented |
| 8 | 2 | NIT | feedbacksend.js | require('./create') load cost | DEFERRED | verified safe; single-source tradeoff |

### Strengths (across all iterations)
- scrub()/installNames() are throw-safe: every I/O source individually wrapped;
  the metachar escape set is valid under the `u` flag (no "Invalid escape"); no
  ReDoS (purely literal patterns); longest-first prevents fragment pre-emption.
- Unicode-aware boundaries close the real `\b` leak, redact whole names, and
  refuse interior matches; the name arm runs after the path arms and cannot
  re-corrupt a `~`-rewritten path.
- Tests are discriminating (the unicode test fails under old `\b`; the metachar
  test fails without escaping; the plist-authoritative/fail-soft controls can
  return the dangerous answer) and isolated.
- The prompt carries the 3 questions + the explicit no-identifiers rule,
  PM-scoped (negative sweep + positive control), no em dashes.
