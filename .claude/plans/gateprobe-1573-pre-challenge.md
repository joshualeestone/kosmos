---
pre_challenge: true
method: challenge-loop
branch: gateprobe-1573
diff_hash: 8af2ef202ac0a462b702f49572e62ace87b8e525803926646da1b6a6cc17b236
subdir_audit: passed
converged: false
timestamp: 2026-08-30T17:50:39Z
---

## [CHALLENGE-LOOP] Result: NOT CONVERGED, stopped on a stated budget constraint

**Eight blind rounds. Rounds five, six, seven and eight each returned a BLOCKER**, every one
of them in a guard I had written, and every one green in the dangerous direction. Round
eight's is the sharpest: my counting branches were mutually exclusive, so a check that
presses the real Create button, chained onto a legitimate call, counted as zero.

**I am not claiming convergence and I did not stretch a dedup to reach it.** The loop was
still producing findings. I stopped because the fleet's weekly budget was flagged as the
binding constraint, under the standing ruling that zero outstanding BLOCKERs is the bar.

⇒ **Expect a ninth round to find something.** On this branch's record that is the base rate,
not a worry.

### BLOCKERs found and closed

- **stub bodies checked by first token only** so `[ "$1" = --version ] && claude --version`
  passed. Now every command position is checked. Four spellings perturbed RED.
- **the guard read heredocs only** while its own comment blessed switching to `printf`, so
  that correct change made it read ZERO stubs and stay green with `curl | sh` as a body.
  Two of four stubs had never been read at all.
- **my anchor fix broke the stubs.** Marker comments went above `#!/bin/sh`, so execFile
  answered ENOEXEC and both boards reported `willInstall TRUE`, becoming indistinguishable,
  which is the defect this card exists to CATCH. **The full suite passed 3111/3111
  throughout**, because nothing in `npm test` executes those stubs.
- **the shebang was outside every guard by construction**, since all of them skip lines
  starting with `#`. Deleting it stayed green. Now asserted.
- **guard 2 pinned to `$P14`/`$P15`** while the block's own loop assigns `_port`
  transitively. Alias resolution is now a fixpoint and a `for` header counts as an
  assignment.
- **counting branches mutually exclusive**, so a bare check chained onto a `run_one` line
  counted 1. Now per-fragment and additive.

### WARNINGs closed

A guard that **redded a correct change** (a bare `&` split a redirect). A **hardcoded board
list**, so a third board's missing stub was never sought. A **fixed-size slice** that failed
in the alarming direction. **Two floors replaced by equalities**, because a minimum cannot
see a defect that inflates the population. A **control that counted a different string than
its subject** (0 of one thing against 25 of another). A **false "not a regression" clause**.
A **safety enumeration naming one module of four** while claiming completeness, omitting the
one whose `bootout` stops a running agent.

### 🛑 SCOPE, stated because it is easy to read this as more than it is

**THE CHECK ITSELF HAS NEVER BEEN EXECUTED.** Playwright is absent from this worktree, so
`docs/browser-checks/render-connect-skip.js` has not run: not its seven assertions, not
`run_one` integration, not the two boards booting. What IS measured is its SUBJECT,
`connect.willInstall()`, through the real engine with both arms. The wiring from predicate
to page is READ, not executed.

⇒ **Nothing in `npm test` executes the stubs OR the check.** The same blind spot in both
directions, and it is why a cosmetic edit broke an executable while every instrument I own
reported green.

### Validation

Full suite **3111 tests, 3111 pass, 0 fail, exit 0**, zero FAIL lines anywhere in the run,
control 450 PASS lines. Every fix above perturbed RED with a passing control, and each arm
verified to fire its OWN assertion rather than one over-broad check firing repeatedly.
