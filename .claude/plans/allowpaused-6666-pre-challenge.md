---
pre_challenge: true
method: challenge-loop
branch: allowpaused-6666
diff_hash: ca1986c19044856853f92672577b1a754dafad548166b2c3e0b31f3b91ba39a0
validation: passed (Mortals, 2026-10-21T20:58:28Z)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-22T15:36:35Z
iterations: 11
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 11. **Converged:** yes, at iteration 11 (no BLOCKER, WARNING or CONVENTION; NITs only). The reasoning
for every decision is in .claude/plans/allowpaused-6666.md ("Review round" 1 to 10). The plan does not record which
model reviewed each round, so no model is named below rather than one guessed. Severity labels come from the plan:
a behaviour defect counts as a WARNING, a sentence that promised something false as a WARNING too (it is what the
person reads), and a stated limit as no finding.

**Total findings:** 0 BLOCKERs, 12 WARNINGs, NITs in round 11.
**Fixed:** 12 WARNINGs | **Stated, not changed:** 3 limits (rounds 3, 4 and 8) | **Asked:** 0

Mutants, each red: the freshness gate removed; a paused vouch refusal counted as a try. Browser check
render-plus-paused-6666.js at 1400 and 390, every arm with its control, passed on 9f0de20145 (queue turn at 13:31
CDT); the two surface-mapped checks that share its token passed on this branch (14:18 CDT).

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] a stale pending.json (stopped tunnel, slept Mac) kept saying paused --> FIXED (66cbbe880d: paused counts only from a snapshot under 2 minutes old; arm and mutant)
- [WARNING] the vouch path had no test while paused --> FIXED (66cbbe880d: FAKE_TUNNEL_MODE=allow-paused arm)

#### Iteration 2
- [WARNING] the snapshot's age could be paired with a newer read --> FIXED (5bfbe34bee: age taken before the read)
- [WARNING] a paused vouch refusal was counted as a try and could end the secret --> FIXED (5bfbe34bee: not counted; mutant red)
- [WARNING] the Plus-off early return had no `paused` field --> FIXED (5bfbe34bee)

#### Iteration 3
- [WARNING] nothing exercised the page --> FIXED (4cdbaafa50: render-plus-paused-6666.js with controls)
- [WARNING] the line left out computers, whose rows the tunnel also withholds --> FIXED (4cdbaafa50)
- [WARNING] a future mtime counted as fresh --> FIXED (4cdbaafa50: more than 1 s ahead is not fresh)
- Stated, not changed: an Allow pressed just before a pause shows the refusal words until the next poll (about 5 s).

#### Iteration 4
- [WARNING] the line said "There is nothing to do" while code-check rows can still show --> FIXED (232951716f)
- Stated, not changed: the line goes 2 minutes after the tunnel stops rewriting pending.json (the staleness rule).

#### Iteration 5
- [WARNING] the line promised a request waits and shows again; the coordinator may drop it --> FIXED (fbf04dcfa4)

#### Iteration 6
- [WARNING] the Allow refusal made the same promise --> FIXED (4989d5475d)

#### Iteration 7
- [WARNING] round 6's "nothing can be allowed" was false: a code re-check is confirmed before the paused refusal --> FIXED (e9f8ca310a: the line speaks of new devices only; I had written the claim without reading the tunnel's source)

#### Iteration 8
- Stated, not changed: a failed poll keeps the last paint, the rule every card on the page follows (4738b05c55).

#### Iteration 9
- [WARNING] copies of the round-7 claim survived in the refusal words, its test and the check header --> FIXED (d2325e1050: the whole diff swept; stronger "both" and off-Plus controls)

#### Iteration 10
- [WARNING] nothing pressed Allow while paused, the click path the card is named for --> FIXED (9f0de20145: the check presses Allow and requires the paused words, never "connected")

#### Iteration 11
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, NITs only
**Converged** - no new actionable findings.

### Final Ledger

Build 9ad06bd27d and db09f0966a; fix commits 66cbbe880d, 5bfbe34bee, 4cdbaafa50, 232951716f, fbf04dcfa4,
4989d5475d, e9f8ca310a, d2325e1050, 9f0de20145; plan records bdd8230a80, 33f04b8e51, 4738b05c55; after convergence,
61e19364cc (the check wired into gated.txt and the README, caught by the static set) and 2cea1ed7db (surface
trailers, both checks run).

### NITs (non-blocking)
- Round 11's NITs are left as they are; none changes what the person sees.

### Strengths
- Every sentence the person reads was checked against what the tunnel and coordinator actually do, and corrected
  where it promised more.
- The browser check presses the real button while paused, with a control for each arm.
- A paused refusal never spends the vouch secret, so a pause cannot lock a browser out for good.
