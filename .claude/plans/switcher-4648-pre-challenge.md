---
pre_challenge: true
method: challenge-loop
branch: switcher-4648
diff_hash: d62c5501dfae796596a0aca6413bd29fafb8a19053ad7274cc10589371c039fc
validation: passed (full tools/run-tests.sh through validation_log_run_or_skip, run on MORTALS via ~/.cache/claude-handoffs/mortals-validate.sh at dc27240a7, ended 2026-09-29 21:36 CDT: EXIT=0, node 12321 tests, 0 failed, 0 cancelled, shell part green; recorded entry hash d62c5501 equals this worktree's. Its suite may have overlapped Splinter's #4609 jam-unstick run of pgroup-4669 on the same box; an overlap causes false reds, not false greens)
subdir_audit: passed
timestamp: 2026-09-30T02:37:37Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (fable, sonnet, fable, then a fourth blind round)
**Converged:** Yes, at iteration 4: zero NEW BLOCKERs or WARNINGs.
**Total findings:** 2 BLOCKERs, 5 WARNINGs, 2 CONVENTIONs, 6 NITs, all fixed or written down (details per round in .claude/plans/switcher-4648.md).
**Deferred:** a short cache for fidgety menu opens (each open is one signed call plus N probes).

- Round 1 (fable): the browser check was not gated (BLOCKER, enrolled); any DNS name passed validation (now one label under the coordinator's domain, enforced before any probe); offline rows linked to an error page; a reopened menu showed stale state; two tests weaker than they read.
- Round 2 (sonnet): tools/test-connector-verbs.sh pins the macRequest callers and account-computers.js is a new one (BLOCKER, re-decided in writing, list now six, 22/22); the render-side hide was unguarded.
- Round 3 (fable): the browser check's not-signed-in control read the DOM before the stub was served (WARNING, now waits for the served counter; red-checked 4 FAILED with that mutation).
- Round 4: converged. After it, the only change is the test leak fix (fake.cleanup()), which is inside the validated head dc27240a7.

The relay half (#212) is merged and deployed (coordinator 212acd0, and now d0b75bd). The connector rebuild that makes this list appear on a Mac is a separate step (release step 1d refuses a stale connector).

### Per-Iteration Breakdown

#### Iteration 1 (fable): 1 BLOCKER, 4 WARNINGs, 2 CONVENTIONs, 3 NITs
- [BLOCKER] docs/browser-checks/gated.txt - the browser check was not gated, so nothing ran it --> FIXED (enrolled, sorted; wiring, PR-select and quarantine guards 56/56)
- [WARNING] engine/account-computers.js - any DNS name (a LAN address included) passed validation --> FIXED (one label under the coordinator's domain, before any probe; an off-domain row is dropped and never probed)
- [WARNING] web/index.html - offline rows linked to a browser error page --> FIXED (only online computers are links)
- [WARNING] web/index.html - a reopened menu showed the previous open's state words --> FIXED (hidden and emptied at each read's start)
- [WARNING] tests - the worldswOpen test grepped for the call; the probe-timeout arm hung instead of failing --> FIXED (runs the shipped function with a spy; a hard race)
- [CONVENTION] connect-only Macs and phones open another computer in-window (#4356) --> stated in plan and markup
- [CONVENTION] the ship dependency (coordinator deploy + connector rebuild) --> stated
- [NIT] x3 (rounded corners, invented host names in the fixture) --> FIXED; a short cache for fast reopens DEFERRED

#### Iteration 2 (sonnet): 1 BLOCKER, 1 NIT
- [BLOCKER] tools/test-connector-verbs.sh pins the macRequest callers and account-computers.js is a new one --> RE-DECIDED in writing (an old connector refuses the route, which hides the section); the pinned list is six; 22/22
- [NIT] the render-side hide was unguarded (the fake box started hidden) --> FIXED (starts visible; red-checked)

#### Iteration 3 (fable): 1 WARNING, 2 NITs
- [WARNING] browser check - the not-signed-in control read the DOM before the stub was served --> FIXED (waits for the served counter and a render tick; red-checked 4 FAILED with that mutation)
- [NIT] the server arm's title claimed the not-signed-in path --> retitled to what it proves
- [NIT] the "emptied" half of the no-list arm could not fail --> seeds a stale row now

#### Iteration 4
- Zero NEW BLOCKERs or WARNINGs. CONVERGED.
