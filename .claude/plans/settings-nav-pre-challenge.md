---
pre_challenge: true
method: challenge-loop
branch: settings-nav
diff_hash: c62b22eb322e39e166b0026e425fdb8f7fe504cbe252d8025fb279b8eb626835
subdir_audit: passed
timestamp: 2026-08-23T16:44:41Z
iterations: 2
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** No (bounded at two rounds before the loop started, per the
agent-page-nav lesson: on this file the rule "iterate until a round finds
nothing" has no floor; see that branch's proof)
**Total findings:** 20 (0 BLOCKERs, 7 WARNINGs, 5 CONVENTIONs, 5 NITs, plus 3 STRENGTHs per round)
**Fixed:** 17 | **Deferred:** 0

### Why two rounds were enough here

The structural work is a copy of the agent page's (reviewed twelve times
this morning), the boxes moved with ids intact, and every browser check that
opens Settings was swept by grep before round one. What the rounds found was
in the one new piece, the Your name field, and both rounds found real things
there: a success sentence that promised a mechanism that does not exist, and
one that said "your agents have been told" when only running, tied agents
were reached.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 3 WARNINGs, 4 CONVENTIONs, 3 NITs
- [WARNING] web/index.html save sentence — promised agents "learn it when they next start", which nothing does; discarded each verdict's agent and reason --> FIXED (627ae62: names each miss with the engine's sentence, no promise)
- [WARNING] web/index.html paintYouName — a transient failure's sentence survived a later good read --> FIXED (cleared on a good read)
- [WARNING] web/index.html CSS — the name field wore the first-run form's dress inside a k-surface box; the agent page's overrides did not reach #panel-settings --> FIXED (the same rules, both panels)
- [CONVENTION] "detailGo is the ONLY writer of .dsec[hidden]" now false --> FIXED (scoped to the panel)
- [CONVENTION] nav comment named a `sectionGo` that does not exist --> FIXED
- [CONVENTION] "pack ground with dhead + dgrid" described a deleted rule --> FIXED
- [CONVENTION] the moved Keeping-agents comment carried an em dash --> FIXED
- [NIT] the never-chooses test had no presence control --> FIXED
- [NIT] browser check's label claimed more than `/^Saved\./` proved --> FIXED (exact sentence, then superseded in round 2)
- [NIT] section persistence across tab visits undocumented --> FIXED (comment)

#### Iteration 2
**New findings:** 4 WARNINGs, 1 CONVENTION, 2 NITs (all in the name field and its check)
- [WARNING] hint said "the top of the org chart", which the hub never draws --> FIXED (1b5b299: clause dropped)
- [WARNING] a miss read out the machine name --> FIXED (route attaches `shownAs` from the roster, like the removal route; page reads it)
- [WARNING] "Your agents have been told" when `told` was empty or partial --> FIXED (counted: "Told N running agents" / "No agent was running to tell")
- [WARNING] browser check's told-assertion could not fail --> FIXED (reads the fixture agent's file for the new name)
- [CONVENTION] comment said "Saved." is gone by repaint; it was kept --> FIXED (repaint clears it, comment says why)
- [NIT] agent-panel banner comment still said dgrid --> FIXED
- [NIT] restore save waited blind --> FIXED (waits for its sentence)

### Final Ledger
No deferred findings.

### Strengths (across both rounds)
- The name-only save carries `does` and `know` whole and refuses on screen with no record, matching `you.save`'s contract; pinned by text test and proven against a sandboxed record in the browser
- Sections wrap the existing boxes with ids intact, so every painter works unchanged and no Settings painter measures layout
- Every Settings-opening browser check was swept in one pass; the new check leads with a control and measures by rectangle
- The text test carries a presence control before its absence assertions
