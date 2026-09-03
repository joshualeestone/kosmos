# kosmos#1898 -- surface the discarded needsYouUnattributed counter

## The defect (verified live on current main)
`engine/projects.js` (~1007-1015) computes four per-project needs_you counters. `web/index.html` reads
only `needsYou` (4 occurrences, zero suffixed variants; server.js has zero too -- verified on
origin/main). So `needsYouUnattributed` (an agent in `needs_you` that named NO project,
`stateProject === null`) is computed and thrown away.

**Consequence, bounded honestly (from the card):** a needs_you without `--project` gets
`stateProject: null`, so it lights NO project tile -- it is the easy-to-miss case a person scanning the
Projects board never sees. It is not invisible (the agent's own card still shows needs_you), so the
cost is attribution on the board, not a lost red. `needs_you` is the only state that means a person
must act, and `--project` is easy to omit, so a counter that exists to catch the omission and renders
nowhere is "work done, wired to nothing."

The counter's own comment in projects.js says twice it is meant to be "read on the Agents page." So
this is WIRING (surface a computed value), not a new design.

## What "done" looks like
The unattributed needs_you count is visible at the board level, so the omission (needs_you with no
project) is legible rather than only readable off the agent's own card.

## The change
- **`engine/status.js` `countAgents`**: add a fleet-level
  `needsYouUnattributed: agents.filter(a => a.state === NEEDS_YOU && a.stateProject === null).length`.
  The board cards countAgents iterates already carry `stateProject` (status.js:4344/4576). This is the
  fleet subset of the existing `needsYou` tally, computed over the SAME removed-agents-filtered board,
  and it rides `/api/status` `counts` alongside `needsYou` (the plumbing already sends countAgents'
  output). Cleaner than reading the per-project replicated `p.summary.needsYouUnattributed` off
  `/api/projects` (which is scoped to a project's members and identical on every tile).
- **`web/index.html`**: a new hidden-at-zero tile `#st-attn-noproj-tile` immediately AFTER the "Needs
  you" tile on the Agents-tab stats row, reading `c.needsYouUnattributed`. Slab "No project", the same
  `.stat.alert`/`.haz` red treatment as its parent, with a `title` giving the full "Agents that need
  you but named no project". It is a DRILL-DOWN of "Needs you" (a subset), NOT a new agent bucket, so
  it does not enter the Working + Idle + Needs you = Agents arithmetic; it hides at zero exactly like
  its parent, so a healthy board and the common case (every question named its project) are unchanged.
  Also blanked to `?` + hidden on a failed poll, consistent with its parent.

## Design note (for Josh, who reviews in-app)
The Agents-tab stats row is Josh-curated (#653 removed a tile, #278 ordered by urgency ending on the
red one, #734 removed the loose summary line). This treatment respects that: hidden-at-zero, red,
placed right after and subordinate to "Needs you", so it only appears when there is an omission to
catch. It is a one-line revert or copy/placement tweak if Josh wants it different. Chosen the Agents
page per the counter's own comment; an alternative home (a note on the Projects board, where the miss
physically happens) was considered and rejected as contradicting the comment's stated intent.

## Tests
- **`engine/status.test.js`**: countAgents tallies `needsYouUnattributed` = needs_you agents with no
  project; a CONTROL board whose every needs_you IS attributed has `needsYou` nonzero but
  `needsYouUnattributed` zero (the omission the counter exists to catch, distinguishable from the
  total only because the field exists).
- **`server.test.js`**: extended the stats-tile drive test to slice through the new tile's write and
  assert it shows at nonzero + hides at zero, with a CONTROL (all-attributed: parent shows, drill-down
  hides). Extended the failed-poll test to assert the new tile blanks to `?` and hides.
- Engine coverage of the per-project `needsYouUnattributed` already exists (engine/projects.test.js:437+).

## Browser-check gate (#1720)
The change touches web/, so the gate needs a `docs/browser-checks/` update OR a `Browser-check:`
override trailer. Measured precisely: `docs/browser-checks/render-not-running.js` DOES render this
Agents stats row, but it asserts the COUNT tiles (`st-agents`/`st-idle`) and a "the row adds up"
invariant, not the hidden-at-zero ALERT tiles. The new tile reuses the shipped `.stat.alert`/`.haz`/
`.slab` treatment verbatim (identical to the "Needs you" tile), so there is no new styling to
pixel-assert; it stays hidden at zero (it does not enter the row-adds-up sum, so render-not-running's
invariant is untouched); and its show/hide/blank logic is covered by the server.test.js drive test. So
no new browser-check assertion is warranted, and the change carries a `Browser-check:` override trailer
with this reason.

## Decision record
- **Call:** wire the computed counter to `/api/status` counts and render it as a hidden-at-zero
  drill-down tile on the Agents page, per the counter's stated intent.
- **Rejected:** (a) reading the per-project replicated value off /api/projects (wrong population,
  awkward coupling to the projects payload for an Agents-tab tile); (b) a Projects-board note
  (contradicts the counter's "read on the Agents page" comment); (c) shipping the counter on
  /api/status with no render (repeats the exact "wired to nothing" defect one layer up).
- **Weakest premise:** that a new tile on Josh's curated row is the right treatment. Mitigated: it
  hides at zero and subordinates to "Needs you", matching his stated urgency-first / hide-the-calm
  preferences, and it is a one-line revert. Josh reviews in-app.
