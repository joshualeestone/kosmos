---
pre_challenge: true
method: challenge-loop
branch: requestpreview-6065
diff_hash: 6da5fb9380af1fe0e52baab6499b45c70512acd5197e56d380b42c46a1dba953
validation: passed (Mortals, full suite, clean entry for hash 6da5fb9380af; merge onto current main checked locally, the 82 messages-engine suites and guards 1967/1967)
subdir_audit: passed
timestamp: 2026-10-14T21:46:37Z
iterations: 16
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 16
**Converged:** Yes (iteration 16: its one warning is the plan's recorded room-level gap; nits)
**Total actionable findings:** 0 BLOCKERs, 30 WARNINGs, 2 CONVENTIONs (plus NITs)
**Fixed:** 26 | **Deferred:** 6 | **Asked (awaiting user):** 0

Reviewer models alternated: odd iterations opus, even iterations sonnet. Rounds 4 to 7 churned on a greeting rule
added in round 4; round 7 ended it by removing the rule.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] requestIn matched mentions differently from the room (empty or one-letter keys, ambiguity) --> FIXED (only when the room counted the member)
- [WARNING] a ? inside a link counted as a question --> FIXED
- [WARNING] a first mention already in the head hid a later one --> FIXED
- [WARNING] head comparison not whitespace-collapsed --> FIXED
- [WARNING] no test for display name, question fallback or the DM path --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] a post could close the request's quotes or open a bracket --> FIXED (unquotable)
- [WARNING] dead line-break branch (cleaned text has none) --> FIXED (removed, comment says why)
- [WARNING] two mention matchers that could drift --> FIXED (mentionedMembers records namedAt; one definition)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] a request in a run-on first sentence was skipped as already shown --> FIXED (skip only if it ENDS in the head)
- [WARNING] the 300-char cap could cut off the mention --> FIXED (window of 100 chars before it)
- NITs: more quote look-alikes; comments

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] a greeting mention quoted no request --> FIXED (greeting rule; later removed in 7)

#### Iteration 5
**Reviewer model:** opus
- [WARNING] a greeting in the head hid the request after it --> FIXED (then removed in 7)
- [WARNING] the greeting rule fired on a thank-you --> FIXED (then removed in 7)

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] "It asks you" claimed a request for a thank-you or a sign-off --> FIXED (label: Where it names you)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] the greeting rule still quoted unrelated text --> FIXED structurally (rule removed)

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] "Its first question" was not always the first --> FIXED (label: A question in it)

#### Iteration 9
**Reviewer model:** opus
- [WARNING] a long question ending in a link collapsed to a bare ? --> FIXED (cut by character)
- [WARNING] a question was quoted to background members (unaddressed steering) --> FIXED (only for readers the post is to)

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] operator whole-room posts and reply authors got no question --> FIXED (the union of the answer line and the hold)

#### Iteration 11
**Reviewer model:** opus
- [WARNING] the reply-author arm was untested --> FIXED (measured: removing it fails)

#### Iteration 12
**Reviewer model:** sonnet
- [WARNING] a question ending in a closing quote or bracket was skipped --> FIXED
- [WARNING] the request was added after the spill decision, not re-measured --> FIXED (fitOrBare)

#### Iteration 13
**Reviewer model:** opus
- [WARNING] start and end of a sentence used different rules --> FIXED (one definition, the head's abbreviation rule)
- [WARNING] the re-measure was untested --> FIXED (fitOrBare on both arms)

#### Iteration 14
**Reviewer model:** sonnet
- [WARNING] a filename, domain, version or ellipsis did not end a sentence --> FIXED (stricter abbreviation rule)

#### Iteration 15
**Reviewer model:** opus
- [WARNING] an abbreviation opened by a bracket or quote cut a sentence --> FIXED
- [WARNING] no room-level test reaches fitOrBare's bare arm --> DEFERRED (recorded: needs a near-limit held-posts clause)

#### Iteration 16
**Reviewer model:** sonnet
**New findings:** 0 actionable (its warning restates the recorded room-level gap; nits)
**Converged:** no new actionable findings.

### Evidence outside the loop
- 82 messages-engine suites and guards 1965/1965 on the branch; mutations measured: no namedAt, no request clause, no display-name lookup, no reply arm, an off-by-one in namedAt each fail a test.
- Mortals full validation passed for hash 6da5fb9380af. Merge onto origin/main at 16:36 CDT: clean (main had changed engine/messages.js; auto-merged), 1967/1967 on the merge.
- Renet confirmed read-only on main: no runner-specific cut in Kosmos.

### Outstanding questions
None for the code. Weakest premise (in the plan): a request with neither an @-mention nor a ? gets no request clause.
