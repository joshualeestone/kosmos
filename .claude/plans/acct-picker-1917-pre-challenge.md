---
pre_challenge: true
method: challenge-loop
branch: acct-picker-1917
diff_hash: f801740bacbfbddf7f16e5969eba67d964f17847322d31462b9b171e31df31f0
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T22:59:54Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (plus the initial + final validation passes)
**Converged:** Yes -- iteration 3, a full blind pass over the reworded branch, returned
zero actionable findings (2 non-required NITs).
**Total findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs (all non-actionable)
**Fixed:** 0 | **Deferred:** 0 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 0 (baseline validation)
Full pre-PR suite against the pre-browser-check HEAD flagged ONE red: the #1720
browser-check gate ("this change touches web/ but updates no docs/browser-checks/
assertion"). node --test was clean (3805 tests, 0 fail). Addressed by adding a real
assertion to docs/browser-checks/render-create-form.js (see below), not an override
trailer.

#### Iteration 1 (fresh blind challenge agent)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT.
- [NIT] web.acct-picker-1917.test.js -- Fix A is verified by source-pin rather than by
  executing the click handler (the picker fix IS executed). The reviewer judged this
  reasonable and explicitly NOT actionable (extracting a DOM event closure embedded in
  paintAccounts is disproportionate). NIT, no change.
- Multiple STRENGTHs confirming: the qualifier is computed over the rendered subset and
  keyed identically to the map; append-not-replace with the qualifier escaped; the
  pinned title untouched; the executing test's control can return the dangerous answer;
  no default/duplicate qualifier collision.

#### Iteration 2 (fresh blind challenge agent, full branch incl. browser-check)
**New findings:** none. "No issues found." Verified the browser-check capture and the
distinctness assertion (not vacuous in the header's sense; tightening-only machine-state
dependence, documented), the qualifier, Fix A wording accuracy ("above" correct; not
misleading for a healthy default), and house rules (no em dash, no DIAG_DEBUG, plan file
present). **Converged.**

#### Iteration 3 (fresh blind pass, after the Disconnect message was reworded)
After iteration 2, the reauth question was CONFIRMED (Ben, via Josh): `Sign in again`
returns a green check but does NOT capture a working credential (tracked as #1922, April).
The Disconnect message was reworded to name it as a step to try and warn that a green
check confirms a sign-in ran, not that it took -- true whether or not the reauth flow
captures. Iteration 3 reviewed the reworded branch: **0 BLOCKERs, 0 WARNINGs, 0
CONVENTIONs, 2 non-required NITs.** Confirmed the message is true/non-misleading
independent of #1922, "above" is accurate, the title stays pinned, and the qualifier +
test + browser-check are sound. **Converged.**
- [NIT] the "check that an agent on it actually connects" phrasing could be marginally
  more concrete; reviewer marked not required. Not changed, to avoid the moving-target
  loop (each copy tweak invites the next reviewer's copy nit).
- [NIT] the browser-check distinctness assertion is trivially unique on a machine with no
  duplicated email; the deterministic coverage is the node test. Self-disclosed in the
  file comment.

### Final validation
Full suite green on HEAD 72065d34 (reworded): node --test 3805 pass / 0 fail / 0 skip;
yarn test:shell all 33 arms pass; #1720 browser-check gate passes; no contention block.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 0 | BLOCKER (synthetic) | tools/lib/browser-check-gate.sh | web/ change lacked a browser-check assertion | FIXED | added distinctness assertion to render-create-form.js |
| 2 | 1 | NIT | web.acct-picker-1917.test.js | Fix A source-pinned not executed | NIT | reviewer judged non-actionable |

### Outstanding questions (ASKED)
None. The reauth (a)/(b) question is now ANSWERED and did not block this branch:
`Sign in again` runs the flow, returns a green check, and does NOT capture a working
credential (confirmed from Ben; tracked as #1922, April; April's fix is one routing line
in server.js:4637 that omits configDir for the default account). The Disconnect remedy is
correct under that answer -- it names the step to try and warns green != captured -- and
stays correct when #1922 is fixed. Recorded on the card.

### NITs
- web.acct-picker-1917.test.js -- Fix A verified by source-pin, not execution (iteration 1).
- web/index.html -- "check that an agent on it actually connects" could be marginally more
  concrete (iteration 3, not required; left as-is to avoid the moving-target loop).
- docs/browser-checks/render-create-form.js -- the distinctness assertion is trivially
  unique on a machine with no duplicated email; node test is the deterministic coverage
  (iteration 3, self-disclosed).

### Strengths (across iterations)
- fillCreateAccounts reuses the Settings list's own accountQualifiers, keyed identically,
  escaped, append-not-replace, empty for a unique email.
- The node test EXECUTES the real extracted code with a control that returns the dangerous
  answer (two same-email accounts, both `connected`, asserted distinct without clicking).
- Fix A appends the remedy to the spoken message only; the engine-pinned title is untouched
  and the test guards both directions.
- The browser-check assertion reads the live <select> option text (a claim a source test
  cannot make) and is non-vacuous with an empty-case control already present.

### Coordination note
Angel (#1916, liveness) confirmed no file overlap (their work is engine/create.js +
server.js only), so no merge-order dependency. #1897's wider scope (three installs, zero
tokens = the default outcome) is recorded on PR #1913, separate from this branch.
