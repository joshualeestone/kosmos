---
pre_challenge: true
method: challenge-loop
branch: detail-header-1841
diff_hash: d4feca7c51e1a3a7ec5cb6ec73d93495019fe66321d8379021b984916ff74bef
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T14:20:16Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (a 6.0 validation baseline + five fresh, blind challenge agents)
**Converged:** Yes (iteration 6 produced zero NEW in-scope actionable findings after dedup)
**Total findings:** 3 BLOCKER-class (validation/real bugs), 2 WARNING, 8 NIT, 1 CONVENTION
**Fixed:** 7 | **Deferred:** several (all documented, out-of-scope or pre-existing) | **Asked:** 0

Card: kosmos #1841 — redesign the view-agent-detail header. Five parts, one screen
(web/index.html), plus a new browser check and the unit-test updates the redesign
required.

### Per-Iteration Breakdown

#### Iteration 1 — 6.0 validation baseline
**New findings:** the redesign broke the unit tests that pinned the old copy/structure, plus the #1387 wired gate, and surfaced a real code bug.
- [BLOCKER] validation: 5 web.*.test.js + server.test.js(2) + web.restart-confirm + tools.browser-checks-wired broke (they pinned the old stale banner / doctrine copy / meta line / restart-confirm pronouns / the check wiring) --> FIXED (ad5a1e8e). Each test updated to the new design while preserving its invariant (setLive empty-bar discipline, #863 no-dead-end, #323 don't-blame-the-person, #212 stand-alone sentence, exhaustiveness, memory-consequence).
- [BLOCKER] web/index.html renderStale: the Kosmos-vs-hand-edited split (`who === 'kosmos'`) did not match staleWords' split (`who === 'kosmos' && because`), so the header and the card badge could disagree about one agent --> FIXED (ad5a1e8e), split now byte-identical.
- [CONVENTION] tools/browser-checks.sh: the new check was not RUN by the runner (#1387) --> FIXED (ad5a1e8e), wired into the self-hosting batch (proven standalone 25/25, red against the pre-#1841 page).

#### Iteration 2 — blind reviewer 1
**New findings:** 1 WARNING, 2 NIT.
- [WARNING] the doctrine prompt (#d-doctrine-note) and the reports prompt (#d-instr-reports) could both show at once, giving two stacked near-identical rows --> FIXED (14baf0e6): the doctrine prompt supersedes (its add+restart subsumes the restart-only reports), guarded on both sides; pinned by a precedence browser assertion.
- [NIT] `rules-update` CSS class had no rule behind it --> FIXED (14baf0e6), dropped.
- [NIT] browser-check docblock said "five parts" but listed four --> FIXED (14baf0e6).

#### Iteration 3 — blind reviewer 2
**New findings:** 1 NIT.
- [NIT] staleWords `pageTail` became dead once renderStale stopped calling staleWords --> FIXED (0d257878), removed; web.instructions-copy re-anchored to the live card tail.

#### Iteration 4 — blind reviewer 3
**New findings:** 1 NIT.
- [NIT] the doctrine "Add & Restart" label set went through a bare getElementById('doc-go'), defeating the deliberate querySelector indirection the #863 comment describes --> FIXED (e89072db), routed through the modal container.

#### Iteration 5 — blind reviewer 4
**New findings:** 1 WARNING (a real code bug the earlier passes and my own check missed).
- [WARNING] Part 4's bold was keyed to post-filter position 0; roleLine returns '' for a role-less agent, so position 0 became the MODEL and the bold wrapped the model -- "bold the title only" inverted. The browser check's fixture always had a role (same blind spot as the fix) --> FIXED (29a8f893): bold keyed to the role being present; role-less arm added to BOTH the browser check and server.test.js.

#### Iteration 6 — blind reviewer 5
**New findings:** 0 NEW in-scope actionable. **Converged.**
All findings deduplicated to prior deferrals or are pre-existing / out-of-scope copy the reviewer explicitly flagged as "not introduced here."

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web.*.test.js + server.test.js | tests pinned old copy/structure | FIXED | ad5a1e8e |
| 2 | 1 | BLOCKER | web/index.html renderStale | Kosmos/hand split != staleWords | FIXED | ad5a1e8e |
| 3 | 1 | CONVENTION | tools/browser-checks.sh | new check unwired (#1387) | FIXED | ad5a1e8e |
| 4 | 2 | WARNING | web/index.html loadDoctrine/renderStale | doctrine + reports co-occurrence | FIXED | 14baf0e6 |
| 5 | 2 | NIT | web/index.html:6434 | dangling `rules-update` class | FIXED | 14baf0e6 |
| 6 | 2 | NIT | render-detail-header-1841.js | docblock five/four | FIXED | 14baf0e6 |
| 7 | 3 | NIT | web/index.html:11227 | dead `pageTail` field | FIXED | 0d257878 |
| 8 | 4 | NIT | web/index.html:19649 | stale querySelector comment | FIXED | e89072db |
| 9 | 5 | WARNING | web/index.html:17951 | role-less agent bolds the model | FIXED | 29a8f893 |

### Deferred (documented; all out-of-scope or pre-existing)
- **No branch plan file** (`.claude/plans/`): card #1841 is the self-contained spec; the build is documented inline, in commits, in the browser check, and in this proof.
- **Board card badge pronoun** (staleWords tooltip still says "it" for a Kosmos-made stale agent): its `lead` is the engine's own sentence ("Kosmos put it on X"), so an "it"-free board badge needs an engine change (Angel's lane), not this design/content card. FOLLOW-UP.
- **Model-tab / change-modal restart-consequence copy** ("It comes back with nothing in its memory..."): a separate, pack-reviewed feature, outside the header + shared restart-confirm scope of this card. FOLLOW-UP.
- **"There are" vs "These are"**: Josh's verbatim copy for the two distinct cases (made-before vs reports-to), not drift.
- **restartCost "one thing ... them/they"** singular/plural: pre-existing, not introduced by this diff.
- **reports-to "Add Instructions & Restart" opens a "Restart [name]?" confirm**: Josh's single label for both cases; the confirm is honest about what it does.

### Strengths (across iterations)
- Security improved: #d-meta moved to innerHTML but escapes every segment and bolds only the role; the doctrine/reports text escapes the agent name; the raw engine `because` is no longer rendered on the detail surface at all (injection surface shrank), pinned by the banner tests.
- The Kosmos-vs-hand split is byte-identical to staleWords, so the card badge and the detail surface cannot disagree; renderStale's five arms are provably mutually exclusive (every non-kosmos arm hides reports; kosmos hides the header via setLive).
- Part 3 (#d-why suppression) is provably lossless: taskLine quotes `because` into the always-shown top line when reported, so the lower line is a true duplicate; empty `because` hides regardless.
- The role-bold fix is guarded three ways (unit no-<b> + model-renders control, browser-check role-less arm through real openDetail).
- The new browser check drives the real painters against a real in-process server, carries real controls in both directions, is wired into tools/browser-checks.sh + README-listed, and documents a RED run against the pre-#1841 page. No em dashes in any added copy (all five spellings checked).
