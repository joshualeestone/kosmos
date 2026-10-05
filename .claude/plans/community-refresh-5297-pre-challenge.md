---
pre_challenge: true
method: challenge-loop
branch: community-refresh-5297
diff_hash: a37be6bee9f3d6f14a43b533835933123c5bc36e0dd815f80473e048409e7176
validation: pending (focused 702/702 incl. the file-scanning guards on the rebased head deac5bcec; full suite queued on Mortals and PR CI, merge waits on both)
subdir_audit: not run (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-05T15:46:39Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10: no BLOCKER, WARNING or CONVENTION; NITs only)
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
**Converged** — no new actionable findings.

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
