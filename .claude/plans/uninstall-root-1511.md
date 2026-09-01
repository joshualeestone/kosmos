# uninstall-root-1511: one definition of the data root in the installer

## The card's premise was wrong, and checking it is what shaped the change

The card says `install/setup.sh` CANNOT call `dataRootFor`. It can: the installer
runs JavaScript through its own bundled runtime in two places already.

What is true is narrower, and nobody had written it down. `uninstall()` does
`rm -rf "$KOSMOS_HOME"` and then needs the data root **176 lines later in the same
function**, so it deletes its own interpreter before the point where it would ask.
**The constraint is ORDERING, not language.** That is why `uninstall()` calls the
helper exactly once, at its top, before anything is deleted, and every consumer reads
that one `_support` value.

> 📌 CORRECTED after the first blind review. This said "the two call sites capture the
> value early". They did not: the supervisor-and-litter capture sat 176 lines after
> `rm -rf "$KOSMOS_HOME"`, so on every real uninstall it ran with the interpreter
> already gone and silently took the literal, while the `remote/` capture above the
> delete took the product's answer. Two derivations in one run, which is the defect
> this card exists to remove. Now one call, and the test pins both its count and its
> position, each proven able to go red.

## A second constraint, found by measuring an installed copy rather than reading

An uninstall runs against whatever version is **installed**, and `dataRootFor` only
exists from #570 onward. Measured against the real 0.2.36 install on this machine:
the runtime and `app/engine/store.js` are both present, and `dataRootFor` is **NOT**
exported, so the consult correctly falls through.

So for every install older than #570 the literal **IS** the path, not a safety net.
Writing it as a mere fallback would be a claim the code cannot support.

## What changes

`_kosmos_data_root` is the shell's answer to the question `dataRootFor` answers, in
one place instead of several. It prefers the product's own answer when the install
can give one, and returns an absolute path or nothing, because a partial or odd
answer must not steer a delete.

Two sites route through it, `_support` and `_remote_state`, so three literal
definitions of the resolved root become one.

## The uninstall guard is deliberately NOT routed through it

This is the part to read rather than tidy later.

The guard **compares two strings**, so its correctness depends on both being produced
the same way. Routing one side through a different derivation can stop the comparison
matching on formatting alone, and that does not fail loudly: **it silently disables a
refusal, on a delete path.** A guard that stops matching looks exactly like a guard
that found nothing to refuse.

## The test, and why one arm had to be constructed rather than observed

`tools/test-data-root-1511.sh`, wired into `test:shell` in `package.json` so it runs
in the gate rather than only on request.

🛑 **On macOS the product's answer and the literal are IDENTICAL**, so an arm built
from the real `store.js` proves nothing: it passes whether the consult ran or not.
Arm 3 therefore constructs a fake install whose `dataRootFor` returns a path the
shell fallback could never produce, which is the only way to tell "consulted the
product" from "used the literal and got lucky".

Every arm exists because the value steers an `rm -rf`. An arm that cannot fail is
worse than no arm on a delete path.

## Scope

`install/setup.sh`, `package.json`, `tools/test-data-root-1511.sh`. Nothing else.
