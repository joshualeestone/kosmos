# #1467: a test for `resolve_kosmos`, the function that broke reporting for 18 agents

## Why this and not the fix

#1467's fix changes what the fleet's reporting hook resolves, and deploying it costs every agent on the box their reporting during the window. **It has already gone wrong once, at my suggestion.**

⇒ **This branch does the part that is safe and makes the risky part testable.** A test cannot break the fleet, it would have caught the incident, and without it the eventual resolver change has nothing to verify against.

## The gap

```
resolve_kosmos appears in:  install/kosmos-report-hook.sh   and nowhere else
test coverage:              NONE
CONTROL, files referencing the hook: 10
```

⚠️ **And the existing hook test cannot catch it**, which is why the gap survived a careful repo: `tools/test-report-hook-source.sh` sets `KOSMOS_REPORT_CLI`, takes rung 1, and never executes the resolution logic. **A test that stubs the thing under test is not coverage of it.**

## Six arms, constructing real layouts

The bug is a path relationship, so the arms build real directories rather than mocking.

| arm | asserts |
|---|---|
| installed bundle | resolves to the bundle CLI |
| source checkout | resolves to the sibling CLI |
| **deployed elsewhere** | **returns EMPTY**, the arm that broke the fleet |
| env override | `KOSMOS_REPORT_CLI` beats every layout |
| **CONTROL** no `server.js` | the installed rung **refuses**, proving its guard is real |
| **CONTROL** extraction | produced a real function body |

📌 The deployed-elsewhere arm **documents current behaviour rather than asserting it is correct.** Its failure message says so: if somebody adds a rung deliberately, update the test and say why.

## Perturbed, three rungs, restore sha-verified

| perturbation | result |
|---|---|
| delete the source rung | source arm red |
| drop rung 2's `server.js` guard | **the CONTROL red**, which is what proves it load-bearing |
| remove the env rung | override arm red |

## Two defects the perturbation found in my own work

**A control keyed on a rung's content.** It grepped `KOSMOS_REPORT_CLI`, so removing that rung made it fail for the **wrong reason** and report an extraction failure that had not happened. Re-keyed to structure. **A control that breaks when the subject is edited normally is a false-alarm generator.**

**A string comparison where a file comparison belonged.** My first assertion compared the resolver's literal return, which is an unnormalised `$HERE/../../bin/kosmos`. That is correct and is what the hook executes. **The test was wrong, not the resolver.**

## What runs it

Wired into `test:shell` beside its sibling. **`tools.every-test-runs.test.js` caught the unwired file by itself**, and its failure message named the fix. That is the repo answering "what runs the guard" without being asked, and it is the reason this is coverage rather than decoration.

## Verification

Full suite **2918 pass, 0 fail, exit 0**, with my six arms confirmed present in that run by name.

⚠️ **I nearly reported the opposite.** I grepped the suite log while it was still being written and found my arms absent, because `test:shell` runs **after** `node --test`. **Absence in a log mid-write is not absence.** The completion notification is the signal; I checked before it arrived.

## Weakest premise

**This tests the resolver as it is, not as it should be.** The deployed-elsewhere arm locks in an EMPTY return, which is the behaviour that broke the fleet. **That is deliberate documentation, not endorsement**, and anyone fixing #1467 properly must change this test as part of the fix. If that reads as obstruction rather than a tripwire, it is the wrong shape and I would rather be told.
