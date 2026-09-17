# Plan: #3224 cross-project misroute detector (observability only)

## Problem
Josh (2026-09-17): an agent on multiple projects sometimes posts a message into
the WRONG project's room. He asked whether we can add rules to prevent it.

## Triage conclusion (full detail on the card)
The misroute cannot be prevented at the Kosmos routing layer:
- `kosmos post <id>` takes a REQUIRED, exact-validated project id (no inference).
- `/api/post` routes strictly by the explicit `body.project` + a membership guard.
- The room envelope already hands the agent the project NAME + id + the exact
  `kosmos post <id>` command (#3035); #185 shipped that and its own body files the
  residual: the agent still misroutes, and the two fixes that would FORCE it
  (auto-relay the turn / fail a turn that answers without sending) live in the
  HARNESS, not Kosmos.
- The only cross-check signal, `stateProject` (#2837), is produced BY posts, so
  it is circular and cannot be an independent guard.
A hard server REFUSE-on-mismatch is rejected: no independent oracle, and
legitimate multi-project posting makes a mismatch frequently correct, so a refuse
would block valid posts (worse than the intermittent bug).

## What this PR does: MEASURE it (detection only, never blocks)
The remaining reversible, in-lane option: log a SUSPECTED misroute so we can
quantify how often + when it happens (confirms the un-reproduced premise, sizes
the harness fix).

Trigger: an agent posts to project A while it OWES an unanswered, addressed
operator question in a DIFFERENT project B. Heuristic (a member of both may post
to A legitimately while owing B) -> LOG ONLY, never refuse.

### Changes
1. `engine/messages.js`
   - `unanswered(projectId, now, afterMs?)` gains an optional age threshold
     (default = the existing 10-min constant, so existing callers are unchanged).
     The detector passes `0` to catch a FAST misroute (answered inside the nudge
     window), which the 10-min floor would hide.
   - `misrouteSuspects(sessionName, targetProjectId, now)`: pure, returns the
     other projects where this agent owes an unanswered addressed question.
   - `noteMisrouteSuspect(...)`: best-effort logs one line to a dedicated
     `misroute-suspects.jsonl` under store.ROOT when a suspect is found. Its IO
     is swallowed so an observability write can never break a post.
2. `server.js` `/api/post`: after a placed post, best-effort call the detector
   (mirrors the #2837 attribution block's posture). Project id resolution is
   hoisted so #2837 and the detector share the SAME resolved id; #2837 behavior
   is unchanged (still gated on found + working + projectId).
3. `engine/messages.misroute-3224.test.js`: suspect at any age, one-line log,
   clean-post writes nothing, same-room post is not a suspect, answered debt
   clears, empty inputs and colleague-mentions never owe, and the detector never
   leaks a row into the message record.

### Deliberately NOT done
- No refuse / no delivery change (detection only).
- A dedicated log file (not a new message-record `kind`) so the detector cannot
  perturb any existing count or render.

## Disposition of the real fix
The forcing fix is harness-level (auto-relay / fail-the-unsent-turn), documented
as the residual in the closed #185. It is out of Kosmos-fleet build scope (a
Claude Code harness capability), so it is a genuine product limitation, not a
quick fix. This detector self-generates the data to decide whether that harness
work is worth prioritizing.

## Weakest premise
Not reproduced. If a real repro shows a fourth path that carries/infers a stale
project, the layer call reopens (checked the outbox-drain replay: it keeps the
original explicit id, so it is not it).
