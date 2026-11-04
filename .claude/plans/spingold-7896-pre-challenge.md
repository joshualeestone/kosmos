---
pre_challenge: true
method: challenge-loop
branch: spingold-7896
diff_hash: a82d675542e13402cbc17d9872a9cf9c328de86c55a48aa1701e43e6dd92a568
validation: passed (validation-log hash=a82d675542e1 on a5917987a8: node suite 26534 pass 0 fail, test:shell 4 shards all green; render-model-spinners-2365.js passes; the four surface-mapped checks ran green)
subdir_audit: passed
timestamp: 2026-11-04T11:02:00Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4: no BLOCKERs or WARNINGs)
**Total findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 10 NITs
**Fixed:** 5 WARNINGs, 6 NITs | **Left with a reason:** 4 NITs | **Deferred:** 0 | **Asked:** 0

Controls: main's web/index.html fails both light states; mutants (the navy line, the system-dark line, the #firstrun
pin, the theme watcher, the plus-active watcher, each removed) each fail exactly their own arm.

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] the Kosmos+ navy screen (body.plus-active) would draw the deep gold in the light theme (3.7, down from 7.1)
  --> FIXED: body.plus-active keeps --spin-gold: var(--gold); checked by a navy arm (mutant fails it).
- [WARNING] the arm ran only on a light-scheme page, so system dark and forced light were untested --> FIXED: a
  dark-scheme page runs both (mutant: the system-dark line removed fails it).
- [NIT] the side figure named the wrong token --> FIXED (--k-side 3.78, --k-side-2 3.49).
- [NIT] KORB's comment said gold is the same in both themes --> FIXED.
- [NIT] #firstrun is white in both themes --> FIXED: it pins the deep gold.

#### Iteration 2
- [WARNING] going in or out of the Kosmos+ screen changes the orb's colour in the light theme, but nothing redrew a
  still (reduced-motion) orb, which kept the wrong gold until shown again --> FIXED: KORB watches body's class for a
  change in plus-active alone (old vs new, so other body classes cost nothing) and recolours. Arm: a still orb on a
  reduced-motion page goes into plus-active and must turn from the deep gold to --gold. Mutant (the watcher not
  observing): fails it (stays r154).
- [WARNING] the #firstrun pin had no arm --> FIXED: on the dark-scheme page, a spinner put inside #firstrun must read
  --spin-dot #9c741b. Mutant (the pin removed): fails it (#d6a62e).
- [NIT] the arm's restore was not in try/finally --> FIXED.
- [NIT] plus-active in the dark theme is untested --> left: it resolves to the same --gold as dark itself.

#### Iteration 3
- [WARNING] a still orb's recolour on a light/dark switch had no arm --> FIXED: one still-orb arm (reduced motion)
  covers both a switch to the dark theme and going into Kosmos+, on all three channels. Mutant (the theme watcher not
  observing): fails it (stays r154 g113 b22).
- [NIT] the plus arm compared red only --> FIXED (all three channels, as the other arms).
- [NIT] `if (document.body)` hid a dependency --> FIXED: a comment says KORB runs inside <body>.
- [NIT] inkOf's fallback for an unreadable --spin-dot is still #d6a62e --> left: it is the fallback for a broken
  value, the same in both themes, and never reached with the tokens defined.

#### Iteration 4 (final whole-branch read)
No BLOCKERs or WARNINGs; every FIXED claim above checked true in the code. Converged.
- [NIT] a throw in calmSwitch or the dark-page block leaves a page open until the browser closes --> left: the check
  still fails loudly, and the browser closes at the end of the run.
- [NIT] only the "into" direction of a switch is tested --> left: leaving runs through the same symmetric watchers.
- [NIT] the plan's Tests section listed five states only --> FIXED (above).

## Surface gate (#2518), found by full validation
The gate maps the tokens 'firstrun' and 'plus-active' (both in lines this branch adds, the --spin-gold declarations
and a comment) to four checks about those screens' layout and colour, not the spinner. All four RAN GREEN on this
branch (render-layer-gutter-4494, render-firstrun-choice-4356, render-plus-gutter-4542, render-plus-blue-1615, each
rc 0), so they carry per-check Browser-check-surface trailers rather than edits.
