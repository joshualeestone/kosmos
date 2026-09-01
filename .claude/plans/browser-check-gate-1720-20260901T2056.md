# browser-check-gate-1720: refuse a web/ change with no browser-check assertion

Branch: `browser-check-gate-1720` (worktree off origin/browser-check-gate-1720, which is my
own commit 726c42eb preserved by Splinter). Addresses #1720.

## The gap (#1720)
The browser-check ASSERTIONS live in `docs/browser-checks/*.js`, not in the driver
`tools/browser-checks.sh` (which only NAMES them). So a change to `web/` (the rendered
surface) can ship with no assertion, and a sweep of the driver looks thorough while missing
every assertion that matters. This is what #1702 did to `render-accounts-openai` (red every
cut until #1711 repaired it) and the gap that killed a release.

## What already shipped (do not redo)
- #1729 (MERGED): the docs half -- the driver header + README now point a sweeper at
  docs/browser-checks/.
- 726c42eb (this branch): the gate lib `tools/lib/browser-check-gate.sh`. Rule: a change
  touching web/ must EITHER update docs/browser-checks/ OR carry a non-empty
  `Browser-check: <reason>` commit trailer, else it is refused. Seams
  (KOSMOS_BCG_FILES/MSGS/BASE) make it provable without a real branch. Fail-soft.

## What this branch adds
1. `tools/test-browser-check-gate.sh` -- a red-capable test through the seams: it asserts
   the refuse arm (rc 1: web/ change, no assertion, no override) AND the pass arms
   (docs/browser-checks/ update; non-empty override; no web/ change; nested web/ path; a
   BLANK override still refused; a docs/webhooks path is not web/). A real control.
2. `package.json` test:shell -- bash -n the lib and test, then run the test.
3. `tools/run-tests.sh` -- after node + test:shell pass, run the LIVE gate against
   origin/main...HEAD in a subshell (fail-soft).

## The one real decision: the firing point (documented for review)
The gate fires at **branch/suite time** (`bash tools/run-tests.sh` / `yarn test`), against
`origin/main...HEAD`. Reasoning:
- **Not release time.** By release the web/ change is already on main and `origin/main...HEAD`
  is empty, so a release-time gate is vacuous. The gap must be caught BEFORE merge.
- **Repo-local, not the fleet hook** (Josh's ruling, and the lib's header): the fleet
  pre-challenge-gate hook runs across every repo, so a bug there breaks PR creation
  fleet-wide; this gate is about THIS repo's web/ and docs/browser-checks/, so its radius is
  agent-workforce contributors only.

**Friction acknowledged, and the override is the mitigation.** After this lands, any branch
with a COMMITTED web/ change and no committed docs/browser-checks/ update will red `yarn
test` until the author adds the assertion or a `Browser-check: <reason>` trailer. That is
the intended enforcement; the trailer is the designed, auditable escape for a genuine
copy-only / already-covered / ran-the-browser-gate case (a blank trailer is refused, so a
bypass states why). It fires only on COMMITTED changes, so mid-edit working-tree state is
never blocked.

## Checklist
- [x] Gate lib (726c42eb, pre-existing on the branch)
- [x] Red-capable test (tools/test-browser-check-gate.sh)
- [x] Wire test into test:shell + live gate into run-tests.sh
- [x] Full suite green (3530/3530); gate passes on this branch; negative control reds
- [ ] /challenge-loop
- [ ] PR (flag the firing-point + friction decision for Splinter/Josh; self-merge under the Kosmos beta norm is appropriate for repo-local tooling, but the firing point is the reviewable call)
