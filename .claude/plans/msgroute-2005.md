# #2005: project thread routes resolve a mis-cased name like the #989 recovery route

## Problem

#989 fixed the agent-thread / recovery send path so a case-mismatched agent name still
reaches the agent (shared `resolveCard`, exact-then-case-fold, ours-preferring). The project
thread routes still bare-matched `sessionName === name`, so the SAME mis-cased name that now
reaches an agent via the recovery route was refused via the project route. Not a #989
regression (the route refused safely rather than mis-delivering), but an inconsistency: the
send routes disagree on which card a name resolves to.

## The fix (Angel mapped it on the card; I implemented and tested)

Route three bare-match sites in `server.js` through the #989 helpers:

- **7761** (project READ presence): `(project.agents||[]).find((m) => m.sessionName === name)`
  -> `chat.resolveCard(project.agents||[], name)`. A READ; downstream history/viewport pass
  `name` and case-fold internally.
- **7965** (project SEND presence): `(project.agents||[]).some((m) => m.sessionName === name)`
  -> `!chat.resolveCard(project.agents||[], name)`. Safe: delivery is ours-gated downstream
  (`chat.deliver` -> `addressable` refuses `isNamedOurs !== true`), so a case-folded non-ours
  match passes presence but is refused at delivery, exactly like #989. The delivery layer
  already case-folds (from #989), so this only aligns the presence gate with the send it guards.
- **7975** (trust-hold, ours-only): `roster.find((a) => a && a.sessionName === name && a.isNamedOurs === true)`
  -> `ourCardByName(roster, name)`, the same helper the agent-thread route uses at 5731/5946.

## Deliberately out of scope

The folder-write permits at **2348/2376** (`/api/agent/<name>/skills` DELETE/POST) stay
exact-match. A case-fold on a WRITE into a worker's folder is the hole #989's contract keeps
closed ("a WRITE/SEND that merely sanitises to a live agent must be refused, a READ need not
be"). The error copy there already says "exactly this name".

## Test (server.projects.test.js, mirrors chat.resolvecard-989 style)

Three arms: a mis-cased name reaches both routes (was 404); a strip-only name (`Ma.ra`,
which safeKeys to `mara` but does not case-fold to it) is refused on both (case-fold, never
safeKey); a non-ours like-named pane passes presence but is refused at delivery
(`delivery.state === 'could_not'`). Red-cap proven: reverting server.js reds the two
behavior-change arms; the strip-only control stays green (it must not change). Full
`server.projects.test.js` = 126/126 green.

## Weakest premise

That the delivery layer's ours-gate is the only security boundary the presence case-fold
relies on. Verified: `chat.deliver` -> `addressable` -> `resolveCard` then the
`isNamedOurs === true` check; the non-ours test arm exercises exactly that path and is
red-capable.
