# uninstall-root-1511: one definition of the data root in the installer

## The card's premise was wrong, and checking it is what shaped the change

The card says `install/setup.sh` CANNOT call `dataRootFor`. It can: the installer
runs JavaScript through its own bundled runtime in three places already (an earlier
draft said two; `grep -n 'KOSMOS_HOME/runtime/bin/node"'` on main finds three).

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
can give one, and refuses on the RESULT rather than the input, because a partial or
odd answer must not steer a delete.

> 📌 CORRECTED after the third blind review, which covers iterations 2 and 3. "Returns
> an absolute path or nothing" is what iteration 1 built. The helper now applies six
> refusals on the final answer, each with an arm proven red: not absolute; no
> `/AgentWorkforce` leaf (every removal is bounded by that leaf, and the consult's
> answer is whatever the installed `store.js` returns); the system-wide Library by
> result, with the parent canonicalised so a symlink to it is caught (a case variant
> on a case-insensitive filesystem is NOT caught, and the code says so); a `.` or `..`
> component; a newline or shell-significant character (the value feeds a `grep -F`
> that gates `launchctl bootout` and `rm -f` on every agent job, the same mechanism
> KOSMOS_HOME is refused for). And the consult is bounded by a shell watchdog, because
> it runs whatever JavaScript is installed and a hang at the capture would be silent.

> 📌 CORRECTED after the fourth blind review. "Six refusals" above counts the symlink
> case separately; the code says FIVE and lists five, and the symlink and case-variant
> cases are members of the system-Library rule, which now compares the resolved
> folder's parent by DEVICE:INODE as well as by string (so a symlink at the parent, a
> symlink at the LEAF, and a case variant on a case-insensitive filesystem all land
> in it; the earlier "not covered" caveat is gone). The watchdog is a poll loop that
> exits by itself: the first version, `sleep N; kill`, left a process behind on EVERY
> outcome, and on a non-zero consult exit it outlived the uninstall because `wait`
> aborted the subshell under `set -e` before the kill. Every resolution in the helper
> is guarded with `||` so an unenterable directory produces a sentence, not a silent
> abort at an assignment. And the test now asserts the refusal SENTENCE on every
> refusal arm, because a helper that could not parse satisfied "nothing on stdout,
> non-zero" for twelve arms; arm 0 is `sh -n`.

One call, captured into `_support` before anything is removed; `_remote_state`,
the supervisor-ownership proof, the supervisor removal, the remembered answers, the
litter sweep and the closing sentence all read that value. Three literal definitions
of the resolved root become one.

> 📌 CORRECTED after the second blind review: this said "two sites route through
> it" and "three become one", and the supervisor-ownership proof was still a THIRD
> derivation from the base path, which can disagree with the product on the string
> for one directory (an override carrying `./`). Now it reads `_support` too.

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

> 📌 ADDED in iteration 2, the arm that matters most: the two static ordering arms
> (one call site, above the delete) were satisfied by a call under `if false`. Arm 11b
> runs the REAL `uninstall()` inside a box with every root pinned, shapes the install
> so `rm -rf "$KOSMOS_HOME"` actually runs, and measures what was DELETED: the
> supervisor under the consult's root goes, the literal's survives, and the agent job
> naming the consult's supervisor is removed. The control reverses all three with the
> runtime absent. That arm reds on the iteration-0 defect; the static ones could not.

## Scope

`install/setup.sh`, `package.json`, `tools/test-data-root-1511.sh`. Nothing else.
