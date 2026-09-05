---
pre_challenge: true
method: challenge-loop
branch: reactions-2255
diff_hash: 690108ebbeb63161434b25306c14f6a8d0b3cfb408acaca676bf26cd2b399d6a
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T23:21:39Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iterations 2 and 3 each returned zero actionable findings)
**Total findings:** 8 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 7 NITs)
**Fixed:** 6 | **Deferred:** 2 | **Asked:** 0

This branch was rebased onto current origin/main (46 commits, including rich-text
#2239 and emoji-picker-2254, which also touch messages.js / server.js /
web/index.html) before review; the full node suite (4703) and the reactions
browser-check (20/20 both themes) are green on the rebased tree.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] the agent `/api/react` route had no project-membership check, unlike
  `/api/post` -- any resolvable agent could react in a room it is not on, a
  cross-room write the room model blocks for posts --> FIXED (eb09a2f1): threaded
  the project members into `react()` and refuse a non-member, mirroring sendPost;
  the operator is exempt (in every room they own).
- [NIT] an agent literally named 'you' (a legal session name) would replay as the
  operator's own pill --> FIXED (eb09a2f1): reserve 'you' for the operator.
- [NIT] `RXN_QUICK` held literal non-ASCII emoji despite the plain-ASCII intent
  --> FIXED (eb09a2f1): escaped them.
- [NIT] the spoof test used an unresolvable pane --> addressed at the engine level
  (a member/reserved/operator-flag test); route-level deferred (see below).

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
- [NIT] membership was checked AFTER the post lookup, leaking a "no such post" vs
  "not on project" id-enumeration tell --> FIXED (1ab2a19a): check membership
  first, uniform refusal.
- [NIT] the `reaction` kind had no explicit `rowShaped` rule (rode the unknown-kind
  fallthrough) --> FIXED (1ab2a19a): explicit rule matching react()'s output + a
  test that seeds one well-formed and three malformed rows and asserts one survives.
- [NIT] no server happy-path for a member agent through /api/react --> DEFERRED
  (harness-blocked, covered three other ways -- see the plan).
- [NIT] room GET is O(posts x rows) --> DEFERRED (fine at scale, consistent with
  the existing replay patterns #185/#460).

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
- [NIT] `/api/react` returned 400 for a react refusal while its own pre-react
  refusals and sibling `/api/post` return 200 --> FIXED (this iteration): 200 for
  the refusal too (a room-state answer read off `ok`).
- [NIT] resolvable-pane spoof test (re-raised) --> DEFERRED with documentation: the
  test fake-tmux resolves every pane to one fixed session name that resolveSender
  will not match to a synthetic member, so a resolvable /api/react cannot be driven
  in this harness. The property is covered structurally (the route passes only
  `from: sender.card.sessionName`, never body operator/from), by the engine test
  (an agent react stores `from:<name>`, never `operator:true`), and by the %9999
  refusal test.
- [NIT] O(posts x rows) room GET (re-raised) --> DEFERRED (informational).
- **Converged.**

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | WARNING | engine/messages.js server.js | agent react lacked the room-membership gate | FIXED eb09a2f1 |
| 2 | 1 | NIT | engine/messages.js | agent named 'you' collides with the operator | FIXED eb09a2f1 |
| 3 | 1 | NIT | web/index.html | literal emoji in RXN_QUICK | FIXED eb09a2f1 |
| 4 | 2 | NIT | engine/messages.js | membership checked after the post lookup | FIXED 1ab2a19a |
| 5 | 2 | NIT | engine/messages.js | reaction kind had no rowShaped rule | FIXED 1ab2a19a |
| 6 | 3 | NIT | server.js | /api/react 400 vs /api/post 200 on refusal | FIXED |
| 7 | 2/3 | NIT | server.projects.test.js | resolvable-pane happy-path test | DEFERRED (harness-blocked, covered 3 ways) |
| 8 | 2/3 | NIT | server.js | room GET O(posts x rows) | DEFERRED (fine at scale) |

### Strengths (across iterations)
- The membership gate mirrors sendPost exactly (operator exempt, non-member and
  garbled member-list both refused, cannot be bypassed from the body).
- The reserved-'you' guard closes the operator-collision at the only write path.
- Agent-route security: sender is from_pane-derived, never body; operator flag set
  only by the operator route; emoji double-guarded (normalizeReactionEmoji + esc()).
- Toggle/replay correct; post isolation safe (globally-unique post ids); the
  rowShaped reaction rule exactly matches react()'s output (no valid row dropped).
- Wiring guards reconciled (EXPECTED_SITES 48->49, README, run loop, ROOM_NOT_SPEECH).
- No em dashes in author-facing output.

### The deferred agent-DELIVERY half (product decision, not a gap)
A `kosmos react` CLI verb + surfacing post ids in `kosmos room` is deliberately
deferred: it changes the SHARED agent room view for the OPTIONAL half of the card
(the user reacting is done here). The `/api/react` route + engine are built and
tested, so the follow-up is delivery-only. #2255 stays open for it after merge.
