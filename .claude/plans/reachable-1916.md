# reachable-1916 — excuse the setClaudeProbe test seam (fix red main from #1916)

## Problem
`origin/main` is red on `engine.reachable.test.js`:

```
actual:   [ 'engine/create.js exports setClaudeProbe' ]
expected: []
```

`engine.reachable.test.js` is a guard: it computes every name exported from `engine/*.js`
that is exercised by its own tests but referenced by nothing else (a dead-export /
orphan-test-seam detector) and fails on any such name not explicitly listed in its
`EXCUSED` map. #1916 (PR #1932) added `setClaudeProbe` to `engine/create.js` — a setter
that injects a fake `claude -p` liveness probe so tests do not spawn a real `claude`. It
matches the orphan signature exactly, so main went red the instant #1916 merged. Its own
CI never ran the consequence (the guard passed on a base without the export), and five PRs
merged on top of the red afterwards, each green against its own base.

Found by April (control-checked on a clean `origin/main` checkout — fails identically off
any branch), confirmed independently by Splinter on a fresh detached checkout.

## Fix
Add the one-line EXCUSED entry the guard's own comment prescribes ("An entry here is a
claim someone can check; do not add names to quiet the test without one"), grouped after
the other create.js seams (`setRunner`/`setPauser`/`setDryRun`):

```js
setClaudeProbe: 'test seam: injects the claude -p liveness probe so tests do not spawn a real claude (#1916)',
```

No product code changes. The sibling `claudeAccountLive` is deliberately NOT excused — it
has a real non-test caller (`accountConnectable`), so it is reachable and must stay
flagged-capable.

## Definition of done
- `engine.reachable.test.js` passes (was 1 fail, now 1 pass).
- Full suite green on the state rebased onto current `origin/main`.
- Merged so `main` goes green, unblocking the 0.6.23 cut.

## Verification
- Reproduced the red on main; the entry flips it to green.
- Full suite: node 3826/3826 (0 fail) + shell 33/33, exit 0.
- Challenge-loop: 1 iteration, converged, blind pass found nothing actionable.

## Not in scope
The 0.6.23 cut itself (handed to Baron, per Splinter, on capacity). This branch only
returns `main` to green.
