---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0721
diff_hash: fd6cf4dc0f1219eb6c6aad0a78cc82c528db0fa3335d9f74b03f253cf92a68cf
subdir_audit: passed
timestamp: 2026-10-03T11:28:47Z
converged: true
---

## Challenge loop: 6 blind rounds (sonnet); converged at round 5, then round 6 on the folded final line 1 (converged)

Ledger: `.claude/plans/whatsnew-0721.md` (every finding and the code lines it rests on).

## [WARNING] Round 1 (candidate lines vs PR diffs)
4 warnings taken: #5093, #5104 and #5116 now use the app's own words; #5108 overclaimed "never your files" (a prompt
instruction only), now "are told to leave out".

## [WARNING] Round 2 (the five file lines vs main)
2 warnings taken: line 1 narrowed to Claude/OpenAI and said "start" (the refusals cover Gemini/Grok; the case is
creating an agent); line 2 said "a new agent" (the boot sweep refreshes existing agents too).

## [WARNING] Round 3
Line 2 read as a guarantee (fallbacks leave an agent in English): now "agents are now told your language". Line 1 NIT:
a Gemini/Grok create with no account is not refused, so the line became conditional on a refusal.

## [WARNING] Round 4
Line 1 "missing" covered the stale-account-folder refusal, which names no Settings page: now "has no working sign-in
or key". NIT left: line 2 "agents" unqualified.

## [NIT] Round 5
CONVERGED: each no-working-sign-in-or-key refusal names Settings, AI Models (create.js 3937-3940, 3966-3967,
4018-4019, 4035, 4062-4063, 4094); "Accounts tab" appears 0 times. NIT routed to Mona: create.js 4873.

## [NIT] Round 6 (final line 1 after #5127/#5128/#5138 merged)
CONVERGED: no user-facing copy still names a nonexistent place (the remaining "Accounts tab"/"Terminal tab" hits are
comments and fixtures); "AI Settings" and "AI Models" are the real labels. NIT taken: the narrower line. Slot 5
swapped to #5093's round-1-reviewed line; its quoted text verified in the coordinator (signin.html:1915).

## Checks
tools/whats-new-check.js 0.7.21: 5 highlights, each at most 140 characters; no em dash in any spelling.
