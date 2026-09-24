---
pre_challenge: true
method: challenge-loop
branch: agentusagepage2-2617
diff_hash: 70b5ec1efe894540ea20761df3241296d0175f16dba90f95a22d103efdf29fe5
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T17:40:26Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 (6 before PR #3603, then Mona's styling review, then 4 more)
**Converged:** Yes
**Total findings:** 16 in the ledger (1 BLOCKER, 12 WARNINGs incl. Mona's defect, 3 CONVENTIONs), plus NITs
**Fixed:** 13 | **Deferred:** 3 | **Asked (awaiting user):** 0

This branch is the post-review follow-up to PR #3603, which merged (4951aeae) with
iterations 1-6 while Mona's review and iterations 7-10 were in progress. It is main plus the
four follow-up commits cherry-picked unchanged (their index.html delta hashes identically to
the reviewed one; the test and browser-check files are byte-identical to the reviewed
77cbf216), plus a plan pointer. The shas in the ledger below are the originals on the old
branch (local ref agentusagepage-2617 at 77cbf216); on this branch, after rebasing onto
main with #3611, they are 661e1532 (b040fbcd), 660cc412 (5b2a3de5), 6c738401 (da6fd442),
9e6f7ee2 (77cbf216).

### Validation

Full suite on HEAD 9812f221, hash 70b5ec1efe89: 8548 pass, 0 fail (validation log status
clean, 2026-09-24T17:40:26Z). Three earlier runs today each went red on one test only, feedguard
"huge body" (2.06 to 2.6 s against a 2 s bound), on code this branch does not touch. That
was a real quadratic email regex, fixed in #3611 (merged); this run is on main with it.
DEVELOPER_DIR set to CommandLineTools.

Browser check render-token-usage-2617.js, run through a session-local preload that serves
web/index.html by Playwright routing (this session could not start a board): all
assertions pass on HEAD; on origin/main's page it fails on exactly the three follow-up
assertions (non-agent label in full at 1280, at 390, model table narrow beside the donut).
Unit tests web.token-usage-2617.test.js: 33 pass.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html usageAgentRows: rows in engine output order, not the shown total --> FIXED (e6b2323f): sort by total; test with differing orders; sort perturbation red
- [WARNING] tests could not catch the ordering defect --> FIXED (e6b2323f)
- [WARNING] browser check never run --> FIXED (e6b2323f): run hermetically; found and fixed phone-width overflow of BOTH tables (the 0.6.90 closeout defect); 390-wide assertions added
- [CONVENTION] redundant Browser-check trailer --> DEFERRED: harmless, the diff updates a check anyway
- [NIT] palette past six, % of shown vs grand total, singular shared label, "your own sessions" overclaim, no title --> fixed

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION (dup), 1 NIT
**Self-generated:** 0 of the above
- [BLOCKER] block hid its own note when every token was unmatched --> FIXED (f879c951): shown on table OR note; unit and browser tests; hide-rule perturbation red
- [WARNING] agent table duplicated the model table renderer --> FIXED (f879c951): one usageShareTableHtml, parity test
- [CONVENTION] plan filename without timestamp --> DEFERRED: prevailing repo practice

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] overcount copy said "a little", unmeasured --> FIXED (70950812): states the amount
- [WARNING] no-byAgent control passed by markup after reload --> FIXED (70950812): same-page repaint control; broken-hide perturbation red
- [NIT] unreadable transcripts in the note, esc(label), name-width bar, assertion placement --> fixed

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] hardcoded palette indices --> FIXED (d279c99c): derived from length
- [NIT] inverted assertion message, preload provenance in the plan --> fixed

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION (harness, dup), 5 NITs
**Self-generated:** 1 of the above
- [WARNING] agents shared the model palette, implying a model-agent link --> FIXED (22ef6bac): agents in one neutral ink; styling call flagged for Mona
- [NIT] "1 tokens", duplicate display names, fixture shape, narrow-layout comment --> fixed

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs (harness point is a dup, re-examined: board only stamps a platform meta), 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
Converged on the pre-review state; PR #3603 opened, then Mona's styling review reopened it.


#### Mona's styling review of PR #3603 (between iterations 6 and 7)
- [DEFECT] the non-agent row label "Sessions outside any agent's folder" was cut short even at full width --> FIXED (b040fbcd): fixed sentences wrap, agent names keep ellipsis + title; browser check asserts the label reads in full at 1280 and 390

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, NITs
**Self-generated:** 0 of the above
- [WARNING] a zero-token agent counted as a display-name collision and suffixed a visible agent --> FIXED (5b2a3de5): count collisions only among agents that get a row; test red when removed
- [NIT] two muted-label rules merged, check requires at least one bar, plan updated for the label wrap --> fixed

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 0 NITs
**Self-generated:** 0 of the above
- [CONVENTION] per-agent block heading styles copied the history block rule for rule --> FIXED (da6fd442): shared selectors

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (the container-width point was an earlier NIT only reworded)
- [WARNING] narrow layout keyed on the section's width, so a table squeezed beside the donut kept the full grid --> FIXED (77cbf216): each share table is its own size container; browser check asserts the side-by-side case, red on the previous commit
- [WARNING] agent and non-agent rows close in colour in dark mode --> DEFERRED: styling call Mona already reviewed and approved; passed to her on the PR
- [NIT] check header comment, redundant filter --> fixed

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION (dup: plan filename), 1 NIT (tie-break, cosmetic)
**Self-generated:** 0 of the above
**Converged** -- no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html usageAgentRows | BRANCH | engine order not shown total | FIXED | e6b2323f |
| 2 | 1 | WARNING | web.token-usage-2617.test.js | BRANCH | ordering untestable | FIXED | e6b2323f |
| 3 | 1 | WARNING | browser check | BRANCH | never run | FIXED | e6b2323f |
| 4 | 1 | CONVENTION | commit b275ae95 | BRANCH | redundant trailer | DEFERRED | harmless |
| 5 | 2 | BLOCKER | web/index.html paintUsage | BRANCH | note hidden with block | FIXED | f879c951 |
| 6 | 2 | WARNING | web/index.html | BRANCH | duplicated renderer | FIXED | f879c951 |
| 7 | 2 | CONVENTION | plan filename | BRANCH | no timestamp | DEFERRED | repo practice |
| 8 | 3 | WARNING | web/index.html usageAgentNote | BRANCH | "a little" unmeasured | FIXED | 70950812 |
| 9 | 3 | WARNING | browser check | SELF | vacuous hide control | FIXED | 70950812 |
| 10 | 4 | WARNING | web/index.html | SELF | hardcoded palette split | FIXED | d279c99c |
| 11 | 5 | WARNING | web/index.html | SELF | agents borrow model colors | FIXED | 22ef6bac |
| 12 | M | DEFECT | web/index.html non-agent labels | BRANCH | label truncated at full width (Mona) | FIXED | b040fbcd |
| 13 | 7 | WARNING | web/index.html usageAgentRows | BRANCH | zero-token agent causes name suffix | FIXED | 5b2a3de5 |
| 14 | 8 | CONVENTION | web/index.html css | BRANCH | duplicated heading rules | FIXED | da6fd442 |
| 15 | 9 | WARNING | web/index.html css | SELF | narrow layout keyed on section width | FIXED | 77cbf216 |
| 16 | 9 | WARNING | web/index.html css | BRANCH | dark-mode row contrast | DEFERRED | Mona's approved styling |

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html usageAgentNote: "totals saved for those days" is engine wording; rare overcount case only (iteration 6, passed to Mona)
- [NIT] share tables use div grids without table ARIA; pre-existing pattern (iteration 2)
- [NIT] elsewhere also holds transcripts with no recorded cwd; data limitation (iteration 3)

### Strengths (across all iterations)
- The page reads the exact byAgent shape the server sends, including null (iterations 1-6)
- One share-table renderer for both tables, parity pinned (iterations 2-6)
- Escaping in text and title, hostile-name test (iterations 1-6)
- Hide path proven by same-page repaint, not by reload (iterations 3-6)
- Phone-width fix repairs the pre-existing per-model overflow too (iterations 1-6)
