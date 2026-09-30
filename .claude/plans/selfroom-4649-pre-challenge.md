---
pre_challenge: true
method: challenge-loop
branch: selfroom-4649
diff_hash: 849a22b6ffd850063e18452b1b0a785c423252c18b5e126415fa76335274795b
validation: passed (Agent1s full suite at 58e8702e4, detached run "PASSED attempt 1"; a79a3f3ce adds only origin/main plus a reason-grep count resolution, measured, and is covered by the PR's CI)
subdir_audit: passed
timestamp: 2026-09-30T08:01:25Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10 returned no new BLOCKER, WARNING or CONVENTION)
**Total findings (actionable):** at least 17 fixed across iterations 1-9 (itemised below from the iteration commits); plus decided-not-changed items
**Fixed:** see per-iteration | **Deferred:** the decided items below | **Asked (awaiting user):** 0

The loop ran in an earlier session of mine (2026-09-29); the ledger survives in the iteration commits
("selfroom-4649 -- address challenge-loop iteration N findings"). This summary is written from those
commits. The reviewer model per iteration was not recorded there: **Reviewer model: unknown** for each.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** unknown
**Self-generated:** 0
- [BLOCKER] engine join preview — own code read "Shared by: your other computer.kosmosplus.com" --> FIXED (53cb2ec57); render-owncode-4649.js reds all 4 arms on the old line
- [WARNING] federation.js — the 128-byte ref cap had tightened invite()'s project NAME check (a 60-char CJK name) --> FIXED (53cb2ec57)

#### Iteration 2
**Reviewer model:** unknown
- [WARNING] invite() — sharing with your other computers then inviting a guest sealed the room under them --> FIXED: 409 'self-shared' (223736e94)
- [WARNING] fedseats — an own room refused for good read as "nobody outside has joined" in a loop --> FIXED (223736e94)

#### Iteration 3
**Reviewer model:** unknown
- [BLOCKER] remote.fedSeatArgs — a pasted own code's ref reached the connector argv unchecked --> FIXED: refs are [A-Za-z0-9_-] starting alphanumeric; six hostile refs refused (ff322f11a)
- [WARNING] fedseats — exit 2 (connector too old) ended the whole seat, guests included, with guest wording --> FIXED (ff322f11a)

#### Iteration 4
**Reviewer model:** unknown
- [WARNING] join — a second Join of an own code made a second project in the same room --> FIXED: 409 already_joined at join too (334e35bf8)
- [WARNING] verify — own-code verify did not need Kosmos Plus --> FIXED: 403 not-plus (334e35bf8)
- [WARNING] invite() — an own code made during the coordinator await would be sealed out --> FIXED: re-check after the await (334e35bf8)

#### Iteration 5
**Reviewer model:** unknown
- [WARNING] web — the not-plus refusal read as "try again in a moment" --> FIXED (7227d0f95)
- [WARNING] server.js own-code route — record failures answered 400 with the raw error --> FIXED: 500 with a sentence, tested (7227d0f95)
- [CONVENTION] owner computer not told its room now reaches the relay unsealed --> FIXED: told once (7227d0f95)

#### Iteration 6
**Reviewer model:** unknown
- [WARNING] fedseats post — a stopped own room said "nobody outside has joined" --> FIXED (2f12d32f8)
- [WARNING] join already-here check — an unreadable links record read as "not here" --> FIXED: 500 with a sentence (2f12d32f8)
- [WARNING] an invite refused by the post-await re-check --> DEFERRED: left to expire at the coordinator (plan)

#### Iteration 7
**Reviewer model:** unknown
- [WARNING] a computer joined by own code handing a code on posted the "now shared" note on every press --> FIXED (eb69f5a17)
- [WARNING] verify's Plus check could read as a 400 with raw internals --> FIXED: wrapped (eb69f5a17)
- [NIT] a too-long name is halved not trimmed; a repaint clears a shown code

#### Iteration 8
**Reviewer model:** unknown
- [BLOCKER] verify's Plus check failed OPEN when the remote had no kosmosPlus --> FIXED: fails closed (33ed61d54)
- Duplicates of decided items (guest-project button, iteration 1; refused own room waits, iteration 4) --> DEFERRED as decided
- refOk's 128-byte cap equals the coordinator's MAX_PROJECT_REF --> DEFERRED: not a change

#### Iteration 9
**Reviewer model:** unknown
- [WARNING] own-code route reused a stale link from an earlier project with the same id (#3851) --> FIXED: forgotten first, tested (5823129a9)
- [WARNING] pressing "Add your other computer" again did not retry a refused own room --> FIXED: fedseats.retryOwn (5823129a9)
- [CONVENTION] federation.js schema header lacked the self link and owner.selfShared --> FIXED (5823129a9)

#### Iteration 10
**Reviewer model:** unknown
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Converged** — no new actionable findings.

### After convergence (not review iterations)
- Merges of origin/main (00ee7c712, acc1b3d27, 58e8702e4, a79a3f3ce). The only conflicts were
  browser-checks-reason-grep.test.js counts (main's plus this branch's one render-owncode-4649 site,
  measured each time: the guard passes) and engine/remote.js module.exports (both names kept).
- End-to-end proof by Renet Tilley (#4693): tools/fed-own-e2e.js on fedproof-4693 (1c1751d70, based on
  this branch) 33/33: two boards on one account, own code on A, join on B, two seats in one room, a post
  each way, controls (another account lands in a different room; relay down).

### Outstanding questions (ASKED)
None.

### Decided, not missed (from the plan and review)
- Own-computer rows still read External (#4657, relay stamp, deployed at f9a84d1; the board label follows).
- Own-only rooms are never sealed; an own code on a sealed project is refused (409 sealed); an outside
  invite on a self-shared project is refused (409 self-shared). The real fix is #4658.
- From Renet's proof: an own code is accepted on a DIFFERENT account's computer (no leak: it lands in its
  own empty room, but the note over-promises) and "external project" wording in an own-only room.
  Filed as #4699, deliberately not in this branch.

### NITs (non-blocking)
- A too-long name is halved rather than trimmed (iteration 7).
- A repaint after a member change clears a shown code; pressing again gives the same one (iteration 7).

### Strengths
- Every fix above carries a test that reds when the fix is reverted (recorded in each iteration commit).
- The own code carries no secret: an own-room ticket is only ever minted for the caller's own account.
