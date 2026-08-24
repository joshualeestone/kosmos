---
pre_challenge: true
method: challenge-loop
branch: connect-dir
diff_hash: eaf54249e72571246c94471a568461c9c9521d1742c7bd0c0077f776127dd892
subdir_audit: passed
timestamp: 2026-08-24T15:25:58Z
iterations: 3
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** No (stopped at the bound stated to the PM BEFORE iteration 3 ran; see the stop record)
**Total findings:** 17 (2 BLOCKERs, 8 WARNINGs, 0 CONVENTIONs, 6 NITs, 1 NOTE carded)
**Fixed:** 15 | **Deferred:** 1 | **Carded:** 1 (#527)

### Stop record (the bound, stated before iteration 3)

This branch edits the app's deepest stateful flow, and the fleet has a
carded failure (#120) for review loops that run unbounded on exactly this
kind of code. The bound was therefore stated out loud to the PM before
iteration 3 started: iteration 3 is the last, its mandate is three named
properties (no record stamped with the wrong account's directory under any
interleaving; no path reads or signs into a directory other than the flow's
own; nextWorkDir never offers a spot that could be somebody's account or
history, nor one prepare would refuse forever), a finding against those
gets fixed with a pin and no new round, and anything else gets carded.
Iteration 3 CONSTRUCTED AND MEASURED its verdicts: properties 1 and 2 held
under every interleaving the reviewer could drive (two rapid starts, races
into the early-exit and finishConnected kill awaits, cancel storms, 18
writeState sites enumerated behind identity guards); property 3 had one
measured blocker (two conflated ENOENTs made a broken projects symlink
read as free, a permanent wedge), fixed and pinned under the bound's
fix-with-a-pin arm. The one NOTE (a latent default-dir asymmetry no
current caller can reach) is carded as #527. The refined stopping tell,
now on record: a finding inside a previous round's fix that is MEASURED is
the loop still earning; one that is not measured is churn.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 5 WARNINGs, 4 NITs
- [WARNING] module flowDir could diverge from the owning flow under two rapid starts, stamping records with the wrong account --> FIXED: writeState prefers the claimed driver's own dir; pre-claim and teardown paths re-aim explicitly
- [WARNING] the two tick-site scopings were unpinned; reverting either left all tests green --> FIXED: the login-done hold test (global connected, flow dir empty, phase must hold), proven by perturbation both directions
- [WARNING] nextWorkDir conflated damaged with absent configs, offering a possibly signed-in account --> FIXED: three config grades, only genuinely-free shapes offered
- [WARNING] the route's body-parse failed open into a GLOBAL start --> FIXED: fails closed, 400
- [WARNING] prepare ok with memoryShared false proceeded into an unshared birth --> FIXED: born shared or not born, refused with the sentence naming it
- [NIT] cancel left the cancelled flow's dir on the idle record --> FIXED
- [NIT] the env-seam warning fired falsely on scoped flows --> FIXED
- [NIT] the differential test never asserted its premise --> FIXED
- [NIT] the resume contract for interrupted scoped flows was unsettled --> SETTLED in writing with the UI half's owner: interrupted-with-configDir resumes via another:true, and nextWorkDir re-offers the same unclaimed spot

#### Iteration 2
**New findings:** 1 BLOCKER, 3 WARNINGs, 2 NITs
- [BLOCKER] (measured) two rapid starts could stamp the early-exit CONNECTED verdict with the OTHER caller's dir: iteration 1's own fix left the claimed-driver half of the race open --> FIXED: ownership guard after the kill await, mirroring finishConnected; a claimed successor stops the write entirely
- [WARNING] freeness accepted ANY projects symlink while prepare demands the shared tree: a wedge --> FIXED: freeness demands what preparability demands
- [WARNING] the strict freeness broke the contract's anti-litter reuse arm (the CLI writes a theme-only config at launch, so common cancels would litter) --> FIXED: a readable config with no account block is free
- [WARNING] a mangled-but-parseable another silently ran the global flow --> FIXED: non-boolean another is a 400
- [NIT] scoped sentences claimed facts about "this computer" --> FIXED: scoped sentences speak about the one account
- [NIT] cancel's nobody's-flow comment overspoke a transient race --> FIXED: the comment tells the transient truth

#### Iteration 3 (bounded, final)
**New findings:** 1 BLOCKER, 1 NOTE
- [BLOCKER] (measured) lstat's ENOENT and realpath's ENOENT were conflated, so a BROKEN projects symlink read as free while prepare could never claim it: every future add-another-account attempt wedged on the same dead spot --> FIXED under the bound: the two ENOENTs split, pinned with a broken-symlink fixture
- [NOTE] scoped check misreads the DEFAULT account's config location; unreachable by any current caller --> CARDED as #527
- Properties 1 and 2: HELD under constructed interleavings (the reviewer drove the real module with gated awaits and intercepted every state write; positive controls first)

### Validation
Full suite green after every iteration, exit codes read from log files. Both discriminating tests proven by perturbation: the scoped-check differential (scoping ignored, both pins red) and the finish-line hold (unscoped finish, red). Final validation: PASSED, hash eaf54249e725. Subdir audit: passed. No em dashes in any added line.
