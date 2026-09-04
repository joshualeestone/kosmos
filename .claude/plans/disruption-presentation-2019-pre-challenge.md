---
pre_challenge: true
method: challenge-loop
branch: disruption-presentation-2019
diff_hash: feda17ba90556a40a88d7287da7d51cf33983a0a79c1b942bb084d31d6734789
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T03:36:00Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 found no BLOCKER/WARNING/CONVENTION; the reviewer confirmed no surface still renders a restarting agent as gone)
**Total findings:** 4 WARNINGs, 8 NITs (0 BLOCKERs, 0 CONVENTIONs)
**Fixed:** 4 WARNINGs + 6 NITs | **Deferred:** 2 NITs | **Asked:** 0

### Change under review (#2019, MIXED card, PRESENTATION half)

The board rendered an agent WE deliberately restarted as "gone" (the tmux gap read as
absence). This adds an honest `restarting` board state: the animated Kosmos K, cause-named copy
(via a shared `stateCopyOf`/`restartingLabel`), presence 'on', a solid border, never "gone". It
consumes the engine contract Renet builds separately (`a.state==='restarting'`,
`a.disruption={cause,startedAt}`), is INERT until the engine emits the state, and adds no behavior
to existing states, so it is safe to merge in either order (confirmed with Renet).

### Per-Iteration Breakdown

The restarting state had to be honest on SEVEN surfaces, and the blind passes found them one at a
time. This is exactly why the loop iterates.

#### Iteration 1
- [WARNING] web/index.html members list rendered the gone-lie for a restarting member (branched on raw `m.present`) --> FIXED
- [NIT] .fr-scanpreview overflow-wrap parity --> FIXED
- [NIT] contrast test did not pin st-restarting --> FIXED

#### Iteration 2
- [WARNING] web/index.html the members-list CONTAINER still got the dashed `.unseen` border --> FIXED
- [NIT] route the members caption through stateCopyOf --> FIXED
- [NIT] org-view comment made deliberate --> FIXED

#### Iteration 3
- [WARNING] web/index.html a 6th surface: paintTalk past-marked a live restarting agent ("when last seen") --> FIXED (gated)
- [WARNING] web/index.html card()/lrow() offline early-returns could swallow restarting under a future engine change --> FIXED (guarded with `&& a.state !== 'restarting'`)
- [NIT] detail-badge comment doc drift --> FIXED

#### Iteration 4
- [WARNING] web/index.html a 7th surface: the projects-list rollup pill (pjPillOf) fell to "Nothing running" --> FIXED (a `s.restarting` branch, inert until the engine folds the count in; coordinated with Renet)
- [NIT] runsOnLine model-line tension --> DEFERRED (engine-timing; Renet's model-detail follow-up)

#### Iteration 5
**Converged** -- no BLOCKER/WARNING/CONVENTION. The reviewer verified every surface (including the fleet-summary tiles, renderConnection, and the room "who's working" list) renders a restarting agent honestly, never gone.
- [NIT] runsOnLine tension (still deferred)
- [NIT] one detail-badge comment doc-drift --> FIXED (comment-only, post-convergence)

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | WARNING | web/index.html | members list gone-lie (m.present) | FIXED |
| 2 | 1 | NIT | web/index.html | overflow-wrap parity | FIXED |
| 3 | 1 | NIT | web.label-contrast.test.js | pin st-restarting | FIXED |
| 4 | 2 | WARNING | web/index.html | members container .unseen dashed | FIXED |
| 5 | 2 | NIT | web/index.html | members caption via stateCopyOf | FIXED |
| 6 | 2 | NIT | web/index.html | org-view comment | FIXED |
| 7 | 3 | WARNING | web/index.html | paintTalk past-marks restarting | FIXED |
| 8 | 3 | WARNING | web/index.html | offline early-return swallows restarting | FIXED |
| 9 | 3 | NIT | web/index.html | detail-badge comment | FIXED |
| 10 | 4 | WARNING | web/index.html | projects pill "Nothing running" | FIXED |
| 11 | 4 | NIT | web/index.html | runsOnLine model tension | DEFERRED |
| 12 | 5 | NIT | web/index.html | detail-badge comment doc drift | FIXED |

### Seven surfaces covered

card, row (lrow), detail badge (openDetail), project-members list (caption + container +
present-branch), org/constellation view (deliberate no-ring), the detail page's paintTalk
remembered-marker, and the projects-list rollup pill; plus the card()/lrow() offline early-return
guard.

### Validation

6j: full suite green, node 4153/4153, 0 fail, shell gate exit 0. Run alone on a free box after
refusing to force past release cut 0.6.28's machine claim.

### Rebased onto newer origin/main, re-validated (a rebase orphans recorded runs)

After convergence the branch was rebased onto an origin/main that had gained #2096 / #2066 / #2012 /
#2047 / #1940 (several touching web/index.html). Only tools/browser-checks.sh conflicted (both added
a check to the runner list; resolved by keeping both). web/index.html and server.test.js auto-merged.
Re-validated the rebased HEAD: full suite green node 4190/4190, 0 fail (hash feda17ba9055 -- matches
this proof's diff_hash), plus a confirming blind pass that found NO issues and verified every state
surface stays honest against main's auto-merged changes. This proof's diff_hash is the rebased HEAD.

### Coverage / browser check

`docs/browser-checks/render-restarting-2019.js` (indexed in the README, wired into
tools/browser-checks.sh): calls the page's global render functions with fixture agents shaped to the
contract, 7 causes x 2 themes + a reduced-motion arm (K animation kbreathe -> none, opacity 1).
Positive control: fails on origin/main (the render code is absent).

### Deferred NITs (both engine-coordination, agreed with Renet)

- runsOnLine renders "Right now: <model>" for a model-switch restart; resolves with Renet's
  model-detail follow-up (runsOnLine moves tense with pres by design; not special-cased).
- The projects-list pill activates only when Renet's engine folds a `summary.restarting` count into
  p.summary (the branch is in place and inert until then).

### Outstanding questions (ASKED)
None.

### Strengths (across iterations)
- [STRENGTH] One shared `stateCopyOf`/`cardStOf` derivation feeds every surface, so the state word cannot drift; null-safe (`a && a.disruption && a.disruption.cause`); non-restarting path byte-identical to before.
- [STRENGTH] Every added guard reduces cleanly to prior behavior for non-restarting agents (verified iter 5 and the post-rebase pass).
- [STRENGTH] CSS: solid border (never the dashed unknown), reduced-motion holds the K static AND fully visible.
- [STRENGTH] Tests non-vacuous: the two server.test.js preludes join the real shipped helpers (a stub would hide a divergence), the contrast test pins st-restarting with a positive control, the browser check has a real positive control.
- [STRENGTH] No em dashes in any rendered string; copy in Josh's voice, calm, no false alarm.
