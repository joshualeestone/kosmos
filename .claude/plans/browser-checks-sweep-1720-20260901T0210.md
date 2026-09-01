# Plan: point browser-check sweepers at docs/browser-checks/, not the driver (kosmos#1720)

## The problem (from the card, the filer's own incident)
When you change rendered markup, the advice is to sweep for existing assertions first.
The natural place -- `tools/browser-checks.sh` -- is the WRONG file: it only NAMES and
runs the checks; every assertion lives in `docs/browser-checks/` (63 check scripts). A
grep of the driver returns hits, looks thorough, and misses every assertion that
matters. That gap killed 0.6.20's first 3b attempt (the swept change was #1702).

## Scope decision: two halves with very different blast radii

### Doing here (safe, repo-local, low-risk) -- this branch
The card's "weakest" + "cheapest" directions, both documentation:
1. `tools/browser-checks.sh` header: warn a SWEEPER outright that the assertions are
   not in the driver, and name `docs/browser-checks/`.
2. `docs/browser-checks/README.md`: a "sweep HERE before a markup change" section,
   naming the incident concretely.

### Flagged for the operator (NOT here) -- the mechanical gate
The card's "mechanical" direction: a check that a `web/`-touching PR either ran the
browser gate or touched/acknowledged `docs/browser-checks/`. Measured blast radius on
the card: the fleet `pre-challenge-gate` hook home would break the whole fleet's PR
gate on a bug; the right home is repo-local agent-workforce tooling (radius =
agent-workforce PRs). It is a shared surface (a false-block hits colleagues' web/
PRs), the filer declined to propose it solo, and it was ~2 AM with the operator
asleep -- so it is flagged with the measurement, not built here.

## Steps
1. Branch off origin/main.  2. The two doc edits above.  3. Challenge-loop + proof + PR.
4. The mechanical gate stays flagged on the card for Josh.

## Validation
Full suite (yarn test) green; the browser-checks-indexed "README names every script"
invariant verified passing (the README edit adds prose + one real script name, removes
none). Docs-only: changes no check logic or behavior.
