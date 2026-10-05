---
pre_challenge: true
method: challenge-loop
branch: community-refresh-5297
diff_hash: 410c8ff161cf3244e9b5a76e5e89d516e31e96b5f024c084b2f4425cd52def67
validation: pending (focused 730/730 incl. the file-scanning guards on the rebased head f5166d668; full suite queued on Mortals and PR CI, merge waits on both)
subdir_audit: not run (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-05T16:43:33Z
iterations: 18
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 18 (converged at 10; reopened at 11 when Splinter's 11:16 and 11:37 calls changed the code; converged again at 18)
**Converged:** Yes (iteration 18: three WARNINGs, each DEFERRED with reasoning below; no new actionable finding)
**Total findings:** 1 BLOCKER, 26 WARNINGs, 4 CONVENTIONs, about 30 NITs
**Fixed:** all BLOCKER/WARNING findings except those recorded DEFERRED below | **Asked (awaiting user):** 0

Reviewer models alternated: odd iterations opus (default), even iterations sonnet. Scope widened mid-loop (Splinter 10:12:
#4890's running-agent half), so iterations 2-10 reviewed the wider change. Validation deviation, stated at the start: the
full suite runs on the shared Mortals queue and in PR CI, not inline per iteration; focused tests plus the repo's
file-scanning guards ran after every fix round, and every new rule was perturbation-checked (red when removed).
Self-generated (6c-bis) counts were not measured by blame; recorded as not measured rather than guessed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** not measured
- [WARNING] server.js re-read line sent once, lost on refusal --> FIXED (owed on disk, retried)
- [WARNING] server.js comment said "held" for a dropped line --> FIXED
- [WARNING] engine/communityblock.js intro line flapping read as a rules change --> FIXED (rulesChanged)
- [WARNING] engine/communityturn.js long prompt-woken turn counted as work --> FIXED
- [CONVENTION] engine/remove.js, engine/projects.js stale "birth and restart only" comments --> FIXED; communityswitch.js:8 DEFERRED (still true)
- [NIT] live execution per send; add race (onlyIfPresent); countWord; regex; "today" wording --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** not measured
- [WARNING] server.js empty or unreadable roster cleared every debt --> FIXED
- [WARNING] a restarted agent still told its file changed --> FIXED (startedSince)
- [WARNING] same-section re-owe lost in the merge --> FIXED (per-owe counter n)
- [WARNING] engine/communityturn.js agents without reports only prompted by the floor --> DEFERRED: intended, fails toward fewer prompts
- [WARNING] engine/communityblock.js before/after read race --> FIXED (compare composed body)
- [CONVENTION] engine/communityblock.js reflowed header line --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** not measured
- [BLOCKER] server.js re-read line typed into any agent, so a permission prompt or question could take its default --> FIXED (idle at two passes; behavioural test; perturbation red)
- [WARNING] unreached prompt swallowed the next real turn --> FIXED
- [WARNING] pass covered only by source regexes --> FIXED (passOnce extracted, behavioural tests)
- [WARNING] size-limit fallback coupling --> FIXED (withBody)
- [NIT] use f.start/f.end; expiry while paused; "at once" claim; communityswitch comment --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** not measured
- [WARNING] timing comments said one pass, code needs two --> FIXED
- [WARNING] boot glue only regex-tested --> FIXED (oweChanged, tested)
- [WARNING] 'started' premise unnamed --> FIXED (named in the plan)
- [CONVENTION] plan Changes section stale --> FIXED

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** not measured
- [WARNING] 'started' and re-read-woken turns counted as work --> FIXED (sent log, kosmosLines)
- [WARNING] stale idle reading across awaited sends --> FIXED (fresh roster before typing)
- [WARNING] operator brake not honoured --> FIXED (nudgeEnabled)
- [CONVENTION] plan Changes items 1-2 --> FIXED
- [NIT] history() duplicates read()'s tail reader --> DEFERRED: refactoring a stable reader for no behaviour change
- [NIT] gone on one missing roster; boot write failure unlogged --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured
- [WARNING] re-read send stamped after delivery --> FIXED (stamped before, 60 s slack)
- [WARNING] posting turn cut at 15 min --> FIXED (runs to the next idle report)
- [NIT] boot write when nothing changed; single-writer note; UNCONFIRMED note --> FIXED

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** not measured
- [WARNING] restart between two owes ended the newer one --> FIXED (`last`)
- [WARNING] a throw from deliver re-typed the line --> FIXED (throw counts as reached)
- [WARNING] stood-down agents woken --> FIXED (held)
- [NIT] postedBy per agent at boot --> DEFERRED: agents x posts, small today

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not measured
- [WARNING] other Kosmos nudges' turns read as work --> DEFERRED (stated in the comment; bounded by PROMPTS_PER_DAY)
- [WARNING] cut history swallowed real work --> FIXED (truncated history is unknown)
- [WARNING] corrupt debt file replaced at boot --> FIXED (readOwedStrict)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** not measured
- [WARNING] Prompter switch not honoured; hourly limit not counted --> FIXED (Prompter); hourly limit DEFERRED (at most one line per agent per change)
- [WARNING] community re-read sent with Community switched off --> FIXED (sectionOn holds it)
- [NIT] rewrite every pass; log noise; header shape; tail coverage; GIVE_UP from first owe --> FIXED or recorded in the plan

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** not measured
**Converged**: no new actionable findings.


### Reopened after convergence (Splinter 11:16: add the block to agents that never had one; 11:37: connected agents refreshed only)

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** not measured
- [WARNING] engine/remove.js stale "only place it is added" comment --> FIXED
- [WARNING] plan Changes/Decided contradict the add --> FIXED
- [CONVENTION] engine/communityblock.js unused onlyIfPresent --> FIXED (removed; restored for connected agents at 17)
- [NIT] a folderless agent reported as the siblings do; re-read wording for a new section --> FIXED

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not measured
- [WARNING] postedBy per agent at boot --> FIXED (one postTimesAll read)
- [WARNING] two spellings of the Community gate --> FIXED
- [WARNING] .previous rotation; cut history and startedSince --> DEFERRED (recorded in the plan)

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not measured
- [WARNING] a switched-off section held the whole debt --> FIXED (per section)
- [WARNING] the Prompter gated the person's consented rules line --> FIXED (Prompter gates community only)

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not measured
- [WARNING] rules line says "updated" for a first add --> FIXED ("added or updated")
- [WARNING] first-boot burst --> DEFERRED (decided; paced by the idle gate)
- [WARNING] prompt tries lost on restart --> DEFERRED: not a defect, the book is on disk (communityturn.readBook)

#### Iteration 15
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** not measured
- [WARNING] give-up from the first owe dropped a late rules line --> FIXED (from the latest owe)
- [WARNING] the add reaches connected agents --> resolved by Splinter's 11:37 call (refresh only)

#### Iteration 16
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not measured
- [WARNING] hourly limit --> DEFERRED (duplicate of iteration 9's decision)
- [WARNING] two automatic lines back to back --> DEFERRED (benign; chat serialises per pane)
- [WARNING] no intro for an added agent when the store is unreadable --> DEFERRED (the safe direction)

#### Iteration 17
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 2 CONVENTIONs, 5 NITs
**Self-generated:** not measured
- [WARNING] a connected agent could be added to if the block vanished between reads --> FIXED (onlyIfPresent at write time)
- [CONVENTION] header and plan omit the connected exception --> FIXED
- [NIT] pass-end write must not replace an unreadable debt file --> FIXED

#### Iteration 18
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not measured
- [WARNING] engine/communityturn.js a post made while idle masks the next turn --> DEFERRED: one missed prompt, the decided direction (fewer prompts), the floor still applies
- [WARNING] engine/communityblock.js refreshing a connected agent's file leaves a diff --> DEFERRED: Splinter's 11:37 call (refresh when it already carries the block)
- [WARNING] engine/communityblock.js connected() reads "..x" as outside --> DEFERRED: unreachable (nameUsable refuses ".."), and it fails toward no add
**Converged**: no new actionable findings.

### Final Ledger (summary)

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 3 | BLOCKER | server.js | BRANCH | line typed into a non-idle agent | FIXED | passOnce idle gate |
| 2 | 1 | WARNING | server.js | BRANCH | re-read line lost on refusal | FIXED | on-disk debt |
| 3 | 2 | WARNING | engine/communityturn.js | BRANCH | no-report runners floor-only | DEFERRED | intended |
| 4 | 8 | WARNING | engine/communityturn.js | BRANCH | other nudges read as work | DEFERRED | bounded, stated |
| 5 | 9 | WARNING | server.js | BRANCH | hourly limit not counted | DEFERRED | one line per change |
| 6 | 1-9 | WARNING | various | BRANCH | the remaining 21 warnings above | FIXED | per iteration |

### NITs (open, non-blocking)
- startedSince premise for Gemini/Grok resume (plan names it); sectionOn reads communitysend.switchOn while the refresh reads communityswitch.participating (same switch); a cut tail with no newline is skipped by JSON.parse (iteration 10)

### Strengths (across iterations)
- The working rules stay person-owned: only a consented doctrine.refresh owes a re-read; nothing rewrites them silently.
- The re-read line can never answer a prompt for the person: idle at two passes, re-checked just before typing, stood-down and switched-off held, every gate the sibling lines use.
- The prompt and the block read one set of numbers (FLOORS, MIN_WORDS), ending "the prompt says six, the instructions say one".
