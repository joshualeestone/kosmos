# machine-runnable-1641: converge the last inline "is this runnable" copy

## What the card asked, and why it was a card rather than a fix on #1592

#1592 ("one definition of is this runnable") repointed four sites onto
`engine/runners.js`'s exported `isRunnable`, and deliberately LEFT
`engine/machine.js`'s `installedCheck` with its own inline pair:

```js
if (!st.isFile()) { present[key] = false; ...; continue; }
try { fs.accessSync(bin, fs.constants.X_OK); present[key] = true; }
catch { present[key] = false; ... }
```

That was the correct question asked correctly, but it is a SECOND copy of the
definition the branch title says there should be one of. It was filed (#1641)
rather than fixed on #1592 because fixing it means editing machine.js while
another live branch was in that file. That precondition is now clear: measured
before starting, no worktree has a dirty `engine/machine.js` and no open PR
touches it.

## What changes

`installedCheck` now asks `require('./runners').isRunnable(bin)` instead of
inlining `st.isFile()` + `accessSync(bin, X_OK)`. `isRunnable` asks the identical
question (a plain file, not a directory, with an exec bit THIS process can run).

No cycle: `runners.js` requires only node builtins plus `./platform`, and
`platform.js` requires no app module, so `machine.js -> runners -> platform` does
not point back.

## The outer statSync STAYS, and why

`installedCheck` does its own `fs.statSync(bin)` first, purely to CLASSIFY the
path: ENOENT means missing (`present = false`), and an unreadable path (EACCES)
means `present = null`, which is a different screen state (#979/#1567 history).
`isRunnable` collapses both to `false`, so it cannot take that classification
over. The statSync result is now discarded (only its throw is used); the code
says so.

## The census, and following the siblings rather than inventing a rule

`engine.runnable-not-directory.test.js` pins the exact set of
`accessSync(...X_OK)` occurrences, CODE AND PROSE keyed identically. `connect.js`
and `devicedoor.js` each converged their real call and KEPT a pinned prose
warning explaining the directory hazard. machine.js now does the same: the real
call is gone, a prose comment remains, and its census entry is updated to the
prose form (`accessSync(bin, X_OK`) rather than removed. The siblings are the
spec here.

## Verification, done by running, not by reading

- The whole `engine.runnable-not-directory.test.js` file is green (22/22),
  including the census arm and the behavioural arm.
- The behavioural arm (`installedCheck answers NOT PRESENT for a directory named
  like the binary`) drives the change for all three keys (claude, codex, tmux),
  asserting `present = false` for a directory and `present = true` for a real
  executable. It was PERTURBED to prove it still fails on demand through the new
  path: forcing the runnable branch true made a directory read as present, and
  the arm went red naming the key. Restored byte-identical afterwards.

## Scope

`engine/machine.js`, `engine.runnable-not-directory.test.js`. Nothing else.
This is the "branch title literally true" cleanup the card describes; nothing was
broken, and the machine.js site answered correctly before and after.
