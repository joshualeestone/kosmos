---
pre_challenge: true
method: challenge-loop
branch: agent-reads-4491
diff_hash: c479622098e8412f1f4da64a729595bd81f3c8bb002f28db6aecdb1605e119fb
subdir_audit: passed
timestamp: 2026-09-30T15:23:10Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 blind reviews (opus on the odd rounds, sonnet on the even), each of the whole branch against main, told only the decisions recorded in the plan.
**Converged:** Yes, twice. Round 6 returned no BLOCKER, WARNING or CONVENTION, but a comment in the tree then stated something I had measured wrongly (below), so two more rounds ran on the corrected tree; round 8, a sentence-by-sentence truth pass, again returned none.
**The design changed twice under review**, and one of my own measurements was wrong. All three are recorded in `.claude/plans/agent-reads-4491.md`:
- Round 1: the setup-guide exception was removed, on my measurement that the guide can read the board token.
- Round 3: a caller that came through on its agent token alone now reads the room and the tasks only of a project it is on. The reviewer named the caller the first design left out: an agent on another machine behind the person's own reverse proxy.
- After round 6: **my round-1 measurement was of the wrong setup** (the guide's deny rules without the sandbox block it also gets on a Mac). April measured the real guard: a Claude guide on a Mac cannot read the board token. No rule changed, because round 3's membership rule already covers it; the comments and plan were corrected, and the decision not to add a guide-only rule is now made on the true facts.
Every rule has a mutation that turns a test red (the plan lists them).

## Iteration 1 (opus): 0 BLOCKER, 2 WARNING, 2 CONVENTION, 4 NIT
- [WARNING] The guide rule's premise is contradicted inside the repo. Measured (a direct read of a denied file is refused; a command that reads it itself is not). Rule removed.
- [WARNING] The guide rule was tested only against stubs, with a name no guide can have. Gone with the rule; the one guide test left uses a real marked folder.
- [CONVENTION] "They write nothing and answer every caller alike" was false. The comment names the catalogue download and the link previews.
- [CONVENTION] "Fails closed" was false for every state the real code can reach. Gone with the rule.

## Iteration 2 (sonnet): 0 BLOCKER, 1 WARNING, 0 CONVENTION, 2 NIT
- [WARNING] "No agent gains a read" assumed every token holder also holds the board token. The comment was rewritten to say who gains.

## Iteration 3 (opus): 0 BLOCKER, 1 WARNING, 1 CONVENTION, 5 NIT
- [WARNING] The reverse-proxy caller gains every room. Taken as a design change: membership for a token-only caller, no global task list, no Tasks-view arm, a 503 when the projects cannot be read.
- [CONVENTION] The comment at POST /api/agent-token ("the name does nothing until it is live") was made false. Reworded.

## Iteration 4 (sonnet): 0 BLOCKER, 1 WARNING, 0 CONVENTION, 2 NIT
- [WARNING] Membership for the new reads is by the token store's key, looser than the writes' exact spelling, and nothing said so. The helper's comment says it and why it is no wider than the store.

## Iteration 5 (opus): 0 BLOCKER, 1 WARNING, 2 CONVENTION, 2 NIT
- [WARNING] Two decisions had no test that could fail. Added: a wrong board token does not lift the narrowing; membership by key.
- [CONVENTION] A test comment about t.after order was false and left a stub installed. Replaced by try/finally.
- [CONVENTION] "There is no caller to identify" was left over from before round 3. Removed; two plan lines corrected.
- [NIT, taken as code] A project id stored twice: the agent must be on every project with that id. Tested.

## Iteration 6 (sonnet): 0 BLOCKER, 0 WARNING, 0 CONVENTION, 3 NIT
- Three wording NITs, taken. (The tree it passed still carried the wrong statement about the guide; see above.)

## Iteration 7 (opus), on the corrected tree, the guide as its main question: 0 BLOCKER, 1 WARNING, 0 CONVENTION, 4 NIT
- [WARNING] "What it says stays masked for secrets either way" was false for three writes the guide's token reaches (task message, the task-built note, the status report text). The comment and plan now name the masked and the unmasked channels. The gap is on main already and is filed as #4733; not fixed here (this slice adds reads).
- Asked directly: the guide cannot put itself on a project, or create one with itself on it, with its own token. So the membership rule is a real limit for it.
- Wording NITs taken: every member is sent every post (not only those addressed to it); only a board-token process can put the guide on a project; it is a Claude guide on a Mac.

## Iteration 8 (sonnet), a sentence-by-sentence truth pass: 0 BLOCKER, 0 WARNING, 0 CONVENTION, 2 NIT. CONVERGED
- Two wording NITs, taken. It could not build a request that gives a token-only caller another project's room or tasks or the global list, nor one that changes the answer for a caller with a valid board token, the page, or a board that is not enforcing. No code changed after this round's review; the branch was then rebased onto two unrelated commits on main with no conflict.

## Validation
- Full suite: validation passed (Mortals), recorded for this exact diff hash.
- server.agent-reads-4491.test.js 10 of 10. The 145 related test files (69 around the gate, the CLIs and the guide; 76 that read server.js, the Windows CLI or install/kosmos as text): 2877 pass, 0 fail, 18 skipped, on the rebased tree.
- `bash -n install/kosmos` and `node --check` on server.js and the Windows CLI pass. Both browser-check gates pass (no page change).

## Weakest premise
- That "on the project" is the right line for a token-only read. It is the line `kosmos post`, `react` and the task verbs already draw, but nobody has ruled on it. Nothing depends on it today, because every CLI still sends the board token.
- That letting the guide read the room of a project it is on is what the operator wants. The stricter rule exists in this branch's first version.
- Not verified here: that the Kosmos+ tunnel presents the person's board token on the traffic it forwards (that code is in kosmos-relay).
