# Plan: sandbox AGENT_WORKFORCE_DATA in reports.test.js (kosmos#1912)

## Problem

`engine/reports.test.js` exercises `reports.blockBody(...)` without sandboxing
the data root. Two real-data reads leak through:

1. `personName()` -> `require('./you').read()` reads the operator's real
   `you.json` under `store.ROOT`.
2. `managerName('marcus')` -> `store.readProfile('marcus')` reads the real
   profile store.

On any machine with an operator NAME saved, `personName()` returns that name
instead of the generic fallback, so two assertions go red: the `personLine`
anon-fallback test and the CONTROL test. Green on developer machines only
because their record has no operator name. The population that can see the
failure (real users) is exactly the population that does not run the tests.

Reproduced against a seeded named store: `3 pass 2 fail` (matches the card's
control).

## Decision

Sandbox `AGENT_WORKFORCE_DATA` at the top of the file, before
`require('./reports')`, matching the sibling convention (`status.test.js`,
`you.test.js`): `mkdtempSync` + a `process.on('exit')` cleanup + the warning
comment. This isolates the WHOLE suite, covering both real-data reads, not
just the `you` path.

### Rejected

The narrower `Module.prototype.require` stub of `./you` that the named test
already uses. It only covers the `./you` require in the arm it wraps; it
leaves `managerName -> store.readProfile` reading the real profile store, and
does nothing about the mutation-adjacency risk (a suite that reads the real
root is one assertion from one that writes it). Env-sandbox is the documented
convention and covers the class.

### Require-ordering note (load-bearing)

`you.js` captures `const BASE = store.ROOT` and `const FILE` at REQUIRE time,
so the env must be set before `you.js` is first required. It is:
`reports.js` requires `./you` lazily inside `personName()`, and the env is set
before the top-level `require('./reports')`, so no engine module is pulled in
before the sandbox is in place.

## Done conditions (from the card)

1. Sandbox matches the siblings, with the warning comment. DONE.
2. Suite green with an operator name set (positive control): `5 pass 0 fail`
   with a name seeded in a real store. DONE.
3. Sweep for other test files touching the data root without a sandbox: a
   static sweep over reader entry points returns zero (its positive control
   confirms it would flag the pre-fix `reports.test.js`); the three raw
   candidates are false positives (`autohandoff-sweep` builds a path string,
   `instructions` is sandboxed via HOME + AGENT_WORKFORCE_WORKERS,
   `marker-registry` calls `you.blockBody(explicit record)`, never
   `you.read()`). DONE.

## Weakest premise

The sweep is a static reader-token grep. A test reaching the store through an
entry point outside that token list, or via a runtime-assembled require, would
be missed. Mitigated with behavioral reproduction and a positive control on
the sweep itself.
