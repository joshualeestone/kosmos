---
pre_challenge: true
method: challenge-loop
branch: replybar-4358
diff_hash: e0862d858996182d5d47346a762bd12a743d002a8a0639f108ba6a1c8ade1dc3
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T17:15:00Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10: NITs only)
**Total findings:** 18 (3 BLOCKERs, 13 WARNINGs, 2 CONVENTIONs), plus NITs
**Fixed:** 17 | **Deferred:** 1 | **Asked (awaiting user):** 0

Cards: #4358 (hover bar: the four emoji together, Reply last with a small arrow, bright gold outline
on hover) and #4359 (Reply in a room puts @AgentName at the start of the composer), built together
on Splinter's instruction.

Validation: 6g full runs found two real issues, both fixed and recorded below as 6g findings (two
source-pinning unit tests, the 6j finding after iteration 6). Three full runs were stopped
unfinished because a review round had already found code to change (each was stopped with its whole
process group, and no orphan was left). One run failed on engine/musefront.test.js alone (Meta Muse,
not this branch), which passed 3/3 run by itself; the full suite was then re-run. The final 6j run on
this HEAD: 11261 tests, 0 fail, subdir audit clean (hash e0862d858996).

Every fix came with a control: the change removed or reverted, the arm confirmed red, restored.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION
**Self-generated:** 0
- [BLOCKER] surface gate: rxn-quick changed, three checks unmarked --> FIXED (ran all three, per-check trailers, f9e13c6)
- [WARNING] render-room-reply-3745.js - the dark arm could not prove it ran dark --> FIXED (resting-border control)
- [WARNING] plan - the assistant chat (the card's third surface) unaddressed --> FIXED (it draws no hover bar; recorded)
- [CONVENTION] plan file present --> no action

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING
**Self-generated:** 1 (the BLOCKER sat in pjReplyMention, written in f9e13c6)
- [BLOCKER] Reply that adds no mention moved the cursor to the front of a draft --> FIXED (86cb40e)
- [WARNING] no arm for a post from someone not on the project --> FIXED (86cb40e)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 3 WARNINGs
**Self-generated:** 2
- [WARNING] a mention the person typed was recorded as Reply's, so x or a switch could delete their words --> FIXED (2a82887)
- [WARNING] the early return skipped cursor placement --> FIXED (2a82887)
- [WARNING] no real Reply click on an agent's post --> FIXED (2a82887)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 WARNING
- [WARNING] only-mention + attachment send untested --> FIXED (e1c0776)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 2 WARNINGs
**Self-generated:** 1
- [WARNING] Reply while a post is on its way rewrote the box, leaving the sent words to go out twice --> FIXED (3f7020d, PJ_POSTING guard)
- [WARNING] the real-click arm could flake on the 5 s room poll; fetch stub not restored in a finally --> FIXED (3f7020d)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT (converged at 6d)
- 6j validation on that HEAD then failed: [BLOCKER] final-validation: two unit tests pin the attach-fill
  source line --> FIXED (a3125f9), and the loop returned to 6e for another iteration.

#### Iteration 7
**Reviewer model:** opus
**New findings:** 2 WARNINGs
**Self-generated:** 1
- [WARNING] a mention not at the front could be stacked --> FIXED (13195a8)
- [WARNING] the widened links test no longer failed if the prefix were dropped --> FIXED (13195a8, pinned exactly)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING
**Self-generated:** 1
- [BLOCKER] the already-named regex escaped only "." --> FIXED (05c5f2f), then superseded in iteration 9
- [WARNING] two overlapping checks --> FIXED (05c5f2f, one check)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 2 WARNINGs
**Self-generated:** 2
- [WARNING] the page's "already named" was stricter than the engine's matcher ("thanks @roomer." doubled) --> FIXED (d3b3f87, mirrors engine/messages.js exactly)
- [WARNING] the "+" key arm certified a case the room roster does not produce --> FIXED (d3b3f87, replaced)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html rxnsInner | BRANCH | surface gate on rxn-quick | FIXED | f9e13c6 |
| 2 | 1 | WARNING | render-room-reply-3745.js | BRANCH | dark arm unproven | FIXED | f9e13c6 |
| 3 | 1 | WARNING | plan | BRANCH | assistant chat surface | FIXED | f9e13c6 |
| 4 | 1 | CONVENTION | plan | BRANCH | plan file present | DEFERRED | not a defect |
| 5 | 2 | BLOCKER | pjReplyMention | SELF | cursor jumped to the front | FIXED | 86cb40e |
| 6 | 2 | WARNING | render-room-reply-3745.js | BRANCH | non-member author untested | FIXED | 86cb40e |
| 7 | 3 | WARNING | pjReplyMention | SELF | typed mention treated as Reply's | FIXED | 2a82887 |
| 8 | 3 | WARNING | pjReplyMention | SELF | cursor not placed on repeat Reply | FIXED | 2a82887 |
| 9 | 3 | WARNING | render-room-reply-3745.js | BRANCH | no real click on an agent post | FIXED | 2a82887 |
| 10 | 4 | WARNING | pjPostSend | BRANCH | mention + attachment untested | FIXED | e1c0776 |
| 11 | 5 | WARNING | pjReplyMention | SELF | Reply mid-send rewrote the box | FIXED | 3f7020d |
| 12 | 5 | WARNING | render-room-reply-3745.js | BRANCH | poll race, fetch restore | FIXED | 3f7020d |
| 13 | 6 (6j) | BLOCKER | two unit tests | BRANCH | final-validation: source pins on the fill line | FIXED | a3125f9 |
| 14 | 7 | WARNING | pjReplyMention | SELF | stacked mention not at front | FIXED | 13195a8 |
| 15 | 7 | WARNING | web.links-everywhere.test.js | SELF | optional prefix weakened test | FIXED | 13195a8 |
| 16 | 8 | BLOCKER | pjReplyMention | SELF | key escaped only "." | FIXED | 05c5f2f |
| 17 | 9 | WARNING | pjReplyMention | SELF | stricter than the engine matcher | FIXED | d3b3f87 |
| 18 | 9 | WARNING | render-room-reply-3745.js | SELF | "+" arm certified an unreal case | FIXED | d3b3f87 |

### NITs (non-blocking, across all iterations)
- Gold hover is about 1.95:1 on the light surface; accepted and recorded beside the rule (owner's call, as #4051).
- The gap before Reply (6px desktop, 8px phone) is deliberate and recorded in the plan.
- A mention the person moved behind other words is detected, but a doubled mention typed before Reply's own at the front is a narrow edge (iteration 6).
- pjReplyStart focuses the box again after pjReplyMention already did (harmless).
- The "already named" check reads the raw box, not chat.cleanMessage's output (equivalent for its boundary use).
- .pj-replying-h stays in CSS only for render-no-left-bars-3692's synthetic markup (commented).

### Strengths (across all iterations)
- One change in rxnsInner reaches rooms and both DM paints; the 36px tap targets are unchanged.
- The mention is exactly what the @ picker inserts, and "already named" is the engine's own rule.
- Reply only ever removes a mention it wrote; the person's own mentions and drafts are never touched.
- The check drives real clicks, captures the real send body, and each arm has a control.
