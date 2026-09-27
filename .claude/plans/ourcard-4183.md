# ourcard-4183: one exact-name permit, projects.ourCard / heldExactly, everywhere (#4183)

## Why

#3932 (PR #4179) added `projects.ourCard(name, roster)` and `heldExactly`, which is tellAgent's
exact-name permit ("loose to notice, exact to permit"). Other sites still hand-typed the predicate
`a.sessionName === name && a.isNamedOurs === true`. CLAUDE.md names two derivations of one fact as
this codebase's most-shipped defect: if the rule gains a clause (as isNamedOurs once was added,
after a lookalike rewrote a real agent's instructions), a copy drifts silently.

## The change

Each hand copy calls the shared helper. Behaviour is identical: `!heldExactly(n, r)` is exactly
`!Array.isArray(r) || !r.some(...)`, and at projects.js describe `cards` is always a list.

- engine/projects.js (describe's everSeen upgrade)
- server.js (DELETE and POST /api/agent/<name>/skills)
- engine/connections.js, dmfiles.js, doctrine.js, policy.js, reports.js, you.js (their instruction
  block writers' permit)

The card named three sites. The guard below found six more on its first run. That is why the
guard is part of the change, not a follow-up.

## Guard

one-derivation.test.js "#4183" flags any line that compares `.sessionName` (`==` or `===`) and also
uses `.isNamedOurs` positively (`=== true`, `== true`, or bare truthy). A negated `!a.isNamedOurs` or
`!== true` is not flagged. It scans server.js and every non-test .js under engine/, recursively. The
only line allowed is ourCard's own, and a control requires the scan to find it. A second test pins the
spellings it claims to see and the ones it must not flag (projects.js's `borrowed` filter). Not seen:
a copy split across lines, a destructured parameter, files outside those roots (tools/, bin/). Review 1
widened it from the `=== true` spelling only, and added the recursion.

## Evidence

- The guard was red on the first run, naming the six engine copies. It is green after. A planted
  truthy-form copy in engine/you.js is caught and named (engine/you.js:168).
- All nine modules load. Suites for connections, dmfiles, doctrine, policy, reports, you and
  projects, plus server.projects and one-derivation: 431 passed, 0 failed. The server skills test
  (the exact-match permit on the agent write): 1/1.

## Weakest premise

The six engine modules require './projects' at load time. That is safe only while projects.js
does not require them at top level, since its `module.exports = {...}` is assigned at the end.
Checked: it requires none of them, and each already calls projects.findBlock and the like at
runtime.
