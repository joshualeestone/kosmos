---
pre_challenge: true
method: challenge-loop
branch: dm-reactions-3650
diff_hash: aac8e4c9b3a0e3ecb92c36bbafa42a526991853c2d2d53abaf91773a91f16a79
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T02:33:38Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 in this run (blind reviewer passes 3 to 9 on this branch; passes 1 and 2 ran in an earlier session before a rebase, their fixes are commits 4b34fdb6 and cd148960, and that run wrote no proof)
**Converged:** Yes
**Total findings (this run):** 15 actionable (1 synthetic BLOCKER, 12 WARNINGs, 2 CONVENTIONs) plus NITs
**Fixed:** 14 | **Deferred:** 1 | **Asked (awaiting user):** 0

Origin note: the Origin column below was set by reading which commit last wrote the cited
line, not by running the 6c-bis blame template, so treat it as a reading rather than a
mechanical measurement. Every SELF finding was on a CODE line and was fixed normally; none
was a prose claim, so 6e's delete-the-claim rule never applied.

### Per-Iteration Breakdown

#### Iteration 1 (includes the 6.0 initial validation)
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER (synthetic), 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [BLOCKER] initial-validation: browser-check surface gate (#2518) flagged render-agentdm-3414.js (token d-dmthread) --> FIXED (1faa61c4): ran that check on the branch, 40/40, recorded a per-check Browser-check-surface trailer
- [WARNING] web/index.html paintTalkThread: "did the thread change" derived twice (picker close vs setThread) --> FIXED (1faa61c4): the close moved into setThread's own rewrite decision, which also covers the note arms
- [WARNING] docs/browser-checks/render-dm-reactions-3650.js: no arm for a quiet poll keeping the picker open --> FIXED (1faa61c4): quiet-poll and rewriting-poll arms, each reddened by its perturbation
- [NIT] plan: stale test count --> fixed (count removed)

#### Iteration 2
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js: the DM react route had no nameRefusal (borrowed-name) gate --> FIXED (f6b692ee), server test with a tied-agent control; removing the gate reds it
- [WARNING] engine/chat.js markDmReactionsTold: marked whatever was on the message at mark time, not what the note named --> FIXED (f6b692ee), dmReactionNews returns `named`; mid-send and take-back engine tests
- [WARNING] server.test.js: the menu arm never reached `chose` and accepted a 409 --> FIXED (f6b692ee): named for the digit guard, 409 dropped, digit must be typed
- NITs fixed: note wording names its real window; reactDirect docblock; C1/bidi strip in the snippet; reactionsTold not served; README row. NIT left: hover bar can clip at the top of the DM scroll box (room layout, shared).

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (the duplicated 404 body, on lines iteration 2 wrote)
- [CONVENTION] server.js: nameRefusal 404 body duplicated across the thread GET and the react route --> FIXED (33d926d0), nameRefusalBody helper
- [CONVENTION] commit 8dc51ff5 subject not in `<branch> -- ` form --> DEFERRED: Kosmos squash-merges, so the PR title is the commit on main, and it follows the form
- NITs: lazy require per call; no comment on the per-message cap (addressed in iteration 5)

#### Iteration 4
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above (the emoji half of the note, rewritten in iteration 2)
- [WARNING] tools/browser-checks.sh: conflict with origin/main (#3574 added a check to the same list) --> FIXED (5ee30711 merge; counts re-measured on the merged tree, still 133/94)
- [WARNING] engine/chat.js: the emoji itself reached the pane unsanitised (normalizeReactionEmoji accepts bidi/C1) --> FIXED (eae2f5c1): refused on write, stripped on read; each reds under perturbation
- NITs fixed: counted messages recorded as told stated at the code; the mark's failure mode stated at the call; digit assertion anchored to the end of what was typed. NITs left: 400 for every reactDirect refusal; empty-text snippet.

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the strip written in iteration 4)
- [WARNING] engine/chat.js: a stored value made only of unsafe characters was marked told without being named --> FIXED (96bad73d): dmReactions skips unsafe values, so pills, note and told-marker read one list; perturbation reds it
- NITs fixed: why-comments on the three constants; server comment rewrapped. NIT left: grapheme-cluster cut.

#### Iteration 6
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the told condition, last rewritten in iteration 2)
- [WARNING] server.js: UNCONFIRMED sends marked reactions told although the note rides the tail most likely lost --> FIXED (96137ff5): only PLACED marks; server arm with a forced Enter failure and a CONTROL on the state; restoring the old rule reds it. Stale prose about "unconfirmed" removed from chat.js, server.js and the plan.
- NITs left: 400 statuses; picker closing on the poll after a toggle; raw-name keying (consistent with readThread); doctrine line for counted reactions.

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged:** no new actionable findings. 6j final validation skipped on a clean entry for this exact hash (9020 tests, 0 failing; surface gate green).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | initial-validation | BRANCH | surface gate: render-agentdm-3414 | FIXED | 1faa61c4 |
| 2 | 1 | WARNING | web/index.html paintTalkThread | BRANCH | two derivations of "thread changed" | FIXED | 1faa61c4 |
| 3 | 1 | WARNING | render-dm-reactions-3650.js | BRANCH | no quiet-poll arm | FIXED | 1faa61c4 |
| 4 | 2 | WARNING | server.js react route | BRANCH | no borrowed-name gate | FIXED | f6b692ee |
| 5 | 2 | WARNING | engine/chat.js markDmReactionsTold | BRANCH | marks at-mark-time set | FIXED | f6b692ee |
| 6 | 2 | WARNING | server.test.js menu arm | BRANCH | never reached chose; 409 vacuous | FIXED | f6b692ee |
| 7 | 3 | CONVENTION | server.js 404 body | SELF | duplicated refusal body | FIXED | 33d926d0 |
| 8 | 3 | CONVENTION | commit 8dc51ff5 | BRANCH | subject format | DEFERRED | squash merge; PR title conforms |
| 9 | 4 | WARNING | tools/browser-checks.sh | BRANCH | conflict with main | FIXED | 5ee30711 |
| 10 | 4 | WARNING | engine/chat.js note emoji | SELF | emoji unsanitised into pane | FIXED | eae2f5c1 |
| 11 | 5 | WARNING | engine/chat.js dmReactionNews | SELF | all-stripped value marked told | FIXED | 96bad73d |
| 12 | 6 | WARNING | server.js told condition | SELF | UNCONFIRMED marked told | FIXED | 96137ff5 |

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html: hover quick bar can clip on the first agent message at the top of the DM scroll box (iteration 2)
- [NIT] server.js: every reactDirect refusal is a 400, including a disk-write failure (iterations 4, 6)
- [NIT] engine/chat.js: an empty-text agent message quotes as "" (iteration 4)
- [NIT] engine/chat.js: the snippet cut is by code point, not grapheme cluster (iteration 5)
- [NIT] web/index.html: a picker opened within one poll of a toggle closes on that poll (iteration 6)
- [NIT] engine/defaults.js: doctrine could say counted reactions will not be itemised later (iteration 6)
- [NIT] server.js: malformed-JSON 400 paths of the react route untested, same as the room route (iteration 7)

### Strengths (across all iterations)
- The DM reuses the room's renderer, shared picker and repaint rather than forking them (iterations 2, 6, 7)
- Told-marking records exactly what the note named, with mid-send and take-back tests (iterations 5, 6, 7)
- Pane safety is enforced on write and read from one filtered list (iterations 6, 7)
- Every new guard carries a CONTROL and was reddened by a perturbation (iteration 7)
