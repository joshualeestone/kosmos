---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: beat-1502
diff_hash: d7f660a2d24617d3eb2d8f5b804cda8de8922f1c5afb9eaa243f2933dbfa75a9
subdir_audit: passed
timestamp: 2026-08-29T19:01:04Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24, push as ready). Bracketed markers because
the template's own heading is refused by this gate, my #1458.

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] THIS DOES NOT MAKE AN IDLE PANELESS AGENT VISIBLE**, and I would
  rather say it than have somebody discover it. An agent that reports `idle` and
  then genuinely says nothing sends no beat and goes stale in 180s. That is
  correct for a dead process and wrong for a quiet one, and **nothing here can
  tell those apart.** The runner needs a real beat loop. Named on the card.
- **[WARNING] RAISING `STALE_AFTER_MS` WEAKENS "GONE" DETECTION** from 35s to
  180s. **No regression is possible today** because nothing ever wrote a beat, so
  the field has only ever answered `null`. But the moment a beat loop lands, 180s
  is three minutes of believing a dead agent is alive. **Re-derive it from the
  loop's interval when the loop exists; do not inherit this number.**
- **[WARNING] NO PANELESS AGENT EXISTS ON THIS MACHINE TO TRY IT ON.** The unit
  tests cover the roster and the route. **Nobody has watched a real paneless agent
  appear**, and that is the same end-to-end gap #1112 phase 1 already carried.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep 0, planted control 1.
- **[CONVENTION]** No closing keyword. #1502's fix is here; #1112 phase 1's
  done-condition ("proven against a fake agent") is arguably now met, but a
  person should decide that, not a commit message.

### NITs

- **[NIT]** The guard lives at the repo root rather than beside the engine,
  because it asserts across `server.js` AND `web/index.html` and belongs to
  neither.

### Attacked and CLEARED

- **PERTURBED THREE ARMS**, each failing its own test. Restores sha-verified.
- **⭐ AND ONE PERTURBATION WAS A BAD INSTRUMENT AND READ GREEN**, which is worth
  more than the two that worked: I replaced `accountDir` with
  `accountDirX_REMOVED`, **which still contains `accountDir`.** The guard was
  fine; my test of the guard was not, and it reported the reassuring answer.
  Redone with a real removal (2 occurrences) and it fired.
- **THE BLANKET GUARD WAS MEASURED AND REJECTED BEFORE BUILDING**, not after.
  315 of 643 engine exports look unwired; 150 of 462 narrowed to functions.
  Nearly all legitimate. **A guard with 150 false findings is dismissed in a
  week**, and building it would have cost a day and protected nothing.
- **THE EXISTING liveness TEST WENT RED AND ITS MESSAGE NAMED THE WRONG PREMISE
  VERBATIM** ("three beats of agent-supervisor.sh's 10s loop"). Restated rather
  than renumbered, so the reason travels with the number.
- **THE SUPERVISOR WAS RULED OUT AS THE BEATER BY STRUCTURE, NOT BY GREP:** it
  runs per tmux session and `panelessKeys` skips every key that HAS a pane, so a
  supervisor beat could only ever have covered agents that were already listed.
- **Suite 2958 pass, 0 fail** (2955 before, plus these three).

### The measurement that started it

The liveness directory had **never been created** on a machine that has run
Kosmos for a week. Control: `store.ROOT` held 20 entries, so the read worked.
