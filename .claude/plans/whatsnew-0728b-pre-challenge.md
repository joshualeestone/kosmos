---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0728b
diff_hash: ff9eb7d3db66b35cae66ab99d1d87c80ec57531506bf9c26334abb51cdae9343
validation: passed (release notes only: web/whats-new.json and the plan. node tools/whats-new-check.js 0.7.28 passes, 3 highlights, mac 3, windows 3. Entry 3's feature (#5498) is merged on main after the 0.7.27 pin. Copy is Mona's final wording, 14:20 CDT. The same 465 whats-new readers passed on the parent What's New, #5503)
subdir_audit: passed
timestamp: 2026-10-07T19:22:08Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (sonnet, blind), checked against PR #5498's code
**Converged:** Yes (no BLOCKER or CONVENTION; 2 WARNINGs deferred with reasons; 2 NITs fixed)
**Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
- [WARNING] "go ahead past permission prompts" is broader than the hook, which answers only prompts raised by ask rules --> DEFERRED: agents already launch with permissions bypassed, so the only permission prompts they raise ARE ask-rule prompts. The silent exceptions (.claude, .git) do not prompt today (measured in the PR on Claude Code 2.1.292). True for the person as written; Mona's approved wording.
- [WARNING] "from their next start" holds only on the fresh-launch path; adopted or running agents are unchanged --> DEFERRED: that is exactly what "next start" tells the person.
- [NIT] the plan's check line said 2/2 --> FIXED
- [NIT] the plan cited the PR head, not the feature commit --> FIXED

### Strengths
- [STRENGTH] Claude only, deny rules still block, and the agent's own questions still show: each was checked in the code.
- [STRENGTH] The wording avoids "skip" and "from your own settings"; the plan records why.
