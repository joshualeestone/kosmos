# #2458: assign a parent (and add agents) AT project creation

## Problem
Josh, 2026-09-07: on the Create-a-new-project page there is no option to assign a
parent project. You can only set a parent later, in a project's settings. A
subproject therefore takes two steps: create it top-level, then re-parent it. Josh
needs it AT creation: name + description + parent + agents, all on the create page.

This is the create-flow slice of beta req #4 (subproject structure). #1994 gave
declare-a-parent (the data model + the edit/settings path). This makes parent a
first-class create-time choice.

## Scope of THIS branch (engine + route)
The create-page UI (a parent selector + the agents picker on the create form) is
Angel's half. This branch is the engine + route the form posts to.

1. `engine/projects.create()` accepts an optional `parent`.
2. `POST /api/projects` forwards `body.parent`.
3. Adding agents at creation was ALREADY engine-supported (`create` takes
   `agents`); a route test now proves parent+agents in one create.

## Design decisions

### Reuse cleanParent, do not write a create-time validator
The parent rules (a parent must be a real project id; a non-string is a type
error, never a silent ungroup; self-parent and cycles are refused) live in
`cleanParent`, used by `edit`. `create` calls the SAME function. One definition,
so create-time and edit-time parent rules cannot drift -- the two-definitions-of
-one-fact defect this codebase repeatedly pays for.

### childId at create
`cleanParent(value, childId)` needs the child's id. At create the id is minted
(`idFor`) BEFORE the object is built, and passed as childId, exactly as edit
passes the existing id. A brand-new id is referenced by nothing, so the CYCLE
arm cannot fire at create; the parent-must-exist and type checks are the live
ones. The self-parent arm (`parentId === childId`) is reachable in one edge
case, because `idFor` derives the id from the title: creating "Alpha" with
parent "alpha" (naming a not-yet-existing project as its own parent) refuses as
self-parent rather than parent-missing -- still a correct refusal with no row
written, only the message differs. Passing the real new id (rather than null)
keeps the call identical to the edit path and robust if the id ever became
referenceable before the write.

### Validate before makeFolder, with the other body refusals (whole or not at all)
`cleanParent` runs BEFORE `makeFolder`, alongside the name and description
refusals -- not after. `create` deliberately hoists body validation ahead of the
mkdir (the documented principle at engine/projects.js:1586): a body refused after
makeFolder leaves an empty folder no record points at, for a folderless caller
(`create({ name, parent })` with no explicit folder). A bad parent is exactly
that case, so it joins the pre-makeFolder body refusals. Because `cleanParent`
needs the child id, `all` (the store read) and `idFor` are computed there and the
later duplicate check reuses the same `all` (nothing writes between). So a bad
parent refuses the whole create, leaves no orphan project row AND no orphan
folder, matching both the body-refusal ordering and edit's atomicity.

### Blank/null/absent = top-level
`cleanParent('' | null | undefined)` returns null, so the create default is
unchanged: a project with no parent given starts ungrouped, exactly as before.

## The Angel seam (field contract)
The create-page UI must POST:
- `parent`: the selected parent project's **id** (blank/absent = top-level).
- `agents`: a string array of agent session names (already supported).

Both are existing vocabulary (#1994's `parent`, create's existing `agents`), so no
new words and no translation layer.

## Tests
- Engine unit (`engine/projects.subprojects-1994.test.js`): create groups at
  creation; a missing parent is refused and writes no row; a non-string parent is
  a type error; blank/null/absent start top-level.
- Route (`server.projects.test.js`): POST with a parent groups and resolves the
  parent name; an unknown parent is a 400 (not a 500) and leaves no project; parent
  + agents in one step; a blank parent is top-level.
- 163/163 across both projects suites.

## Weakest premise
The field-name contract with Angel's UI. I use the existing `parent`/`agents`
names precisely so the UI and engine share one vocabulary; if the UI posts a
differently-named field the seam needs a translation layer. Messaged Angel with
this contract + the PR link.
