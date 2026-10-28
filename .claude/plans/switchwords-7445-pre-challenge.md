---
pre_challenge: true
method: challenge-loop
branch: switchwords-7445
diff_hash: e38dfcd318c9d8c66ea12158db1341f49a6d61c6c7a25a03d0d872c1819de1f0
validation: switchwords 11/11, web switchwords 6/6, switch-family-7410 6/6, switchmem-7410 31/31, create.test 127 pass; policy tests green
subdir_audit: passed
timestamp: 2026-10-28T06:06:33Z
iterations: 5
converged: true
---

# Pre-PR review proof: switchwords-7445

**Iterations:** 5
**Converged:** Yes. The last round found no BLOCKER; anything it raised is recorded below.
**Per-round record:** .claude/plans/switchwords-7445.md

## Rounds

#### Iteration 1
- Round 1: no blockers. [WARNING] dialog said "Notes in its folder stay" to an agent with none while the result named none --> FIXED ("Any notes", between and to-Claude; #7410 test updated deliberately); [NIT] OpenAI <-> Qwen reasoning is Mac-only (Windows CODEX_HOME is the account folder) --> FIXED (comments at REFUSE_QWEN_WIN32 and both twins, weakest point rewritten); [NIT] forAgent(x) === forAgent(x) proved nothing --> FIXED (dropped, supervisor lines cited); [NIT] web test restated the alibaba fold --> FIXED (reads engine providerRunner); [NIT] missing space in `?'The notes` --> FIXED; [NIT] person-like fixture name in the new web test --> FIXED ('Helper'); [NIT] a carry that throws said everything stays --> FIXED (setProvider falls back to lostConversationCarried, the one base shape carryClaudeNotes also starts from; new test stubs backupsessions.ownedClaudeMemory to throw, red on the round 0 commit). An off-Claude throw reads "It had no saved notes to copy", which may be untrue; the conversation wording is right, the notes clause is the residual.

#### Iteration 2
- Round 2: no blockers. [WARNING] a carry that threw on a switch off Claude said "It had no saved notes to copy", maybe untrue (review 3 rule) --> FIXED (notes 'unchecked-error', its own sentence; the whole sentence asserted, red on 85337e54ef); [NIT] dialog "stay there for it to read" promised a pointer that can fail --> FIXED ("Any notes in its folder stay there", between and to-Claude; both tests updated); [NIT] plan counts and quoted dialog words stale --> FIXED.

#### Iteration 3
- Round 3: no blockers. [WARNING] the throw fallback read jobProvider again, so a throw in it (isQwenHome / vendorOfName) left carried null and "Everything it knows ... stays" --> FIXED (the provider it leaves is read once, floored at its runner's provider, and passed to both; new test stubs qwenaccounts.isQwenHome, red on b62e51d47b); [NIT] unchecked-error sentence true only because every copy step catches --> FIXED (comment); [NIT] plan did not say Codex is never resumed --> FIXED (evidence point); [NIT] source-regex check in the new web test --> FIXED (dropped; #7410 file has the behavioural test). server.js "could not start it again" branch left for the coordinator's own card.

#### Iteration 4
- Round 4: no blockers. [WARNING] the round 3 floor made a throwing read on a DeepSeek agent look like Claude, so DeepSeek -> Claude said everything stays --> FIXED (setProvider reads the provider it leaves once, before anything is written, holds it as `leaving`, and the vendor/Qwen record and the carry and its fallback all use it; no second read, no floor; round 3 test now asserts no second read; new DeepSeek -> Claude test stubs anthropiccompat.vendorOfName; both red on b62e51d47b and 7ffea55935); [WARNING] "no runner here keeps notes of its own" was false for Gemini (save_memory into its account home) --> FIXED (every switch leaving a non-Claude runner says "Any notes X saved for it stay behind with X." in dialog and result, kept in lockstep and tested per pair; comment and Shape paragraph corrected with per-runner findings); [NIT] forAgent basename assertion --> FIXED (dropped, citation kept); [NIT] mem.files || [] --> FIXED; [NIT] crossesFamily header --> FIXED.


#### Iteration 5
- Round 5: converged, no blocker, no warning. 4 nits: [NIT] setProvider comment said jobProvider always answers --> FIXED (a throw there refuses the switch before anything is written); [NIT] "stay behind with X" named the provider twice, clumsy for Antigravity --> FIXED ("Any notes X saved for it stay behind there.", engine and page in lockstep, tests updated); [NIT] "still where Claude keeps them" for a DeepSeek agent --> RECORDED, left (matches the existing failed sentence); [NIT] the round 3 no-second-read assertion is redundant --> RECORDED, left (harmless).

### Final Ledger
# Challenge ledger: #7445 (switchwords-7445)

Blind review rounds on the branch. Build commit 6a98663bf0; fixes in 85337e54ef (r1), b62e51d47b (r2), 7ffea55935 (r3),
8ed2ac7c7b (r4), and the round 5 nit commit.

## Round 1 (no blockers)
- [WARNING] Dialog told an agent that was never on Claude "Notes in its folder stay there for it to read" while the result named none. FIXED: "Any notes ...", between and to-Claude; #7410 test updated deliberately.
- [NIT] OpenAI <-> Qwen keeping the conversation is Mac-only reasoning (Windows CODEX_HOME is the account folder). FIXED: comments at REFUSE_QWEN_WIN32 and both twins; plan weakest point rewritten.
- [NIT] forAgent(x) === forAgent(x) proved nothing. FIXED: dropped, supervisor lines cited.
- [NIT] Web test restated the alibaba -> openai fold. FIXED: reads engine providerRunner.
- [NIT] Missing space in `?'The notes`. FIXED.
- [NIT] Person-like fixture name in the new web test. FIXED: 'Helper'.
- [NIT] A carry that throws left carried null, so the result said everything stays. FIXED: fallback to lostConversationCarried; test stubs backupsessions.ownedClaudeMemory, red on 6a98663bf0.

## Round 2 (no blockers)
- [WARNING] Off-Claude throw fallback said "It had no saved notes to copy", maybe untrue. FIXED: notes 'unchecked-error' with its own sentence; whole sentence asserted, red on 85337e54ef.
- [NIT] Dialog "stay there for it to read" promised a pointer whose write can fail. FIXED: "Any notes in its folder stay there"; both tests updated.
- [NIT] Plan counts and quoted words stale. FIXED.

## Round 3 (no blockers)
- [WARNING] Throw fallback read jobProvider again; a throw there left carried null. FIXED: read once with a runner floor (superseded in round 4); test stubs qwenaccounts.isQwenHome, red on b62e51d47b.
- [NIT] 'unchecked-error' sentence true only because every copy step catches its own errors. FIXED: comment.
- [NIT] Plan did not say Codex is never resumed on a Mac. FIXED: evidence point.
- [NIT] Source-regex check in the new web test. FIXED: dropped.
- server.js "could not start it again" branch: left for the coordinator's own card.

## Round 4 (no blockers)
- [WARNING] The round 3 floor made a DeepSeek agent's throwing read look like Claude, so DeepSeek -> Claude said everything stays. FIXED: setProvider reads the provider it leaves once before any write and holds it (`leaving`); DeepSeek -> Claude test stubs anthropiccompat.vendorOfName; red on b62e51d47b and 7ffea55935.
- [WARNING] "No runner here keeps notes of its own" false for Gemini (save_memory into its account home). FIXED: every switch leaving a non-Claude runner says its own notes stay behind ("any"), dialog and result in lockstep, per-pair test; per-runner findings in the plan.
- [NIT] forAgent basename assertion. FIXED: dropped.
- [NIT] mem.files || []. FIXED.
- [NIT] crossesFamily header. FIXED.

## Round 5 (converged: no blocker, no warning)
- [NIT] setProvider comment said jobProvider always answers. FIXED: a throw there refuses the switch before anything is written.
- [NIT] "stay behind with X" named the provider twice (clumsy for Antigravity). FIXED: "Any notes X saved for it stay behind there."
- [NIT] "still where Claude keeps them" for a DeepSeek agent. RECORDED, left: matches the existing 'failed' sentence.
- [NIT] Round 3 no-second-read assertion redundant. RECORDED, left: harmless.
