---
pre_challenge: true
method: challenge-loop
branch: swarm-ui-3564
diff_hash: 5950eff666afa2a4d27a0f8d6395859e007f228aa016b2dbd7e6a64c4f98b2f0
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T18:21:42Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes (iteration 8 had nothing at WARNING or above)

## Challenge loop (blind reviewers, alternating models)

Iterations 1 to 6 ran on the previous account (handoff monalisa-night-1102); 7 and 8 in this session, after main
was merged in again (b9f0033df: the three check registries, EXPECTED_SITES measured at 155 by the reason-grep test).

#### Iteration 1 (opus)
- [WARNING] The engine never sent the `swarms` flag. Fixed: the UI also turns on from a `swarm` key on rows; Renet then added `"swarms": true` (3285c928).
- [WARNING] A change answer replaced the swarm field and blanked Today and the circles. Fixed: the answer is merged into the latest status row. S11 checks it.
- [WARNING] Stop now said Stopped when it did not take. Fixed: it shows the engine's reason. S14 checks it.
- [WARNING] Stop now was off while Paused with helpers running, and the limit could not be raised. Fixed: Stop now stays while helpers work (S12), and there is a limit slider (S13).
- [WARNING] The provider picker still worked for a Swarm. Fixed: a swarm sends no provider, model or account (S4, S4b).

#### Iteration 2 (sonnet)
- [BLOCKER] SWARM_BUSY and the message line were shared across swarms, so an answer could land on another swarm's page. Fixed: busy state is keyed by session, with a still() guard. S16 checks it.

#### Iteration 3 (opus)
- [BLOCKER] Members On/Off opened the swarm's page. Fixed: the `#pj-one-agents` listener ignores `.swmini`, and S9 asserts the view stays on the project.
- [WARNING] The limit slider rounded and misread a missing limit. Fixed: the exact value is shown, the slider widens, and the row is hidden when there is no limit (S13b).
- [WARNING] Sliders had no aria-valuetext. Fixed on all four.
- NITs fixed: the bar uses --ok, and row clusters are aria-hidden.

#### Iteration 4 (sonnet)
No BLOCKER or WARNING. Two NITs left as they are: the Daily limit label stays visible when there is no limit, and On/Off uses aria-pressed buttons.

#### Iteration 5 (sonnet, the isolation fix 594206479)
No BLOCKER or WARNING. Every swarm read checks `typeof SWARMS_ON` and `hasOwnProperty` first. A Proxy that throws on unlisted reads was run with the flag undefined, false and true, and nothing threw.

## Full-suite fixes after convergence
- Lifted functions (face, pjMember) referenced SWARMS_ON, and the fleet fixture throws on a `swarm` read: guarded (594206479).
- web.found-scale.test.js reads the first document input listener: the swarm listeners moved to body. The swarm check still passes 29/29.

## Validation
render-swarm-ui-3564: 29/29. The negative controls are listed in the PR body.

#### Iteration 6 (opus, after main was merged in, 18847b1a2)
- [WARNING] Stop now had no aria-describedby to its hint and sat tight against the radios. Fixed (cd4213145): described
  by its hint, set 16px apart.
- [WARNING] Its done message did not say unfinished work was dropped. Fixed: "Stopped. Every helper has been told to
  stop, and work not handed back was dropped." S7 asserts the message and the hint.
- [WARNING] It greyed whenever the lead was "not working" (so a starting or unknown lead lost the only interrupt).
  Fixed: it greys only when the lead is known idle.
- [WARNING] S12 used pausedBecause 'person', where the greying rule never applies, so it could not fail. Rewritten:
  stopped, idle lead, full count, two helpers => enabled; CONTROL, none => greyed.
- [WARNING] ENGINE (Renet's): a stopped swarm's offline row carries no `swarm` field. Built by Renet on
  swarm-offline-3564, not yet merged; the page follows the field when it arrives (S28 covers the field coming and
  going). Not a UI change.
- NITs: slider saves per arrow step (a debounce was tried and reverted: S18 and S27 read each change's own answer,
  and the saves are idempotent); the Daily limit label is not orphaned (it labels #d-swarm-cap).

#### Iteration 7 (sonnet)
- [WARNING] S24 read CURRENT.state, which the status poll never reassigns (the page paints from SWARM_ROW), so it
  could pass with a broken disable rule. Fixed (e9c37233d): S24 reads SWARM_ROW.state, as S12 now does.
- NIT not taken: no arm for starting / rate_limited / unknown with Stop now (the rule is equality with 'idle').

#### Iteration 8 (sonnet)
No BLOCKER or WARNING. Verified SWARM_ROW is set by swarmPagePaint from the poll's row, the fixture's crewState
reaches it, S24 can fail, and no arm still reads CURRENT.state. NIT not taken: S24 relies on S8's state without its
own precondition line.

After iteration 8: main merged in again (#3756, #3757, #3776; README resolved, EXPECTED_SITES still 155 by the
reason-grep test), and 41c98696d: Stop now keeps its distance with a column gap, since the 16px margin left it indented
when it wraps under the radios (seen in the shot). CSS only; S1-S28 pass on it.

## Validation (this session)
6j on HEAD 41c98696d: full suite clean (hash 5950eff666af), subdir audit clean. render-swarm-ui-3564: 60 pass, 0 fail.

