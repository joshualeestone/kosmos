# Plan: project overview should not light an agent as "working" in every project it belongs to (#2837)

## The bug (Josh, live review of 0.6.57)

An agent that belongs to multiple projects shows as "working" in ALL of them on
the project overview, when it is really working in only one. The per-project
"Working" pill is derived from `p.summary.working`, and that count
(`engine/projects.js:1069`) counts every member whose GLOBAL state is `working`:

    working: members.filter((m) => m.present && m.tied && m.state === 'working').length,

An agent's state is one value for the whole process (one pane), so the same
"working" fact is counted on every project the agent is a member of. Every
project the agent belongs to lights at once.

## The precedent this mirrors (#763)

`needsYou` was this exact bug one line up: an agent's single needs_you lit every
project it belonged to. #763 fixed it by qualifying with the project the report
attributed itself to:

    needsYou: members.filter((m) => ... && m.stateProject === project.id).length,

The report carries a project (`engine/selfreport.js` carries it FORWARD across
reports: `started --project X` sets it, `stopped`/`started` clear it, later
reports inherit it). `reconcileReport` surfaces it as `status.project` -> the
card's `stateProject`. But #763 wired this through the `needs_you` branch only;
the `working` branches deliberately drop it (tested at `status.test.js:4641`,
"only a question carries a project onto the state"). That exclusion was #763's
scope, not a hazard: every `stateProject` reader gates on `state === 'needs_you'`
(verified), so nothing reads working's stateProject today.

## The fix (two parts, both Mac-side engine, no web render change)

### Part 1 - carry the working report's project through reconcile (`engine/status.js`)

Mirror the needs_you branch. In each WORKING-state return of `reconcileReport`,
attach `{ project, projectInferred }` derived from `reported` (the carried-forward
project), exactly as the needs_you branch does. Branches: the fresh reported
working (rule 6), the stale-report-but-screen-working pair, and the scraped
WORKING fallback. The UNKNOWN return stays as-is (state is not working, so its
stateProject is irrelevant to the summary).

Flip `status.test.js:4641` so a working report that names a project now carries
it (`working.project === 'p-christmas'`), with a #2837 rationale replacing the
old "only a question carries a project" line.

### Part 2 - qualify the project-overview working count (`engine/projects.js`)

Replace the summary `working` filter so a working member lights a project only
when it is attributable to that project or unambiguous:

    working: members.filter((m) => m.present && m.tied && m.state === 'working' && (
        m.stateProject === project.id ||
        (m.stateProject === null && soleActiveMembership(m))
      )).length,

where `soleActiveMembership(m)` is true when the described project is itself
NON-ARCHIVED and `m.sessionName` is a member of exactly one NON-ARCHIVED project
across `all` (the full list `describe` already receives). The described-project
archived guard matters: without it, describing an archived project a working
agent belongs to would light it whenever the agent's one ACTIVE membership is a
different project -- the same global fact lighting two tiles. A working agent in
exactly one active project is unambiguously working in it; a working agent that
named its project lights that one; a working agent in several projects that
named none lights none (rather than all).

Fail-closed: if `all` is not an array, `soleActiveMembership` returns false, so the
sole-membership fallback does NOT fire and the tile does not light through it (the
attributed arm still lights a report's named project). Every in-repo caller passes
an array (list/get pass readAll()), so this is unobservable on the real path; but
`describe` is exported, so a future/test caller could pass a non-array `all`, and
firing the fallback there (fail-open) would silently re-light every project a
working agent belongs to - reintroducing the exact over-claim this card removes.
Not-claiming is the honest failure for a card about not over-claiming. (This
replaced an earlier fail-open design during challenge-loop iteration 4.)

## Tests

- `engine/projects.test.js`: extend the #763-style row-summary test (or add a
  sibling) proving:
  - a working agent in ONE project lights it (`summary.working === 1`);
  - a working agent in TWO projects, no named project, lights NEITHER
    (`summary.working === 0` on both) - the bug, now fixed;
  - a working agent whose report NAMES a project lights ONLY that one
    (attributed arm), via `selfreport.record(name, {state:'working', project: id})`.
  Each with a control asserting the other project stays dark.
- `engine/status.test.js`: the working reconcile now carries the report's
  project (`working.project`), replacing the 4641 assertion; a working report
  that names none carries `project: null`.

## Verification / risk

- Run the FULL suite directly (`bash tools/run-tests.sh`) before pushing - the
  pre-commit hook and challenge-loop validation run subsets and miss
  source-assertion tests; this touches `status.js`/`projects.js` which several
  such tests pin.
- Prove each new assertion red-capable by perturbation (restore from buffer).
- No `web/index.html` change: the overview already reads `summary.working`
  through `pjPillOf`; this only corrects what the number counts, so no browser
  gate.

## Weakest premise (documented on the card)

A multi-project working agent that never names a project lights none of its
projects, so those tiles may read "Nothing running" while it works elsewhere - a
false-calm risk. Accepted: Josh's complaint was the over-claim, he flagged "maybe
not possible", it is strictly better than lighting all, and a producer that names
working's project (a follow-up: `report working --project X` at launch) makes the
right tile light. A distinct "working somewhere" pill for the ambiguous case is a
small copy follow-up if Josh wants it.
