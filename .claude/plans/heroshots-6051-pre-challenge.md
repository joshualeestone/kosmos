---
pre_challenge: true
method: challenge-loop
branch: heroshots-6051
diff_hash: 6163a6f38afbd50d5a870a223ec4038ec169d049635ef553c0cffc9617ec395d
validation: failed on one line, fixed in d59613eec8 and run alone (7/7); full suite not re-queued
subdir_audit: passed
timestamp: 2026-10-13T17:21:04Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 raised NITs only)
**Fixed:** every BLOCKER and WARNING raised | **Deferred:** 3 with measured evidence | **Asked:** 0

⚠️ **Provenance of this record.** The loop ran across a restart: the session that ran rounds 1 to 6
wrote its ledger into the restart handoff (Kosmos handoffs/monalisa.md, section 1), and this proof is
written from that record by the session after the restart. Round-level findings are below as the
handoff records them; per-finding commit refs are the round commits named there.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus or sonnet (alternating; per-round model not recorded in the handoff)
- [BLOCKER] docs/browser-checks/mobile-shots.js: marketing busy rows did not match the engine's real shape --> FIXED (round 1 commit)

#### Iteration 2
**Reviewer model:** alternate of iteration 1
- [WARNING] mobile-shots.js: Claude rows' limit and assumed flag hand-written --> FIXED: taken from engine/status.js limitFor (new export); tokens scaled so rings match what is live
- [WARNING] mobile-shots.js: overCeiling computed from scaled values --> FIXED: from raw
- [WARNING] mobile-shots.js: busy without connected --> FIXED: busy requires connected
- [WARNING] mobile-shots.js: a busy agent never matched passed silently --> FIXED: run fails (exit 2) when a busy agent is never matched or its community line cannot show; control proved it fires

#### Iteration 3
- [BLOCKER] community switch off makes every run fail --> DEFERRED by measurement: the real marketing run on 1528ac0 exited 0 and every card shows its community line
- [WARNING] idle-card planned model --> DEFERRED: captures show models
- [WARNING] walk breadth --> DEFERRED: deliberate scope

#### Iteration 4
- [BLOCKER] Ravi (Meta Muse) drew a 13% memory ring the app never gives Muse --> FIXED b37e5b2864 / 20a2637de5: muse row takes the engine's no-reading shape, Gemini assumed, row limit checks; Muse card reads "Meta Muse" not the sandbox's seeded Sonnet; limit checks after startBoard (the leak guard refuses status.js before the sandbox)

#### Iteration 5
- [WARNING] Gemini window and plannedModelName --> FIXED d48651ee7d: engine's 1048576, plannedModelName set, named condition

#### Iteration 6
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, NITs only
**Converged.**

### Final validation (6j)
Full validation on d48651ee7d: 19858 pass, 1 fail, 235 skipped. The one failure was
browser-checks-reason-grep.test.js: mobile-shots.js has 4 finding-emit sites (the new unmatched
busy-agent FAIL from iteration 2) and its SITE_COUNTS line said 3. Fixed deliberately in d59613eec8;
the file then passes alone (7/7). The failing full run is the control that the guard can go red.
The full suite was not re-queued for a one-line count change (the queue held 5 runs); CI runs the
suite on the PR.

### NITs (non-blocking)
- [NIT] mobile-shots.js: Eli's codex ceiling 400000 is GPT 5.2's advertised window, not "the window codex reports" as its comment says; harmless to the shot, follow-up (iteration 6)

### Strengths
- The shots take their numbers from the engine's own functions rather than a second hand-kept copy (iteration 2 onward)
- A run that cannot show what its busy table claims fails loudly instead of shipping a wrong picture (iteration 2)
