---
pre_challenge: true
method: challenge-loop
branch: newrole-4474
diff_hash: 77fc02bdb4ef41361ed69d9983141f85bf18dc8a8cde27c34c027e72989ae009
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T05:19:55Z
iterations: 13
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 13 (blind reviews alternating opus and sonnet, starting with opus)
**Converged:** Yes (iteration 13: no BLOCKER, WARNING or CONVENTION; NITs only)
**Design changes during the loop:** iteration 7 took the setup guide out (only the Project Manager writes roles; the server refuses a role the guide writes), which removed the guide-refresh swap (iteration 3) and the label/text masking (iteration 6). Iteration 9 added `role-draft --to` (a shell redirect re-encodes the file on Windows).
**Deferred:** 0. **Asked:** 0.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] engine/team.js - the identity line padded blank or 2-character text past create's minimum --> FIXED (only text create would take gets the line; engine and route tests)
- [WARNING] engine/team.newrole-4474.test.js - no test for empty or short text --> FIXED
- NITs applied: `--` before the Mac file path; label flattened; PM told to change the draft's first line

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] engine/team.js - the stored label was not flattened --> FIXED
- [WARNING] engine/team.js - an identity line naming another agent was kept --> FIXED (given the member's name)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] existing guides never got the new lines --> FIXED then SUPERSEDED in iteration 7 (the guide was taken out)
- [CONVENTION] CLAUDE.md "Work on the setup guide" row --> FIXED
- NITs applied: only ** runs stripped from labels

#### Iteration 4
**Reviewer model:** sonnet
- [BLOCKER] engine/team.js - a role sent as ["setup"] passed the setup refusal; create coerced it and made the guide --> FIXED (read as create reads it; engine and route tests)
- [BLOCKER] engine/team.js - the identity-line rewrite expanded $ patterns in an agent-chosen name --> FIXED (replacer function; test)
- [WARNING] label not flattened when sent without text --> FIXED
- [CONVENTION] inline require --> FIXED

#### Iteration 5
**Reviewer model:** opus
- [WARNING] Windows PowerShell 5.1 writes UTF-16LE; the role file read as NULs between letters --> FIXED (BOM decoding in the Windows CLI; NUL refused on the server; tests through the real reader)
- [WARNING] install/kosmos - the whole role text on curl's argv (#1970, #2909) --> FIXED (stdin)
- NITs applied: one file per role

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] the guide-masking of label/text had no test --> FIXED then SUPERSEDED in iteration 7 (removed with the guide)
- NITs applied: role-draft ends in one newline on both CLIs

#### Iteration 7
**Reviewer model:** opus
- [WARNING] engine/team.js - "a made-up role cannot drop the shared rules" was false (the served draft carries them; an agent could keep the heading and gut them) --> FIXED (text keeping the heading must keep the block word for word; test)
- [WARNING] engine/team.js - an agent's member could carry claudeBin/codexBin/tmuxBin/runner/configDir/pickedByPerson to create (older than the branch) --> FIXED (AGENT_MEMBER_KEYS allowlist; test)
- [WARNING] should the sandboxed guide write roles at all --> DECIDED: no; the server refuses a role the guide writes and the guide is not taught it (route test with a non-guide CONTROL)

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] the role rule written twice (create.js, team.js) --> FIXED (create.roleKeyOf shared; battery test)
- [WARNING] the allowlist dropped benign fields --> FIXED (reportsTo, maxHelpers, dailyTokenLimit, dailyAllowancePct; a test sorts every field create reads)

#### Iteration 9
**Reviewer model:** opus
- [WARNING] the Windows flow was refused: PowerShell's > rewrites the draft with CRLF and the rules check is word for word --> FIXED (role-draft --to writes the file itself; CRLF normalized; test with the real served draft)
- [WARNING] the boundary claim overstated --> FIXED (the header says: real for the guide, a cooperative guard for agents that can read the board token)

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] the vetted member carried the role as sent, not as vetted --> FIXED (the roleKeyOf string; test)

#### Iteration 11
**Reviewer model:** opus
- [WARNING] the rules phrase hand-typed a third time --> FIXED (defaults.RULES_PHRASE; test)
- [WARNING] a member the vetting refuses was still probed and counted against the cap --> FIXED (vetted before the liveness sweep; counting-probe test with a CONTROL)
- NITs applied: role-draft --to never replaces a file; PM keeps the draft's first line (worded without the {{NAME}} token, which instructionsFor would fill)

#### Iteration 12
**Reviewer model:** sonnet
- [WARNING] a NUL in the label rode into the text through the identity line --> FIXED (control characters stripped from the label; test)

#### Iteration 13
**Reviewer model:** opus
- no BLOCKER / WARNING / CONVENTION (NITs only)
**Converged.**

### NITs (non-blocking)
- Two plan lines (Change and Tests) still name the guide from before iteration 7; the iteration-7 section records the reversal.
- A control character in a label becomes a space (a word can split); the label is capped at 80 characters by create.
- role-draft --to checks for the file, then writes (not one atomic wx write).
- IDENTITY_LINE does not recognise a possessive or "!" after the name; the field-sorting guard cannot see a destructured read.
- The Mac CLI passes name, label and why to node through the environment (ps eww can read it); the text itself goes on stdin.

### Strengths
- One vetting function, idempotent, run before any account probe and again in createTeam; one derivation of the role (create.roleKeyOf) and of the rules phrase (defaults.RULES_PHRASE).
- The allowlist closes an older hole: an agent could choose what a new agent's launch job runs.
- Cross-platform text handled and tested with the real served draft and real encoded files (UTF-16 BOM, CRLF, NUL).
- Every guard has a mutation that turns its test red, and every route test has a CONTROL that can fail.
