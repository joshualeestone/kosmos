# #2574 — Project view: clicking a project member opens that agent's agent-view page

## Goal (Josh, via Mona Lisa 2026-09-09)
In the project view, clicking a project member navigates to that agent's detail page (the same page reached from All agents), id-keyed (sessionName). Back returns to the project.

## Design — REUSE the established open-agent path (Splinter/Mona confirmed)
The app already keys agents by `sessionName` and opens the detail view via `openDetail(sessionName)`. The agents grid does exactly this: `.acard[data-agent]` / `.lrow[data-agent]` + a delegated click → `openDetail(card.dataset.agent)` (web/index.html:23021), inner controls checked first. I mirror that pattern for project members. No backend, no new nav.

### Changes (all in web/index.html)
1. **`pjMember(m,...)`** (~31255): add `data-agent="' + esc(m.sessionName) + '"` to the `.pj-member` div. `m.sessionName` is already on the payload (the avatar URL uses it). Harmless on the Settings members list (#pjs-members) — only #pj-one-agents gets the nav handler + cursor.
2. **Extend the existing `#pj-one-agents` click handler** (~38027): it currently only handles the `.pj-minus[data-drop]` remove button. Check the minus FIRST (return early — it is INSIDE the row, mirroring the grid's inner-control-first rule), then: a click on a `.pj-member[data-agent]` → `openDetail(member.dataset.agent, undefined, PJ_CURRENT)`.
3. **`openDetail(sessionName, section, fromProject)`** (~21446): add a 3rd optional param; set module var `DETAIL_FROM_PROJECT = fromProject || null`. Backward-compatible — every existing caller passes no 3rd arg → null → unchanged behavior.
4. **`detail-back` handler** (~23699): origin-aware — if `DETAIL_FROM_PROJECT` is set, clear it and `showTab('projects'); openProject(pid)` (returns to that project); else `showTab('agents')` (unchanged default).
5. **Module var**: `let DETAIL_FROM_PROJECT = null;` near the other detail state.
6. **CSS**: `#pj-one-agents .pj-member[data-agent] { cursor: pointer; }` + a subtle hover background, so a member is obviously clickable (acceptance #1).

## Decisions + weakest premises
- **Back-to-project INCLUDED** though #2574's body says "navigation only": #2573 (the dup Splinter consolidated, "same acceptance") explicitly required "Back returns to the project view", and it is the natural completion of Josh's intent. It is isolated (one param + one module var + one conditional) and reversible if a reviewer scopes it out. WEAKEST PREMISE: a strict reading of #2574 ("just open the page") would drop it; I kept it as the correct UX.
- **Mouse-click via data-agent + delegation, MIRRORING the grid** (which is also mouse-click-to-open, no role/tabindex/keydown on `.acard`/`.lrow`). Full keyboard access to open-agent is a cross-surface a11y concern the grid shares; adding it to members alone would be inconsistent, and role="link"/"button" on `.pj-member` would nest an interactive control (the minus button) — an ARIA anti-pattern. So: consistent mouse-click here; keyboard parity is a separate fleet-wide follow-up. WEAKEST PREMISE: if the repo's WCAG-AA bar requires keyboard on this new affordance specifically, revisit — but it would then also indict the existing grid.
- **Scoped to #pj-one-agents (the project view)**, not #pjs-members (Settings), per the card ("when I'm viewing a project"). Settings-members clickability is a possible follow-up.

## Verification
- Existing test suite (node --test) — no regression in the members/project modules.
- Browser-check gate (#1720): web/ change. Add a `Browser-check:` commit trailer stating the manual/served verification, and/or a docs/browser-checks assertion that a `.pj-member[data-agent]` click opens the detail view.
- Manual/served: from a project with members, click a member → detail opens for the right agent; Back → the project view.
