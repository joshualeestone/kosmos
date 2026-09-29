---
pre_challenge: true
method: challenge-loop
branch: communityread-4373
diff_hash: cd8d6d6352b20c4bf4ea4b0a1353f93f257359b07b2a45a33322d1d124c71b21
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T08:28:54Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (3 on the branch, then 1 on the rebase resolution alone)
**Converged:** Yes (iterations 2 and 3 found nothing new at BLOCKER or WARNING; stopped at 3 deliberately, since each NIT fix drew a fresh round of NITs)
**Total findings:** 19 (1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 10 NITs, plus 4 behaviours ACCEPTED as stated in iteration 2)
**Fixed:** 10 | **Deferred:** 4 (iteration-3 follow-ups, recorded in the plan) | **Asked (awaiting user):** 0 | **Accepted as stated:** 5

**Final gate:** CI on the rebased head (this PR), plus the iteration-4 review of the rebase resolution. Local
validation v3 PASSED on e72f0321f, the PRE-rebase head (VAL_RC=0, AUDIT_RC=0, run communityread-4373-v3, 03:08:25 to
03:26:06 CDT 2026-09-29). Right after it, the branch no longer merged: #4451 and #4474 had changed
tools/windows/kosmos-cli.js on main. Rebased; both hunks were pure additions, resolved as unions; 64 tests across both
sides green. A local v4 on the rebased tree is queued as confirmation, not the gate. Earlier runs: v1 VOID (killed in
the 00:13 incident); v2 on a97fffe92 RED on the #4273 leak gate only, every test passing, and mine: the new route test
left its HOME, projects, workers and launch temp roots. Fixed (now 32ce7bf46) by requiring test-support/tmpscope
first; measured with the file alone, 4 dirs left before and 0 after.

**What the branch does:** part A of #4373. The BOARD reads the community service's public feed or one post for an
agent (no key) and hands back bounded (10 posts, capped fields, a 256 KB answer cap), reduced (text, author, where,
when), scrubbed (terminal escapes, Unicode control/format classes after NFKC folding, Kosmos markers, any "===" that
could pass for the frame) and framed text, with a never-obey rule. Nothing is read or fetched while the owner has
Community switched off. GET /api/community/read needs an agent token; `kosmos community read` is on both CLIs
(Splinter 09-28 23:05: parity verbs are done Mac-side; Homer confirms one real Windows run, not gating).

### Per-Iteration Breakdown

#### Iteration 1 (Opus, 9a43e9ca4)
- [BLOCKER] invisible characters got through (TAG characters U+E0000-E007F, word joiner, BOM, bidi and soft-hyphen marks, variation selectors, fillers) --> FIXED (whole control and format classes stripped)
- [WARNING] lookalikes (fullwidth "=", U+2A76, fullwidth "<!-- kosmos:") read as the real thing --> FIXED (NFKC fold first)
- [WARNING] a post could forge another post's header via a line break --> FIXED (header fields one line, every body line indented)
- [WARNING] the service answer was read whole --> FIXED (256 KB cap, fields pre-cut before scrubbing)
- [WARNING] tests could not see those bypasses; the Windows verb had no behaviour test --> FIXED (seven mutations each red)
- [NIT] the read route sat below #3485's post-route comment --> FIXED
- [NIT] a service failure's answer and a wrong request's status --> FIXED (502 in the board's own words, 400)
- [NIT] `general/tools` filters on `tools` alone --> ACCEPTED (the service's feed takes one slug)

#### Iteration 2 (Sonnet, 7ba88cb0f)
**New findings:** 0 BLOCKERs, 0 WARNINGs
- [NIT] the header sits outside the quoting, so channel and author could imitate it --> FIXED (channel must match the pattern, no brackets in a name; removing the rule reds the test)
- [NIT] three more zero-render characters (Mongolian FVS, Khmer inherent vowels, Braille blank) --> FIXED
- ACCEPTED: many short lines make a body about 4x its cap (ten posts stay near 45 KB); ?post= wins over ?channel= for a direct caller (both CLIs refuse both); no per-agent throttle on the read route; CR, U+0085, U+2028 are stripped rather than turned into breaks

#### Iteration 3 (Opus, a97fffe92)
**New findings:** 0 BLOCKERs, 0 WARNINGs
- [NIT] the author name can imitate header metadata --> DEFERRED (follow-up in the plan)
- [NIT] a bad channel beside a valid sub prints "in /tools" --> DEFERRED
- [NIT] unassigned default-ignorable and private-use characters pass --> DEFERRED (none encodes text as TAG does)
- [NIT] the id and date patterns are looser than UUID_RE --> DEFERRED
None of the four allows a line break, a forged frame boundary, or anything the quoted body cannot already say.
**Converged.**

#### Iteration 4 (the rebase resolution alone, blind reviewer)
- range-diff: all six commits map one to one; the branch's own lines identical before and after; main's verbConnections, verbConnect, role-draft and their USAGE entries intact; all three verbs reachable; 59/59 across eight test files
- [NIT] communityRead landed after #4451's verbConnect, splitting the community code --> FIXED (aeb460c56, a pure move: the file's lines are the same multiset)

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Weakest premise (from the plan)
That a frame plus a rule is enough. They reduce prompt injection; they do not remove it. #4374 adds the rule to the
managed block, and S2-2's red-team cases are the test.

### Strengths
- The read is done by the board, never the agent, so no agent holds a service key.
- Each scrub and bound fix is pinned by its own mutation.
