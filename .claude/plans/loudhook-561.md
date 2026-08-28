# #561: the guard against silent reporting had no test

## What was missing

`install/kosmos-report-hook.sh` carries a "loud check" whose whole job is #561's rule: **never report silence when you cannot report at all.** A board with no reports looks exactly like a board of idle agents, so a hook that fails quietly is worse than no hook.

**The guard existed and worked. Nothing tested it.** Measured before writing anything:

```
files containing "reporting is OFF for this session"  -> 1   (the hook itself)
CONTROL: files containing "kosmos-report-hook"        -> 10  (so the sweep works)
```

⭐ Same shape `tools/test-report-hook-source.sh` was written for, in its own words: *"#1058 shipped as 30 lines of shell with NO TEST. The behaviour it changes is invisible."* Shell, untested, and the failure mode is silence.

## The four arms

Driven through `KOSMOS_REPORT_CLI`, the hook's own seam, with stub CLIs. Nothing touches a real board.

| arm | stub | expected |
|---|---|---|
| no CLI | a path that does not exist | loud: "no runnable kosmos CLI" |
| stale CLI | prints the old generic verb list | loud: "does not support the report verb" |
| undeliverable | knows the verb, fails to land | loud: "could not be recorded" **and carries the CLI's own sentence** |
| **control** | a working CLI | **silent** |

⭐ The control is what makes the file worth having. A guard that shouts on every path is noise, not a guard, so proving it can stay quiet is what gives the three loud arms meaning.

The undeliverable arm asserts twice on purpose: that it speaks, and that it surfaces *the CLI's own reason* ("the board is not running on this computer") rather than a genericised one. A person needs to read the actual cause.

## Perturbation: each guard broken separately

| perturbation | result |
|---|---|
| remove the no-CLI guard | **RED**, 1 arm |
| remove the stale-verb guard | **RED**, 1 arm |
| remove the delivery guard | **RED**, 2 arms (speaks + carries the reason) |

Exactly one guard per arm, except the delivery one which owns two assertions. 📌 The no-CLI perturbation is the instructive one: with that guard removed, execution falls through to the **version** guard and emits a *different* loud sentence. The test still failed, on "said something else" rather than on silence, because it matches the specific sentence rather than merely "something was printed". A looser assertion would have passed.

## And the step that would have made it decorative

`tools/test-report-hook-loud.sh` is added to `test:shell`, which `tools/run-tests.sh` invokes via `yarn -s test:shell`, which is what `npm test` runs.

**Verified by perturbation of the chain, not by reading it:** with the hook broken, `yarn -s test:shell` exits 1 and names my arm. A test file nobody executes reads as coverage and is worse than no file.

## What I expect to be wrong about

- The stub CLIs encode my belief about how a **real** old CLI answers `report`. I took the shape from the existing test's stub and from the hook's own comment (both exit 2, only the words differ), but I have not run a genuinely old bundle.
- I did not test the throttle or the `#1058` compaction logic; `test-report-hook-source.sh` owns those and I deliberately did not duplicate them.
- The arms cover `SessionStart` only, because that is where the loud check lives. If a future change moves any guard to another event, this file would not notice.
