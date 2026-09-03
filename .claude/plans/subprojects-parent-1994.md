# #1994: sub-projects — let a project declare a parent, for organization

**Branch:** `subprojects-parent-1994` · **Card:** kosmos#1994

Josh, 2026-09-03: "assigning what this thing goes underneath so that visually we could show:
'Hey this project has a parent.'" Folders within folders — a hierarchy inside one instance.
Companion card #1704 (Multiple Kosmoses, the macro instance switch) is separate and stays open;
they are different levels and #1994 does not span instances.

## The four questions, decided (cheapest-correct, matching what Josh asked and not more)

1. **Depth: a single `parent` field per project, with cycle-refusal.** A single-parent field
   covers his one-level ask AND any chain, and it is the only shape under which the cycle-refusal
   below makes sense. No general graph, no breadcrumbs — not asked.
2. **Parent deletion: REFUSE.** "This project has sub-projects; re-parent or remove them first."
   Cheapest correct answer, easiest to relax later, a stated+tested behaviour rather than an
   emergent orphan/cascade.
3. **Who reads `parent`: display only.** Nothing but the board's grouping reads it — no inherited
   settings, no shared agents, no cascading access. Said in the code on the field, because the
   next person will assume otherwise.
4. **Cycle attempt REFUSED** (walk the proposed parent's ancestor chain; refuse if it reaches the
   child). **Missing/dangling parent RENDERS un-grouped** (top level), never vanishes.

## The correction the build produced (my own earlier premise was wrong)

My prior design comment said "a rename changes the id" and built a graceful-degrade-on-rename
story around it. **Reading the code disproved it:** `engine/projects.js` rename → edit → mutate
changes `name` but never `id`; `idFor` is called only at create. **A project's id is stable
within an instance,** so a `parent` stored by id is rename-proof already, and #1994 does not
depend on #1704's stable-id work at all (that is about ids across INSTANCES). The rename test arm
proves it. The only remaining dangle case is a hand-edited store, for which describe degrades to
`parentName: null` (child renders at top level).

## What this branch ships (the data model)

- **`engine/projects.js`**
  - `create`: a nullable `parent` field, default `null`.
  - `cleanParent(value, childId)`: validates a proposed parent before any write — `null`/`''`
    un-groups; self-parent refused; missing parent refused; cycle refused by walking the parent's
    own ancestor chain (seen-set bounds a store that already holds a loop).
  - `edit`: applies `parent` atomically alongside name/description (whole or not at all), so a
    combined PUT cannot half-apply.
  - `remove`: refuses (throws with `status: 409`) while any project has `parent === id`, naming the
    children.
  - `describe`: exposes `parent` (normalized to null for legacy), the resolved `parentName`
    (null when the id resolves to no project → un-grouped render), and `parentArchived` (whether
    the parent is archived — published so the board can render a hidden group without re-joining;
    the fact, not the rendering decision).
- **`server.js`**
  - PUT `/api/projects/:id`: forwards `body.parent` into the single `edit`.
  - DELETE `/api/projects/:id`: honours an explicit `err.status`, so the has-children refusal is a
    409, not a misleading 404.
- **`engine/projects.subprojects-1994.test.js`**: 15 arms — default null, group, un-group (null and
  ''), self/missing/direct/deep cycle refusals, delete-with-children refusal (409 + names),
  delete-after-reparent, rename-keeps-grouping, dangling-parent graceful degrade, atomic name+parent,
  seen-set termination over a pre-existing loop, non-string-parent type refusal, and parentArchived
  publication. Route wiring (PUT forward, DELETE 409) is covered in `server.projects.test.js`.

No new engine export: `edit` is the single API (the #265 reachable guard flagged a `setParent`
sugar wrapper as reachable-from-nowhere; the route uses `edit` directly, so the wrapper was
removed and tests exercise the real path).

## Deliberately NOT in this branch (the UI follow-up, card kept open)

The screen controls — a set-parent picker in project settings, and the board rendering that shows
the grouping — are a genuinely separate front-end pass. `web/index.html` is a large, interaction-
heavy file and that work benefits from real browser verification. The engine + API here is the
foundation it builds on: the PUT route already accepts `parent`, and `describe` already publishes
`parent`/`parentName` for the board to consume. #1994 stays OPEN until the UI ships — per the
"done means the operator can use it" bar, an API-only feature is not done for the card.

## Weakest premise

That the data model is worth landing ahead of the UI. Mitigation: it is complete and 15-arm
tested, it is reachable via the existing PUT route, and it unblocks the UI without locking its
shape. What would change the plan: Josh wanting the whole feature in one PR, or the UI proving it
needs a different engine shape (it should not — parent-by-id + parentName is the minimal surface a
grouping render needs).
