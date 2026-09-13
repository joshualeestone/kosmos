---
pre_challenge: true
method: challenge-loop
branch: config-sandbox-negctl-1143
diff_hash: f8a7a402c24ecb907aac1fbd082a97e3ca254ef08babdef5f2568cc817209064
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T16:55:04Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 5 (0 BLOCKERs, 1 WARNING, 3 CONVENTIONs/NITs, 1 validation-gate BLOCKER)
**Fixed:** 3 | **Deferred:** 2 | **Asked:** 0

The change adds two negative controls to `docs/browser-checks/render-accounts-openai.js`
(kosmos#1143): the account-list assertions were all open-world, so a regressed config
sandbox that leaked the operator's real Claude accounts as extra rows would pass every
one silently. The controls assert (a) no rendered email token lacks the substring
`@example.com`, and (b) the non-OpenAI group holds exactly the two seeded fixtures.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs
**Self-generated:** 3 of the above (all cite lines this branch's own commit d49f7135f added)
- [WARNING] render-accounts-openai.js:181 — foreign-email extraction used a `$`-anchored
  `/@example.com$/` suffix; the email `<b>` is followed by qualTag/keyTail/org inline with
  no separating text node (web/index.html), so a future fixture with a qualifier/keyTail
  could render an email with adjacent text and no whitespace, over-consume the domain, and
  false-positive a legit fixture account. --> FIXED (commit 77eeca8): switched to a
  contains-check on `@example.com` (adjacency-robust; a real-domain leak has no such
  substring).
- [NIT] render-accounts-openai.js:1-27 — the top-of-file "What it asserts" docstring did
  not mention the new control class. --> FIXED (commit 77eeca8): added a line.
- [NIT] render-accounts-openai.js:182,195 — `example.com` / the count-of-2 are inline
  literals not named constants. --> DEFERRED: the file inlines all fixture literals with no
  constants anywhere; lone constants would be a new deviation, not a fix (the reviewer
  itself noted it is consistent with the file's established style).

#### Iteration 1 validation (6g)
**New findings:** 1 gate BLOCKER
**Self-generated:** 1 (the offending line was added by commit 77eeca8)
- [BLOCKER] final/6g-validation: no-brand-refs-1881 failed — the iteration-1 comment
  illustrated a leaked domain with "book.io, gmail.com"; the tracked-tree brand guard reds
  on "book.io". --> FIXED (commit 8cb617b): rephrased to a generic domain, no brand. The
  plan file's josh@book.io stays (`.claude/plans/` is exempt from the guard by design).

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 NIT
**Self-generated:** 1 (cites the contains-check line from commit 77eeca8)
**Duplicates of prior findings (confirmed resolved):** 0
- [NIT] render-accounts-openai.js:196 — residual false-negative: a leaked domain that
  BEGINS with `example.com` (e.g. `bob@example.community`) contains `@example.com` and would
  slip the email control. --> DEFERRED: not a real operator domain; the count control
  backstops any Claude-group leak regardless of domain; only an OpenAI-group leak carrying
  such a crafted domain evades both, which the plan documents as unreachable. Closing it
  precisely (exact-domain match) would reintroduce iteration 1's adjacency false-positive on
  the actual fixture, so the contains-check is the deliberate tradeoff.

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 NIT (duplicate of iteration 2)
**Self-generated:** 0 acted on as SELF (the one NIT deduplicated against iteration 2's DEFERRED entry)
**Duplicates of prior findings (confirmed resolved / deferred):** 1
- [NIT] render-accounts-openai.js:197 — same `example.com`-prefix residual as iteration 2.
  --> deduplicated against iteration 2's DEFERRED entry; skipped.
**Converged** — no new actionable findings; three independent STRENGTHs verifying comment
accuracy against source, retry-safety, and the provider filter.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | render-accounts-openai.js:181 | SELF | `$`-anchored email suffix over-consumes on adjacent text | FIXED | 77eeca8 (contains-check) |
| 2 | 1 | NIT | render-accounts-openai.js:1-27 | SELF | docstring omits the new control class | FIXED | 77eeca8 |
| 3 | 1 | NIT | render-accounts-openai.js:182 | SELF | inline literals not named constants | DEFERRED | consistent with file's inline-literal style |
| 4 | 1(6g) | BLOCKER | render-accounts-openai.js:191 | SELF | brand ref "book.io" in comment (no-brand-refs #1881) | FIXED | 8cb617b |
| 5 | 2 | NIT | render-accounts-openai.js:196 | SELF | `example.com`-prefix domain evades contains-check | DEFERRED | not a real domain; backstopped by count control; tightening reintroduces adjacency false-positive |

### NITs (non-blocking)
- Inline fixture literals not extracted to constants (consistent with the whole file).
- `example.com`-prefix crafted-domain residual in the email control (backstopped by the count control; unreachable for real operator domains).

### Strengths (across all iterations)
- The two controls are complementary and non-vacuous: the email control is group-agnostic; the count control catches an email-less leak into the Claude group. Proven to fail (perturbing a leaked account reddened both, exit 1, on both retry attempts).
- Retry-safe by construction: both key on the Claude side, which the walk never adds to.
- Comment claims verified accurate against `engine/status.js` (`sandboxIsInconsistent`) and `tools/browser-checks.sh` (sb4 seeding), and the `!/OpenAI/` provider filter matches `web/index.html`.
- The `contains`-vs-`$`-anchor rationale is documented and matches the `.acct-who` markup adjacency.
