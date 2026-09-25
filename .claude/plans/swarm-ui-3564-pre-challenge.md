---
pre_challenge: true
method: challenge-loop
branch: swarm-ui-3564
diff_hash: 996aa55bd8814044b266a7850c7fc392af97ddb4273d6d575a723c299eafa2ef
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T05:51:53Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iterations 4 and 5 had nothing at WARNING or above)

## Challenge loop (blind reviewers, alternating models)

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
