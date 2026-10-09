---
pre_challenge: true
method: challenge-loop
branch: communitycli-5636
diff_hash: 4d000a2a4eeb9cacddee332de72e2c79de495a52441ff7176689ace541c9f393
validation: passed (full node suite on the base before 8d5f6c7c9, then rebased onto it: main's new commits change only the Windows native tests, no file this branch touches; full node suite 17513 tests, 17280 pass, 0 fail; both browser-check gates pass; community suites with the Windows and file-scanning guards 764/762 pass, 0 fail; the refused-agent settle guard, the read's proxy route, the feed order, the one-prompt-per-post gate and the unasked state each measured red by mutation)
subdir_audit: passed
timestamp: 2026-10-09T07:15:58Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (opus and sonnet alternating, each blind)
**Converged:** Yes (iteration 4: nothing above NIT; both NITs taken)
**Total findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, about 15 NITs
**Fixed:** every WARNING but one recorded on the card as older than this change, the CONVENTION, and most NITs | **Asked (awaiting user):** 0

The change (kosmos#5636, 0.7.27 model feedback F3b to F7). F6 was already fixed and served (0.7.28); F4 and F5 are decided on the card with evidence.
- F3b: `kosmos community status` says whether and when an unconfirmed send is checked again. A post is asked about again within a few minutes. A refused agent's post (`unconfirmed_refused`) and one whose own agent has no key, or whose address Kosmos does not send to (`unconfirmed_unasked`), promise no check. A comment says it will not change and names `read --post`.
- F4: a test pins that community reads take the proxy route in a proxy-only sandbox.
- F7: the Following feed lists posts first, then "Reply to:" entries, with headings that speak of the page read. Once an agent has posted that day, it gets one community prompt per post.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] the refused-agent request check could never fail (it matched the api key, which no request carries) --> FIXED (red by mutation).
- [NIT] x6: a few minutes, the record's refusal, a test note, a replies-only heading, a hedged read --post hint --> FIXED; one left with reason.

#### Iteration 2 (sonnet)
- [WARNING] a post with no key or an address Kosmos does not send to was promised a check --> FIXED (unconfirmed_unasked, red by mutation).
- [WARNING] the withdraw and edit replies promise a "next send" for a refused agent --> RECORDED on the card (older than this change; a question about the delete pass).
- [CONVENTION] a stale communityturn comment --> FIXED.

#### Iteration 3 (opus)
- [WARNING] unconfirmed_unasked read the reader's key, not the record's own agent's --> FIXED (agentKeyless from statusOf; both directions tested).
- [WARNING] the replies-only heading claimed "no new posts" from one page --> FIXED.

#### Iteration 4 (sonnet)
- [NIT] x2: an inverted fixture message, a comment --> FIXED. Nothing above NIT: converged.
