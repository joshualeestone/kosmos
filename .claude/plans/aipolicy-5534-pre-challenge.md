---
pre_challenge: true
method: challenge-loop
branch: aipolicy-5534
diff_hash: e31e7893b5b0bedf59d293711c2cc6f01afe01a080092bba8af7c8591d78359f
validation: passed (rebased on origin/main after slice 2 (#5730) and #5731 merged; engine/policy-company-5534 (5 tests incl. marker injection), engine/policy, server.policy-refresh-5534 (a real board boot), engine/create (incl. the new birth case), orgpolicy-5534, orgpolicy-apply-5534, orgrollup-5532, server.connections-refresh-1649, plus the reachable, 4796 sandbox, brand, name, fixture-discipline and Windows guards: 388 tests, 0 fail; red by mutation: the boot sweep, the create step, the effective list, the size cap with the company entry)
subdir_audit: passed
timestamp: 2026-10-10T00:10:08Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, sonnet; each blind)
**Converged:** Yes (iteration 2: one WARNING, a duplicate of a decision already in the plan; the rest NITs)
**Total findings:** 0 BLOCKERs, 7 WARNINGs, about 10 NITs
**Fixed:** 4 WARNINGs; 3 decided in the plan (Settings listing, the instructions editor, an unreadable personal record) | **Asked (awaiting user):** 0

The change (kosmos#5534 slice 3): the company's AI policy text, from the signed company policy an enrolled Kosmos has
applied, reaches every agent's instructions in the same managed block as the person's own policies: at creation, at
board start, and when the company's text changes or the board leaves. New agents also get the person's own policies at
creation, which they did not before.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] an over-long company text dropped silently --> FIXED (logged; the coordinator caps a policy at 16 KB).
- [WARNING] every new company version rewrote every agent's file --> FIXED (no version or date in the provenance; name and text compared).
- [WARNING] an agent not told was not retried until the next board start --> FIXED (recorded only once every agent is told, at boot too).
- [WARNING] an unreadable personal record withholds the company text --> DECIDED (plan); create step no longer points at Settings.
- [WARNING] the instructions editor can remove the block --> DECIDED (plan: it returns at the next start or change).
- [WARNING] Settings does not list the company entry --> DECIDED (plan: next slice).
- [CONVENTION] stale header, comment on leave, size refusal blaming the person --> FIXED. [NIT] no companyPolicySync test, name collision, size gaps --> accepted.

#### Iteration 2 (sonnet)
- [WARNING] an unreadable personal record withholds the company text --> duplicate of the decision; the comment now says so.
- [NIT] marker injection untested --> TESTED. [NIT] empty roster read as all told, duplicate headings, log noise --> accepted.
