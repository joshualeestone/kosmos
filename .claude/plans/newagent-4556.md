# newagent-4556: New Agent's first screen, Single / Team / Swarm (#4554 part 3)

Card: joshualeestone/kosmos#4556 (priority, claimed:angel). Josh, #admin 2026-09-29 09:06 (verbatim on #4554).
Design review: Mona Lisa (line art, light and dark, desktop and phone).

## Finished looks like
New Agent opens on three large side-by-side buttons with line art: Create a Single Agent, Create a Team of Agents,
Create a Swarm of Autonomous Agents. Each leads to its own second screen:
- Single: today's role screen (Project Manager recommended; another role; describe your own; import), with no
  single-vs-swarm selector anywhere.
- Team: a dropdown of the seeded teams (GET /api/teams/seeded, #4555) whose Create hands off to #4557's
  openTeamCreate(key), and "Upload an org chart", which opens the existing org-chart panel (#1280). Until #4555 and
  #4557 land, the screen says "coming soon" rather than offering a control that does nothing.
- Swarm: pick a role or describe your own; no Project Manager, no import, no org chart. Step 2 shows the swarm
  settings directly.
A Back button returns from any second screen to the three-way choice. Works in the tab and consolidated layouts
and at phone width.

## Decisions
- A new first step (`cstep-kind`) in the existing step machine; Single and Swarm share `cstep-role` and each shows
  only its own options (`paintPathOptions`, run on every open because buildPicker runs only on the first fetch);
  Team is its own step (`cstep-team`). The kind of agent now comes from the path (`CREATE_PATH`); the
  `create-kind` radio stays as the state `createKind()` and the create request already read, so the request body
  and the server are unchanged.
- The step-2 Agent/Swarm selector is no longer a choice. On the Swarm path its Swarm card stays, alone, because it
  is the swarm's live preview (its circles follow the helpers slider and carry the name's mark, #3946); on the
  Single path neither card shows. Rejected: deleting the cards, which silently removes that preview.
- Swarm roles: NONE exist (engine/roles.js defines no swarm roles). The Swarm path offers the ready-made roles
  minus the two that direct other agents or projects (Project Manager, Project Director; Mona's review, agreed by
  her), plus describe your own, opening on the first that remains. Operations Manager stays: it keeps recurring work
  moving and does not direct agents. This is the weakest premise; defining swarm roles belongs to
  #4554 part 2 (roles research).
- The org chart moves from the Single screen to the Team screen (Josh: org chart is a Team option). It is a paste
  box, as #1280 built it; the button keeps the old option's words, "Upload an org chart".
- Line art follows the first-run choice screen (#4356): gold dots are agents; one dot (Single), a lead over four
  reports (Team), a cluster (Swarm). On the page's own tokens so light and dark follow the theme. The panel widens
  on the first step so the three cards fit in one row; at phone width they stack as compact rows.
- The roles still load when New Agent opens (so Single and Swarm open at once); the chosen path re-applies its
  default. The first-run "look in my folders" link still goes straight to Single's import panel.

## Design review (Mona Lisa, 2026-09-29, approved)
- One back link on a second screen, "Choose another kind" (All agents hidden there; it stays on the first screen).
- Team with no seeded teams: no dropdown or disabled Create; "Ready-made teams are coming soon." once; Upload an org
  chart is the gold action, with no label repeating it and no divider. With teams, the dropdown returns and the org
  chart is the plain second choice. Nothing of the dropdown shows until the catalogue answers; an empty catalogue is
  asked again next visit, like a 404.
- Phone: line art about 40px tall beside each title (which wraps); the role menu 16px (no iOS zoom), on the same
  40rem breakpoint as the layout. Swarm reads "Pick a role".
- Validation fixes: server.test.js's default-mode pin reads the Swarm path's 'list' pass-through and still pins pm;
  /api/teams/seeded is in web.api-routes-3957's SERVED_ELSEWHERE until #4555 adds the route, and a new test there
  fails once the board serves any listed path, so the entry cannot outlive the route.

## Tests
- Node: web.role-picker updated (heading id, import hidden for a swarm, org chart gone from pickMode).
- Browser checks moved onto the new first step (a Single click before the role screen): the create-flow checks;
  render-role-order (the org chart left the order), render-orgchart-import-1280 (now through Team),
  render-swarm-ui-3564 (Swarm path: no selector, the Swarm card alone as the preview), render-consolidated-
  newagent-3053 (step one's cards centred in one row; the form measured on the role screen), click-first-run.
- New: a check for the first screen and the three paths (and Back), light and dark, desktop and phone.

## After the loop (2026-09-29 16:50, CI and a fresh review)
- CI's render-full-width was red: it predated this card and held the whole New Agent panel to 34rem. It now measures
  the first step at 60rem (the deliberate `#panel-create:has(#cstep-kind:not([hidden]))` rule) and, after Single, the
  form at 34rem, both centred; measured red with the 60rem rule removed.
- Review: with /api/roles failing, Team said only "Ready-made teams are coming soon." and never retried, and a failed
  load overlapping a good one could hide an org chart that had loaded. The Team path now starts the roles load when
  there is none, and `#team-orgchart-msg` says why when it fails. K10 in render-newagent-paths-4556 measures the note
  and the retry (each red with its fix removed).
- Review pass 3: overlapping roles loads still raced (a stale success wrote the shared lists, and a later path choice
  took the fast path without building the picker: Single with an empty Project Manager and Loading forever). Now one
  `/api/roles` request at a time is shared by every caller (`fetchRoles`), it alone writes ROLES / OWN_ROLE /
  CREATE_MODELS, the picker is built whenever it has not been for the current list, only the newest caller paints,
  and Team repaints its options from what is there. K12 reproduces the race (slow success plus a failing second
  request, Team, Back, Team, Back, Single): red in all 8 arms on the previous code, green now. K11: a revisit keeps
  the chosen ready-made team.

## After main's #4632 (the ready-made roles download when the picker opens)
- The one shared roles request carries `?catalogue=1`. Only opening New Agent (and the `?tab=create` boot) asks again for an incomplete catalogue; a path choice paints the menu already held.
- An open's refetch that fails keeps the menu already held (offline is when the catalogue is incomplete).
- Accepted: if the open's answer lands after the person has chosen a path (Single, Team or Swarm each become the newest caller), the newly downloaded roles are not shown on that visit (the picker is not repainted under a choice in progress); once the answer has landed they appear on Back or the next open.
- Not changed here, main's behaviour: on the first-run import link the open itself lands on the role screen, so its late answer can still repaint under a choice made there (follow-up card).

## Handover to Renet Tilley (2026-09-30 07:38, Splinter; Angel out until Oct 3)
Review round on 9680941e2 (blind, opus), the first since the proof was written (it predates the main merge and the
three #4632 follow-ups): 0 BLOCKER, 2 WARNING, both DEFERRED on a premise now pinned by a test.
- (W) a late roles answer that lands under a path already painted swaps ROLES/OWN_ROLE under a menu built from the
  older payload, so the menu shown and the role created could come from two payloads. They cannot differ for any role
  the menu shows: the only payload a refetch replaces is an incomplete one (built-ins only), and engine/roles.js
  remerge keeps every built-in and SKIPS a catalogue role with a built-in's key, so each shown key is in the later
  payload with identical copy. New test in engine/catalogue.download-4632.test.js: a signed catalogue that redefines
  `pm` leaves the built-in copy, once; reds when the merge lets the catalogue win.
- (W) Team moving ROLES_GEN (9680941e2) has no check, and its named cost (Team options stale on a changed OWN_ROLE)
  cannot occur: `own` is the built-in roles.byKey('own') in every payload. Painting or not painting under Team gives
  the same data; the bump keeps the one rule that only the newest caller paints. Kept as is.
NITs, noted: "they appear on Back or the next open" means the next Single or Swarm choice after Back (Back alone
repaints nothing; Team never rebuilds the picker); paintRoleMenu excludes the literal 'pm' while buildPicker falls
back to ROLES[0] (only for a payload with no pm, which remerge never produces); the Team note says "choose Team again"
while a retry is in flight; Back from Swarm when SWARMS_ON flips has no card to focus.
Next round (blind, sonnet): CONVERGED. 1 WARNING, a DUPLICATE of the deferral above (role-next reads roleByKey from
the newer payload; safe because remerge keeps every built-in, now pinned by test). NIT taken: the cstep() comment
said it toggles "the three steps" (there are five); it no longer counts them. NITs left: swarmCreatePaint no longer
hides the Swarm card when SWARMS_ON flips off mid-visit (createKind() still sends 'agent'); the retry note and the
Back-focus edge above. Next: the final validation on this head, then a new proof and merge on green.
